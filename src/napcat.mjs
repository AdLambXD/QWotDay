// 从 NapCat（QQ NT 协议端）获取 QQ 空间 Cookie
// 文档：POST /get_cookies { domain } → { data: { cookies, bkn } }
// NapCat 需要 >= 4.18.0 才会返回 p_skey
import { hash33 } from './qzone.mjs';

const DEFAULT_DOMAIN = 'user.qzone.qq.com';

export class NapCatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NapCatError';
  }
}

function normalizeBaseUrl(raw) {
  return String(raw || 'http://127.0.0.1:3000').replace(/\/+$/, '');
}

/**
 * 向 NapCat 请求空间域的 Cookie。
 * 返回 { cookie, uin, gtk, raw }
 */
export async function fetchNapCatCookie({
  apiUrl = process.env.NAPCAT_API_URL,
  token = process.env.NAPCAT_TOKEN,
  domain = DEFAULT_DOMAIN,
  timeoutMs = 15000,
} = {}) {
  const base = normalizeBaseUrl(apiUrl);
  const url = `${base}/get_cookies`;

  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
  };
  const trimmed = String(token || '').trim();
  if (trimmed) headers.authorization = `Bearer ${trimmed}`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ domain }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new NapCatError(
      `连不上 NapCat（${url}）：${error.message}。请确认容器在运行、端口和 NAPCAT_API_URL 正确。`,
    );
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new NapCatError(
      `NapCat 返回的不是 JSON（HTTP ${response.status}）：${text.slice(0, 200)}`,
    );
  }

  const status = String(payload?.status || '');
  const retcode = Number(payload?.retcode ?? 0);
  if (status === 'failed' || retcode !== 0) {
    throw new NapCatError(
      `NapCat 拒绝请求：${payload?.message || payload?.wording || `retcode=${retcode}`}（HTTP ${response.status}）`,
    );
  }

  const cookies = String(payload?.data?.cookies || '').trim();
  if (!cookies) {
    throw new NapCatError('NapCat 返回的 Cookie 为空，可能还没登录 QQ 或版本太低（需 >= 4.18.0）。');
  }

  const map = new Map();
  for (const part of cookies.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) map.set(name, value);
  }

  const uin = String(map.get('uin') || map.get('p_uin') || '')
    .replace(/^o/i, '')
    .replace(/\D/g, '');

  if (!uin) throw new NapCatError('NapCat 返回的 Cookie 里没有 uin（可能未登录 QQ）');

  const secret = map.get('p_skey') || map.get('skey') || '';
  if (!secret) {
    throw new NapCatError(
      'Cookie 里没有 p_skey，无法计算 g_tk。请把 NapCat 升级到 4.18.0 以上再试。',
    );
  }

  return {
    cookie: cookies,
    uin,
    gtk: hash33(secret),
    hasPSkey: map.has('p_skey'),
  };
}
