#!/usr/bin/env node
// 把 NapCat 当前的空间 Cookie 同步到 GitHub Actions Secret（作为备用通道）
// 用法：node scripts/push-secret.mjs [--force]
// 需要：服务器上已 gh auth login，且 GITHUB_REPO=owner/repo
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { loadEnvFiles } from '../src/config.mjs';
import { fetchNapCatCookie, NapCatError } from '../src/napcat.mjs';
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

main().catch((error) => {
  if (error instanceof NapCatError) {
    console.error(`❌ ${error.message}`);
  } else {
    console.error(`❌ ${error.message}`);
  }
  process.exitCode = 1;
});
