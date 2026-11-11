// QQ 空间 Web 接口：登录态解析、g_tk 计算、发说说、回读校验
const QZONE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const PUBLISH_URL =
  'https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_publish_v6';

const MSGLIST_URL =
  'https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6';

const CARD_URL =
  'https://h5.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/user/cgi_personal_card';

export class QzoneAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QzoneAuthError';
  }
}

/** 把浏览器里复制的 Cookie 头解析成 Map；同名 Cookie 以最后一个为准 */
export function parseCookie(cookieHeader) {
  const map = new Map();
  const normalized = String(cookieHeader || '').replace(/[\r\n]+/g, ' ');

  for (const part of normalized.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) map.set(name, value);
  }

  return map;
}

/** 从 uin / p_uin 中取出纯数字 QQ 号 */
export function cookieUin(cookieMap) {
  const raw = cookieMap.get('uin') || cookieMap.get('p_uin') || '';
  return String(raw).replace(/^o/i, '').replace(/\D/g, '');
}

/** QQ 空间 g_tk 算法（p_skey / skey → hash33） */
export function hash33(secret) {
  const input = String(secret || '');
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash += (hash << 5) + input.charCodeAt(i);
  }
  return hash & 0x7fffffff;
}

export function baseHeaders(cookie, uin, extra = {}) {
  const headers = {
    'user-agent': QZONE_UA,
    accept: 'application/json, text/javascript, */*; q=0.01',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    cookie,
  };

  if (uin) {
    headers.origin = 'https://user.qzone.qq.com';
    headers.referer = `https://user.qzone.qq.com/${uin}`;
  }

  return { ...headers, ...extra };
}

/** 响应可能是 JSON、JSONP（_Callback(...)）或夹了 HTML，尽量取出对象 */
export function parseJsonLoose(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function extractQzoneToken(html) {
  const text = String(html || '');
  const patterns = [
    /window\.g_qzonetoken\s*=\s*\(function\(\)\s*\{\s*try\s*\{\s*return\s+"([0-9a-fA-F]+)"/,
    /g_qzonetoken[^0-9a-fA-F]{0,40}([0-9a-fA-F]{40,})/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }

  return '';
}

function authErrorFrom(raw) {
  return /请先登录|未登录|登录态|登录已失效|not\s*login|login\s*required/i.test(
    String(raw || ''),
  );
}

function looksLikeLoginPage(raw) {
  return /ptlogin2|请先登录|QQ登录|登录已失效|<title>[^<]*登录/i.test(
    String(raw || ''),
  );
}

/**
 * 校验 Cookie 是否有效，并顺便取 qzonetoken。
 * 返回 { ok, qzonetoken, reason }
 */
export async function inspectCookie({ cookie, uin, gtk, timeoutMs = 20000 }) {
  try {
    const response = await fetch(`https://user.qzone.qq.com/${uin}`, {
      headers: baseHeaders(cookie, uin),
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });

    const html = await response.text();
    const qzonetoken = extractQzoneToken(html);
    if (qzonetoken) return { ok: true, qzonetoken };

    // 主页没拿到 token 时用资料卡二次确认，避免把「页面改版」误判成失效
    const cardResponse = await fetch(`${CARD_URL}?uin=${uin}&g_tk=${gtk}`, {
      headers: baseHeaders(cookie, uin),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const cardText = await cardResponse.text();
    const card = parseJsonLoose(cardText);

    if (authErrorFrom(cardText) || card?.code === -3000) {
      return { ok: false, qzonetoken: '', reason: 'Cookie 已失效（接口要求重新登录）' };
    }
    if (card?.code === 0 || card?.data) {
      return { ok: true, qzonetoken: '' };
    }

    return {
      ok: false,
      qzonetoken: '',
      reason: `未检测到登录态（主页 HTTP ${response.status}）`,
    };
  } catch (error) {
    return { ok: false, qzonetoken: '', reason: `网络错误：${error.message}` };
  }
}

/**
 * 发布一条纯文字说说。
 * 成功返回接口 JSON（含 tid），失败抛错；登录态问题抛 QzoneAuthError。
 */
export async function publishPost({ cookie, uin, text, gtk, qzonetoken, timeoutMs = 30000 }) {
  const url = new URL(PUBLISH_URL);
  url.searchParams.set('g_tk', String(gtk));
  if (qzonetoken) url.searchParams.set('qzonetoken', qzonetoken);

  const body = new URLSearchParams({
    syn_tweet_verson: '1',
    paramstr: '1',
    pic_template: '',
    richtype: '',
    richval: '',
    special_url: '',
    subrichtype: '',
    who: '1',
    con: text,
    feedversion: '1',
    ver: '1',
    ugc_right: '1',
    to_tweet: '0',
    to_sign: '0',
    hostuin: uin,
    code_version: '1',
    format: 'json',
    qzreferrer: `https://user.qzone.qq.com/${uin}`,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: baseHeaders(cookie, uin, {
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'x-requested-with': 'XMLHttpRequest',
      accept: 'application/json, text/javascript, */*; q=0.01',
    }),
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const raw = await response.text();
  const data = parseJsonLoose(raw);

  if (!data) {
    if (looksLikeLoginPage(raw)) {
      throw new QzoneAuthError('发布失败：登录态已失效（返回了登录页）');
    }
    throw new Error(`发布接口返回无法解析的内容：${raw.slice(0, 200) || '(空响应)'}`);
  }

  const code = Number(data.code ?? data.ret ?? 0);
  if (code === 0) return data;

  const message = String(data.message || data.msg || data.subcode || '').trim();
  if (code === -3000 || authErrorFrom(message)) {
    throw new QzoneAuthError(`发布失败：${message || '登录态已失效'}`);
  }

  throw new Error(`发布失败：${message || '未知错误'}（code=${code}）`);
}

function normalizeForMatch(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/[\u200b-\u200f\u2028\u2029\ufeff]/g, '')
    .replace(/\s+/g, '');
}

/**
 * 回读自己的说说列表，确认刚发的内容真的出现了。
 * 返回 { found, latest }
 */
export async function verifyPublished({
  cookie,
  uin,
  gtk,
  text,
  timeoutMs = 20000,
}) {
  const url = new URL(MSGLIST_URL);
  url.search = new URLSearchParams({
    uin,
    ftype: '0',
    sort: '0',
    pos: '0',
    num: '5',
    replynum: '0',
    g_tk: String(gtk),
    callback: '_preloadCallback',
    code_version: '1',
    format: 'jsonp',
    need_private_comment: '1',
  }).toString();

  const response = await fetch(url, {
    headers: baseHeaders(cookie, uin),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const raw = await response.text();
  const data = parseJsonLoose(raw);
  const list = Array.isArray(data?.msglist) ? data.msglist : [];
  const needle = normalizeForMatch(text).slice(0, 30);

  return {
    found: needle.length > 0 && list.some((item) => normalizeForMatch(item?.content).includes(needle)),
    latest: normalizeForMatch(list[0]?.content).slice(0, 60),
  };
}
