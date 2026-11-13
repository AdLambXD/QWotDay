#!/usr/bin/env node
// 云主机入口：从本机 NapCat 取空间 Cookie，再走一遍正常发布流程。
// 这样 Cookie 永远是新换的，不存在「过期」问题。
// 发布失败时会通过 NapCat 给指定 QQ 发一条提醒。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { loadEnvFiles } from './config.mjs';
import { fetchNapCatCookie, NapCatError } from './napcat.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

loadEnvFiles();

const passArgs = process.argv.slice(2);
const dryRun = passArgs.includes('--dry') || process.env.DRY_RUN === '1';

const API = String(process.env.NAPCAT_API_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const TOKEN = String(process.env.NAPCAT_TOKEN || '').trim();
const ALERT_QQ = String(process.env.ALERT_QQ || '').replace(/\D/g, '');

// 把日志里可能很长的内容截断，避免消息刷屏
function shorten(text, max = 300) {
  const value = String(text ?? '').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

async function sendAlert(message) {
  if (!ALERT_QQ) return;

  try {
    const response = await fetch(`${API}/send_private_msg`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      },
      body: JSON.stringify({ user_id: Number(ALERT_QQ), message }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    if (!text.includes('"status":"ok"')) {
      console.error(`⚠️  提醒发送失败：${shorten(text, 200)}`);
    }
  } catch (error) {
    console.error(`⚠️  提醒发送失败：${error.message}`);
  }
}

async function main() {
  let cookie;
  let uin;

  try {
    ({ cookie, uin } = await fetchNapCatCookie());
    console.log(`🚀 NapCat 已就绪：QQ ${uin}`);
  } catch (error) {
    const message = error instanceof NapCatError ? error.message : String(error.message);
    console.error(`\n❌ ${message}`);
    if (!dryRun) {
      await sendAlert(`【每日一言】取不到 Cookie，今天可能发不出去。\n${shorten(message, 200)}`);
    }
    process.exitCode = 1;
    return;
  }

  const child = spawn(process.execPath, [resolve(HERE, 'index.mjs'), ...passArgs], {
    stdio: 'inherit',
    env: { ...process.env, QZONE_COOKIE: cookie, QZONE_UIN: uin },
  });

  child.on('exit', async (code) => {
    if (code !== 0 && !dryRun) {
      await sendAlert(
        '【每日一言】今天的说说没发出去。\n' +
          '服务器上可以跑：bash /opt/qwotday/deploy/health.sh\n' +
          '日志：/var/log/qwotday.log',
      );
    }
    process.exitCode = code ?? 1;
  });
}

main();
