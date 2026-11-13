#!/usr/bin/env node
// 把 NapCat 当前的空间 Cookie 同步到 GitHub Actions Secret（作为备用通道）
// 用法：node scripts/push-secret.mjs [--force]
// 需要：服务器上已 gh auth login，且 GITHUB_REPO=owner/repo
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { loadEnvFiles } from '../src/config.mjs';
import { fetchNapCatCookie } from '../src/napcat.mjs';
import { hash33, inspectCookie, parseCookie } from '../src/qzone.mjs';

loadEnvFiles();

function resolveGh() {
  const candidates = [
    process.env.GH_PATH,
    '/usr/local/bin/gh',
    '/usr/bin/gh',
    'C:/Program Files/GitHub CLI/gh.exe',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  const where = spawnSync('where.exe', ['gh'], { encoding: 'utf8' });
  const first = String(where.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)[0];
  if (where.status === 0 && first && existsSync(first)) return first;

  return '';
}

function ghSet(ghPath, repo, kind, name, value) {
  const args =
    kind === 'secret'
      ? ['secret', 'set', name, '--repo', repo]
      : ['variable', 'set', name, '--repo', repo, '--body', value];

  const result = spawnSync(ghPath, args, {
    input: kind === 'secret' ? value : undefined,
    encoding: 'utf8',
  });

  if (result.error || result.status !== 0) {
    const detail = (result.stderr || result.error?.message || '').trim();
    throw new Error(`${kind} ${name} 写入失败：${detail}`);
  }
}

function repoSlug() {
  const fromEnv = (process.env.GITHUB_REPO || '').trim();
  if (fromEnv) return fromEnv;

  const remote = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' });
  if (remote.status === 0) {
    const match = String(remote.stdout || '')
      .trim()
      .match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    if (match) return match[1];
  }

  return '';
}

const ALERT_QQ = String(process.env.ALERT_QQ || '').replace(/\D/g, '');
const ALERT_STAMP = process.env.ALERT_STAMP || '/var/log/.qwotday-sync-alert';
const API = String(process.env.NAPCAT_API_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const TOKEN = String(process.env.NAPCAT_TOKEN || '').trim();

/** 同一天只提醒一次，避免每 6 小时刷屏 */
function alertAlreadySentToday() {
  try {
    return readFileSync(ALERT_STAMP, 'utf8').trim() === new Date().toISOString().slice(0, 10);
  } catch {
    return false;
  }
}

function markAlertSent() {
  try {
    writeFileSync(ALERT_STAMP, `${new Date().toISOString().slice(0, 10)}\n`, 'utf8');
  } catch {
    /* 写不了就算了 */
  }
}

async function sendAlert(message) {
  if (!ALERT_QQ) return;

  try {
    await fetch(`${API}/send_private_msg`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      },
      body: JSON.stringify({ user_id: Number(ALERT_QQ), message }),
      signal: AbortSignal.timeout(15000),
    });
    markAlertSent();
  } catch (error) {
    console.error(`⚠️  提醒发送失败：${error.message}`);
  }
}

async function main() {
  const force = process.argv.includes('--force');

  const ghPath = resolveGh();
  if (!ghPath) throw new Error('找不到 gh 命令（请先安装 GitHub CLI 并 gh auth login）');

  const repo = repoSlug();
  if (!repo) throw new Error('不知道要推送到哪个仓库，请设置 GITHUB_REPO=owner/repo');

  const { cookie, uin } = await fetchNapCatCookie();

  const map = parseCookie(cookie);
  const gtk = hash33(map.get('p_skey') || map.get('skey') || '');
  const check = await inspectCookie({ cookie, uin, gtk });

  if (!check.ok && !force) {
    throw new Error(`换到的 Cookie 校验失败（${check.reason}），本次不推送`);
  }

  ghSet(ghPath, repo, 'secret', 'QZONE_COOKIE', cookie);
  ghSet(ghPath, repo, 'secret', 'QZONE_UIN', uin);
  ghSet(ghPath, repo, 'variable', 'COOKIE_MINTED_AT', new Date().toISOString());

  console.log(`✅ 已同步到 ${repo}：QZONE_COOKIE / QZONE_UIN / COOKIE_MINTED_AT`);
  console.log(`   QQ ${uin}，Cookie ${cookie.length} 字符`);
}

main().catch(async (error) => {
  console.error(`❌ ${error.message}`);
  console.error('   （只是备用通道同步失败，云主机自己发帖不受影响）');

  if (!alertAlreadySentToday()) {
    await sendAlert(
      '【每日一言】Cookie 同步到 GitHub Secret 失败，备用通道暂时不可用。\n' +
        `原因：${String(error.message).slice(0, 200)}\n` +
        '服务器上跑：bash /opt/qwotday/deploy/health.sh',
    );
  }

  process.exitCode = 1;
});
