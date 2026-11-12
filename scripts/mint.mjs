#!/usr/bin/env node
// 本地换票：从已登录的 QQ NT 客户端取 clientkey(a2)，换取 QQ 空间 Cookie
//   1) 写入 .env.local（本地测试 / 手动发帖用）
//   2) 加 --push 时同步到 GitHub Actions Secret（需要 GitHub CLI：gh auth login）
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import { resolve } from 'node:path';

import { parseCookie, hash33, inspectCookie } from '../src/qzone.mjs';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const XLOGIN =
  'https://xui.ptlogin2.qq.com/cgi-bin/xlogin?proxy_url=https%3A//qzs.qq.com/qzone/v6/portal/proxy.html&daid=5' +
  '&hide_title_bar=1&low_login=0&qlogin_auto_login=1&no_verifyimg=1&link_target=blank' +
  '&appid=549000912&style=22&target=self' +
  '&s_url=https%3A%2F%2Fqzs.qzone.qq.com%2Fqzone%2Fv5%2Floginsucc.html%3Fpara%3Dizone' +
  '&pt_qr_app=%E6%89%8B%E6%9C%BAQQ%E7%A9%BA%E9%97%B4&pt_no_auth=1';

// 换票后要保留的 Cookie；顺序影响可读性，不影响功能
const KEEP_COOKIES = ['uin', 'p_uin', 'skey', 'p_skey', 'pt4_token', 'pt2gguin', 'RK', 'ptcz', 'airkey'];

const LOCAL_PORTS = [4300, 4301, 4302, 4303, 4304, 4305, 4306, 4307, 4308];

/**
 * 简化 Cookie 罐：同名 Cookie 按域区分。
 * QQ 的 check_sig 会同时下发 p_skey@qzone.qq.com（有效）和 p_skey@qq.com（删除指令），
 * 如果只按名字覆盖，就会把有效值删掉。
 */
class CookieJar {
  constructor() {
    this.store = new Map(); // name -> { value, domain }
  }

  apply(setCookies = []) {
    for (const raw of setCookies) {
      const parts = raw.split(';').map((item) => item.trim());
      const eq = parts[0].indexOf('=');
      if (eq <= 0) continue;

      const name = parts[0].slice(0, eq).trim();
      const value = parts[0].slice(eq + 1).trim();

      let domain = '';
      let expired = false;
      for (const attr of parts.slice(1)) {
        const lower = attr.toLowerCase();
        if (lower.startsWith('domain=')) domain = attr.slice(7).replace(/^\./, '').toLowerCase();
        if (lower.startsWith('max-age=')) expired = Number(attr.slice(8)) <= 0;
        if (lower.startsWith('expires=')) {
          const at = Date.parse(attr.slice(8));
          if (Number.isFinite(at) && at < Date.now()) expired = true;
        }
      }

      const previous = this.store.get(name);

      if (expired || value === '') {
        // 只删除同域的旧值，别的域不受影响
        if (previous && (!domain || previous.domain === domain)) this.store.delete(name);
        continue;
      }

      this.store.set(name, { value, domain });
    }
  }

  get(name) {
    return this.store.get(name)?.value || '';
  }

  header(names) {
    return names
      .map((name) => (this.store.has(name) ? `${name}=${this.store.get(name).value}` : ''))
      .filter(Boolean)
      .join('; ');
  }
}

function log(message) {
  console.log(message);
}

/** 请求远程接口，自动收集 Set-Cookie */
async function fetchWithJar(jar, url, { referer = '', cookieNames = [] } = {}) {
  const headers = {
    'user-agent': USER_AGENT,
    accept: 'text/html,application/javascript,*/*;q=0.8',
    'accept-language': 'zh-CN,zh;q=0.9',
    'accept-encoding': 'identity',
  };
  if (referer) headers.referer = referer;

  const cookie = jar.header(cookieNames);
  if (cookie) headers.cookie = cookie;

  const response = await fetch(url, { headers, redirect: 'manual' });
  const setCookies = response.headers.getSetCookie?.() || [];
  jar.apply(setCookies);

  return {
    status: response.status,
    location: response.headers.get('location'),
    text: await response.text(),
  };
}

/** QQ 客户端在 4300-4308 上开的本地 https 服务，证书是自签的 */
function requestLocal(port, path, token) {
  return new Promise((resolvePromise) => {
    const request = https.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'GET',
        rejectUnauthorized: false,
        servername: 'localhost.ptlogin2.qq.com',
        headers: {
          host: `localhost.ptlogin2.qq.com:${port}`,
          referer: 'https://xui.ptlogin2.qq.com/',
          'user-agent': USER_AGENT,
          accept: '*/*',
          cookie: `pt_local_token=${token}`,
        },
        timeout: 4000,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolvePromise({
            status: response.statusCode,
            setCookies: response.headers['set-cookie'] || [],
            text: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );

    request.on('error', () => resolvePromise({ status: 0, setCookies: [], text: '' }));
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.end();
  });
}

async function findLocalQQ(preferredUin) {
  const jar = new CookieJar();
  const loginPage = await fetchWithJar(jar, XLOGIN, { referer: 'https://qzs.qq.com/' });
  const token = jar.get('pt_local_token');
  if (!token) throw new Error(`无法获取 pt_local_token（xlogin ${loginPage.status}）`);

  for (const port of LOCAL_PORTS) {
    const result = await requestLocal(port, `/pt_get_uins?callback=ptui_getuins_CB&r=0.1&pt_local_tk=${token}`, token);
    if (!result.text?.includes('"uin"')) continue;

    const uins = [...result.text.matchAll(/"uin":(\d+)/g)].map((match) => match[1]);
    if (uins.length === 0) continue;

    const uin = preferredUin && uins.includes(preferredUin) ? preferredUin : uins[0];
    return { port, token, uin, uins, jar };
  }

  return null;
}

async function mintCookie(preferredUin) {
  const local = await findLocalQQ(preferredUin);
  if (!local) {
    throw new Error(
      '没有找到本机 QQ 的快捷登录服务。请确认 QQ 已启动并登录（托盘图标在运行），再试一次。',
    );
  }

  const { port, token, uin, uins, jar } = local;
  log(`检测到 QQ 客户端：端口 ${port}，已登录账号 ${uins.join(' / ')}`);

  const st = await requestLocal(
    port,
    `/pt_get_st?clientuin=${uin}&callback=ptui_getst_CB&r=0.2&pt_local_tk=${token}`,
    token,
  );
  jar.apply(st.setCookies);

  const clientkey = jar.get('clientkey');
  if (!clientkey) throw new Error('没有取到 clientkey（QQ 可能刚启动，稍等几秒再试）');
  log(`clientkey：${clientkey.length} 位`);

  const jumpUrl =
    `https://ssl.ptlogin2.qq.com/jump?ptlang=1033&clientuin=${uin}&clientkey=${clientkey}` +
    `&u1=${encodeURIComponent(`https://user.qzone.qq.com/${uin}/infocenter`)}&keyindex=19&pt_3rd_aid=0&ptopt=1&style=40`;

  const jump = await fetchWithJar(jar, jumpUrl, {
    referer: 'https://user.qzone.qq.com/',
    cookieNames: KEEP_COOKIES,
  });

  const checkUrl = (jump.text.match(/_CB\('0',\s*'(http[^']+)'/) || [])[1] || '';
  if (!checkUrl) {
    const reason = (jump.text.match(/_CB\('\d+',\s*'[^']*',\s*'([^']*)'/) || [])[1] || '';
    throw new Error(`换票失败：${reason || `HTTP ${jump.status} ${jump.location || ''}`.trim()}`);
  }

  await fetchWithJar(jar, checkUrl, {
    referer: 'https://qzs.qzone.qq.com/qzone/v5/loginsucc.html?para=izone',
    cookieNames: KEEP_COOKIES,
  });

  const cookie = KEEP_COOKIES.filter((name) => jar.get(name))
    .map((name) => `${name}=${jar.get(name)}`)
    .join('; ');

  if (!jar.get('p_skey')) throw new Error('换票成功但没有拿到 p_skey');
  return { uin, cookie };
}

/** 校验换到的 Cookie 是否真能进空间 */
async function verify({ uin, cookie }) {
  const map = parseCookie(cookie);
  const gtk = hash33(map.get('p_skey') || map.get('skey'));
  return inspectCookie({ cookie, uin, gtk });
}

function writeEnvLocal({ uin, cookie }) {
  const path = resolve('.env.local');
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : [];
  const kept = lines.filter(
    (line) => line.trim() && !/^QZONE_(COOKIE|UIN)\s*=/.test(line.trim()) && !line.startsWith('# 由'),
  );

  const content = [
    '# 由 npm run refresh 生成，请勿提交到仓库',
    `QZONE_COOKIE="${cookie}"`,
    `QZONE_UIN=${uin}`,
    ...kept,
    '',
  ].join('\n');

  writeFileSync(path, content, 'utf8');
  return path;
}

function remoteRepo() {
  const result = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' });
  if (result.status !== 0) return '';
  const match = String(result.stdout || '')
    .trim()
    .match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return match ? match[1] : '';
}

function resolveGh() {
  const candidates = [
    process.env.GH_PATH,
    'C:/Program Files/GitHub CLI/gh.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/GitHubCLI/gh.exe` : '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  const where = spawnSync('where.exe', ['gh'], { encoding: 'utf8' });
  const first = String(where.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)[0];

  return where.status === 0 && first && existsSync(first) ? first : '';
}

function pushSecret(ghPath, repo, name, value) {
  // gh 2.x 的 secret set 从 stdin 读取值（没有 --body-file 参数）
  const result = spawnSync(ghPath, ['secret', 'set', name, '--repo', repo], {
    input: value,
    encoding: 'utf8',
  });

  if (result.error || result.status !== 0) {
    const detail = (result.stderr || result.error?.message || '').trim();
    if (detail) console.error(`   gh: ${detail}`);
    return false;
  }
  return true;
}

/** 记录本次换票时间，用于统计这张 Cookie 实际能活多久 */
function markMintedAt(ghPath, repo) {
  const result = spawnSync(
    ghPath,
    ['variable', 'set', 'COOKIE_MINTED_AT', '--repo', repo, '--body', new Date().toISOString()],
    { encoding: 'utf8' },
  );

  if (result.error || result.status !== 0) {
    const detail = (result.stderr || result.error?.message || '').trim();
    if (detail) console.error(`   gh: ${detail}`);
    return false;
  }
  return true;
}

async function main() {
  const push = process.argv.includes('--push');
  const preferredUin = (process.env.QZONE_UIN || '').replace(/\D/g, '');

  log('→ 正在从本机 QQ 客户端换取空间 Cookie…');
  const { uin, cookie } = await mintCookie(preferredUin);
  log(`✅ 已换取：QQ ${uin}（${cookie.length} 字符）`);

  const check = await verify({ uin, cookie });
  if (!check.ok) {
    throw new Error(`换到的 Cookie 校验失败：${check.reason}`);
  }
  log('✅ 校验通过');

  const envPath = writeEnvLocal({ uin, cookie });
  log(`✅ 已写入 ${envPath}`);

  if (!push) {
    log('\n下一步：npm run refresh -- --push 可同步到 GitHub Secret');
    return;
  }

  const repo = process.env.GITHUB_REPOSITORY || remoteRepo();
  if (!repo) throw new Error('没有检测到 GitHub 仓库（git remote origin）');

  const ghPath = resolveGh();
  if (!ghPath) {
    log('⚠️  未安装 GitHub CLI，无法自动更新 Secret。');
    log('   安装后执行一次 gh auth login，再运行：npm run refresh -- --push');
    log(`   或手动更新：https://github.com/${repo}/settings/secrets/actions`);
    return;
  }

  if (!pushSecret(ghPath, repo, 'QZONE_COOKIE', cookie)) {
    throw new Error('写入 Secret QZONE_COOKIE 失败（gh 可能未登录：gh auth login）');
  }
  pushSecret(ghPath, repo, 'QZONE_UIN', uin);
  markMintedAt(ghPath, repo);
  log(`✅ 已更新仓库 Secret：${repo}`);
}

main().catch((error) => {
  console.error(`\n❌ ${error.message}`);
  // 定时任务里 QQ 没开是正常情况，不当作错误退出（避免任务计划里满屏失败）
  process.exitCode = /QQ 已启动|clientkey|快捷登录服务/.test(error.message) ? 0 : 1;
});
