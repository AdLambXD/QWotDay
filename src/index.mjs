#!/usr/bin/env node
// 主流程：取一言 → 校验登录态 → 发说说 → 回读校验 → 记录状态
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { readConfig } from './config.mjs';
import { renderPost } from './format.mjs';
import { fetchHitokoto } from './hitokoto.mjs';
import {
  QzoneAuthError,
  cookieUin,
  hash33,
  inspectCookie,
  parseCookie,
  publishPost,
  recentPostContents,
  verifyPublished,
} from './qzone.mjs';

const MAX_HISTORY = 200;

class ConfigError extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function warn(message) {
  console.log(`⚠️  ${message}`);
}

function printPost(text) {
  console.log('\n----- 说说内容 -----');
  console.log(text);
  console.log('--------------------\n');
}

function readState(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return {
      version: parsed.version || 1,
      updatedAt: parsed.updatedAt || null,
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return { version: 1, updatedAt: null, history: [] };
  }
}

function recentUuids(state, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const uuids = new Set();

  for (const item of state.history) {
    const postedAt = Date.parse(item.postedAt);
    if (!Number.isFinite(postedAt) || postedAt >= cutoff) {
      if (item.uuid) uuids.add(item.uuid);
    }
  }

  return uuids;
}

function appendHistory(state, entry, path) {
  state.version = 1;
  state.updatedAt = new Date().toISOString();
  state.history.push(entry);
  if (state.history.length > MAX_HISTORY) {
    state.history = state.history.slice(-MAX_HISTORY);
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function main() {
  const config = readConfig();

  console.log('=== QWotDay · 每日一言 → QQ空间 ===');
  console.log(`模式：${config.dryRun ? '演练（不会发布）' : '正式发布'}`);

  if (!config.cookie) {
    if (!config.dryRun) {
      throw new ConfigError(
        '缺少 QZONE_COOKIE。请在仓库 Settings → Secrets 或本地 .env.local 中配置 QQ 空间 Cookie。',
      );
    }
    warn('未配置 QZONE_COOKIE，演练只输出文案。');
  }

  let uin = (config.uin || '').replace(/^o/i, '').replace(/\D/g, '');
  let gtk = 0;

  if (config.cookie) {
    const cookieMap = parseCookie(config.cookie);
    uin = uin || cookieUin(cookieMap);

    if (!uin) {
      throw new ConfigError('无法从 Cookie 中解析 QQ 号，请设置 QZONE_UIN。');
    }

    const secret = cookieMap.get('p_skey') || cookieMap.get('skey') || '';
    if (!secret) {
      throw new ConfigError('Cookie 中缺少 p_skey / skey，请重新复制完整的 Cookie 请求头。');
    }

    gtk = hash33(secret);
    console.log(`账号：${uin}`);
  }

  console.log('→ 获取每日一言…');
  const state = readState(config.statePath);
  const excludeUuids = recentUuids(state, config.dedupeDays);
  const quote = await fetchHitokoto({
    categories: config.categories,
    excludeUuids,
  });

  const { text, date } = renderPost({
    template: config.template,
    quote,
    tag: config.tag,
    timeZone: config.timeZone,
  });

  console.log(`   来源：${quote.fromWho || '佚名'}${quote.from ? `《${quote.from}》` : ''}`);
  console.log(`   uuid：${quote.uuid || '(无)'}`);

  // 每天条数上限：超了就跳过（GitHub Actions 备用通道靠它避免多发）
  if (config.maxPostsPerDay > 0 && config.cookie && !config.dryRun) {
    try {
      const recent = await recentPostContents({
        cookie: config.cookie,
        uin,
        gtk,
        num: 20,
      });
      const todayCount = recent.filter((item) => item.includes(date.short)).length;

      if (todayCount >= config.maxPostsPerDay) {
        console.log(
          `⏭  今天已经发了 ${todayCount} 条（上限 ${config.maxPostsPerDay} 条），本次跳过。`,
        );
        return;
      }
      console.log(`   今天已发 ${todayCount}/${config.maxPostsPerDay} 条`);
    } catch (error) {
      warn(`检查今日已发条数失败，继续执行：${error.message}`);
    }
  }

  if (config.dryRun) {
    if (config.cookie) {
      const check = await inspectCookie({ cookie: config.cookie, uin, gtk });
      if (check.ok) {
        console.log('✅ Cookie 有效');
      } else {
        console.log(`❌ Cookie 无效：${check.reason}`);
        process.exitCode = 1;
      }
    }
    printPost(text);
    console.log('演练完成，未发布任何内容。');
    return;
  }

  console.log('→ 校验登录态…');
  const check = await inspectCookie({ cookie: config.cookie, uin, gtk });
  if (!check.ok) {
    throw new QzoneAuthError(check.reason);
  }
  console.log('✅ Cookie 有效');

  console.log('→ 发布说说…');
  let result = null;
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      result = await publishPost({
        cookie: config.cookie,
        uin,
        text,
        gtk,
        qzonetoken: check.qzonetoken,
      });
      break;
    } catch (error) {
      if (error instanceof QzoneAuthError) throw error;
      lastError = error;
      if (attempt === 3) break;

      const waitMs = attempt === 1 ? 15000 : 45000;
      warn(`第 ${attempt} 次发布失败：${error.message}，${waitMs / 1000} 秒后重试…`);
      await sleep(waitMs);
    }
  }

  if (!result) throw lastError;

  console.log(`✅ 发布成功${result.tid ? `（tid=${result.tid}）` : ''}`);

  appendHistory(
    state,
    {
      date: date.iso,
      postedAt: new Date().toISOString(),
      uuid: quote.uuid,
      tid: String(result.tid || ''),
      text,
      from: quote.from,
      fromWho: quote.fromWho,
    },
    config.statePath,
  );

  if (config.verifyDelayMs > 0) {
    console.log(`→ ${Math.round(config.verifyDelayMs / 1000)} 秒后回读校验…`);
    await sleep(config.verifyDelayMs);
  }

  let verify = null;
  try {
    verify = await verifyPublished({
      cookie: config.cookie,
      uin,
      gtk,
      text: quote.text,
    });
  } catch (error) {
    if (config.strictVerify) throw error;
    warn(`回读校验失败：${error.message}`);
  }

  if (verify?.found) {
    console.log('✅ 回读校验通过');
  } else if (verify && config.strictVerify) {
    throw new Error('发布接口返回成功，但回读未找到该说说（可能被审核或风控）。');
  } else if (verify) {
    warn(
      `回读暂未找到该说说，可能仍在审核中；请稍后到 QQ 空间确认。最新一条：${
        verify.latest || '(空)'
      }`,
    );
  }

  console.log('🎉 今日任务完成');
}

main().catch((error) => {
  console.error(`\n❌ ${error.message}`);

  if (error instanceof QzoneAuthError) {
    console.error('');
    console.error('QQ 空间登录态已失效，请更新 Cookie：');
    console.error('  1) 本地运行 npm run login -- --push（扫码后自动写入仓库 Secret）');
    console.error('  2) 重新从浏览器复制 Cookie，更新仓库 Secret QZONE_COOKIE');
    console.error('步骤见 README「获取 Cookie」一节。');
  }

  process.exitCode = 1;
});
