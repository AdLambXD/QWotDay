#!/usr/bin/env node
// 本地扫码登录 QQ 空间，生成 Cookie 并写入 .env.local（可选同步到 GitHub Secret）
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cookieUin, hash33, inspectCookie, parseCookie } from '../src/qzone.mjs';

const WANTED_COOKIES = ['uin', 'p_uin', 'skey', 'p_skey', 'pt4_token', 'pt2gguin'];
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

async function loadChromium() {
  try {
    const { chromium } = await import('playwright');
    return chromium;
  } catch {
    return fail(
      '未安装 playwright。请先运行：\n  npm install\n  npx playwright install chromium',
    );
  }
}

function domainScore(domain) {
  if (domain === 'user.qzone.qq.com') return 3;
  if (domain.endsWith('qzone.qq.com')) return 2;
  if (domain.endsWith('qq.com')) return 1;
  return 0;
}

function pickCookies(cookies) {
  const picked = new Map();

  for (const cookie of cookies) {
    if (!cookie.value || !WANTED_COOKIES.includes(cookie.name)) continue;
    const previous = picked.get(cookie.name);
    if (!previous || domainScore(cookie.domain) >= domainScore(previous.domain)) {
      picked.set(cookie.name, cookie);
    }
  }

  return picked;
}

function buildCookieString(picked) {
  return [...picked.entries()]
    .sort((a, b) => WANTED_COOKIES.indexOf(a[0]) - WANTED_COOKIES.indexOf(b[0]))
    .map(([name, cookie]) => `${name}=${cookie.value}`)
    .join('; ');
}

function remoteRepo() {
  const result = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' });
  if (result.status !== 0) return '';

  const match = String(result.stdout || '')
    .trim()
    .match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return match ? match[1] : '';
}

function pushSecret(repo, name, value) {
  const result = spawnSync(
    'gh',
    ['secret', 'set', name, '--repo', repo, '--body-file', '-'],
    { input: value, stdio: ['pipe', 'inherit', 'inherit'] },
  );

  return !result.error && result.status === 0;
}

const chromium = await loadChromium();
const profileDir = resolve('.qzone-auth/profile');
mkdirSync(profileDir, { recursive: true });

console.log('正在启动浏览器…');
console.log('请在弹出的窗口里用手机 QQ 扫码登录 QQ 空间（也支持账号密码）。');

let context = null;

try {
  context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    locale: 'zh-CN',
    viewport: { width: 1280, height: 860 },
  });
} catch (error) {
  fail(
    `启动浏览器失败：${error.message}\n如果是第一次使用，请先运行：npx playwright install chromium`,
  );
}

try {
  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://user.qzone.qq.com/', { waitUntil: 'domcontentloaded' });

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let cookieString = '';
  let uin = '';

  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);

    const cookies = await context.cookies([
      'https://user.qzone.qq.com',
      'https://qzone.qq.com',
      'https://qzs.qq.com',
    ]);

    const picked = pickCookies(cookies);
    if (!picked.get('p_skey')) continue;

    const candidate = buildCookieString(picked);
    const candidateUin = cookieUin(parseCookie(candidate));
    if (!candidateUin) continue;

    const gtk = hash33(picked.get('p_skey').value);
    const check = await inspectCookie({ cookie: candidate, uin: candidateUin, gtk });
    if (!check.ok) continue;

    cookieString = candidate;
    uin = candidateUin;
    break;
  }

  if (!cookieString) {
    fail('5 分钟内没有检测到有效登录态，请重试。');
  }

  const envPath = resolve('.env.local');
  const escapedCookie = cookieString.replace(/"/g, '\\"');
  writeFileSync(
    envPath,
    [
      '# 由 npm run login 生成，请勿提交到仓库',
      `QZONE_COOKIE="${escapedCookie}"`,
      `QZONE_UIN=${uin}`,
      '',
    ].join('\n'),
    'utf8',
  );

  mkdirSync(resolve('.qzone-auth'), { recursive: true });
  writeFileSync(
    resolve('.qzone-auth/cookies.json'),
    `${JSON.stringify({ savedAt: new Date().toISOString(), uin, cookie: cookieString }, null, 2)}\n`,
    'utf8',
  );

  console.log(`\n✅ 登录成功：${uin}`);
  console.log('   已写入 .env.local（该文件已被 .gitignore 忽略）');
  console.log(`   Cookie 长度：${cookieString.length}`);

  if (process.argv.includes('--push')) {
    const repo = process.env.GITHUB_REPOSITORY || remoteRepo();

    if (!repo) {
      console.log('\n⚠️  没有检测到 GitHub 仓库，跳过自动写入 Secret。');
    } else if (!pushSecret(repo, 'QZONE_COOKIE', cookieString)) {
      console.log('\n⚠️  自动写入 Secret 失败（可能未安装或未登录 gh）。');
      console.log(`   请手动更新：https://github.com/${repo}/settings/secrets/actions`);
      console.log('   值见 .env.local 中的 QZONE_COOKIE。');
    } else {
      pushSecret(repo, 'QZONE_UIN', uin);
      console.log(`\n✅ 已更新仓库 Secret：${repo}`);
    }
  } else {
    console.log('\n下一步：');
    console.log('  本地测试：npm run dry');
    console.log('  同步到仓库 Secret：npm run login -- --push（需要先安装并登录 GitHub CLI）');
    console.log('  或手动把 .env.local 里的 QZONE_COOKIE 粘贴到仓库 Secrets。');
  }
} finally {
  if (context) await context.close();
}
