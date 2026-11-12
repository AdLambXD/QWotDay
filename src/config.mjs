// 配置读取：环境变量优先，其次 .env.local / .env
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const DEFAULT_TEMPLATE = `ヾ(•ω•\`)o | {shortDate} 一言

⌈  {quote}  ⌋

{attribution}`;

export const DEFAULT_TAG = '#每日一言';
export const DEFAULT_CATEGORIES = ['d', 'i', 'k'];

/**
 * 极简 dotenv：只支持 KEY=VALUE、# 注释和成对引号。
 * 已存在的环境变量优先级最高（GitHub Actions 的 Secrets / Variables 不会被 .env 覆盖）。
 */
export function loadEnvFiles(files = ['.env.local', '.env']) {
  for (const file of files) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;

    const content = readFileSync(path, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const eq = line.indexOf('=');
      if (eq <= 0) continue;

      const key = line.slice(0, eq).trim();
      if (!key || key in process.env) continue;

      let value = line.slice(eq + 1).trim();
      const quoted =
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"));
      if (quoted && value.length >= 2) value = value.slice(1, -1);

      process.env[key] = value;
    }
  }
}

function parseTemplate(raw) {
  const value = (raw || '').trim();
  if (!value) return DEFAULT_TEMPLATE;

  // 仓库 Variables 的输入框是单行的，允许用 \n 表示换行
  return value.replace(/\\n/g, '\n');
}

function parseCategories(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return [...DEFAULT_CATEGORIES];
  if (/^(all|\*)$/i.test(value)) return [];

  return value
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseTag(raw) {
  if (raw === undefined) return DEFAULT_TAG;

  const value = raw.trim();
  if (!value) return DEFAULT_TAG;
  if (value === '-') return '';
  return value;
}

function positiveNumber(raw, fallback, { allowZero = false } = {}) {
  if (raw === undefined || String(raw).trim() === '') return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  if (value < 0) return fallback;
  if (value === 0 && !allowZero) return fallback;
  return value;
}

export function readConfig() {
  loadEnvFiles();

  const dryRun = process.env.DRY_RUN === '1' || process.argv.includes('--dry');

  return {
    dryRun,
    cookie: (process.env.QZONE_COOKIE || '').trim(),
    uin: (process.env.QZONE_UIN || '').trim(),
    template: parseTemplate(process.env.POST_TEMPLATE),
    tag: parseTag(process.env.POST_TAG),
    categories: parseCategories(process.env.HITOKOTO_CATEGORIES),
    strictVerify:
      process.env.STRICT_VERIFY === 'true' || process.env.STRICT_VERIFY === '1',
    verifyDelayMs:
      positiveNumber(process.env.VERIFY_DELAY_SECONDS, 45, { allowZero: true }) * 1000,
    dedupeDays: positiveNumber(process.env.DEDUPE_DAYS, 30),
    timeZone: (process.env.TIMEZONE || 'Asia/Shanghai').trim(),
    statePath: (process.env.STATE_PATH || 'data/state.json').trim(),
  };
}
