// hitokoto 一言抓取：海外 runner 优先国际站，失败回落主站
const ENDPOINTS = [
  'https://international.v1.hitokoto.cn/',
  'https://v1.hitokoto.cn/',
];

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CONTROL_CHARS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g;

function clean(value, maxLength) {
  const text = String(value ?? '')
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function normalizeQuote(data) {
  if (!data || typeof data !== 'object') return null;

  const text = clean(data.hitokoto, 500);
  if (!text) return null;

  return {
    uuid: String(data.uuid || ''),
    text,
    from: clean(data.from, 80),
    fromWho: clean(data.from_who, 80),
    type: clean(data.type, 8),
  };
}

/**
 * 随机取一条一言。会尽量避开 excludeUuids 中最近发布过的 uuid。
 */
export async function fetchHitokoto({
  categories = [],
  excludeUuids = new Set(),
  maxAttempts = 3,
  timeoutMs = 15000,
} = {}) {
  const errors = [];
  let fallback = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    const url = new URL(endpoint);
    url.searchParams.set('encode', 'json');
    url.searchParams.set('charset', 'utf-8');
    for (const category of categories) url.searchParams.append('c', category);

    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const quote = normalizeQuote(await response.json());
      if (!quote) throw new Error('返回内容为空');

      fallback = quote;
      if (!excludeUuids.has(quote.uuid)) return quote;
    } catch (error) {
      errors.push(`${endpoint}：${error.message}`);
    }
  }

  // 全部命中重复时，宁可发一条重复的，也不要让当天的任务失败
  if (fallback) return fallback;

  throw new Error(`获取一言失败（已重试 ${maxAttempts} 次）\n${errors.join('\n')}`);
}
