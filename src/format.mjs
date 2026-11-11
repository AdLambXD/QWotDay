// 日期与文案渲染
const MAX_POST_LENGTH = 900;

const CONTROL_CHARS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g;

function cleanInline(value, maxLength = 80) {
  const text = String(value ?? '')
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export function getDateParts(timeZone) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
  }).formatToParts(new Date());

  const valueOf = (type) => parts.find((part) => part.type === type)?.value || '';
  const year = valueOf('year');
  const month = valueOf('month');
  const day = valueOf('day');

  return {
    iso: `${year}-${month}-${day}`,
    display: `${year}年${Number(month)}月${Number(day)}日`,
    weekday: valueOf('weekday'),
  };
}

export function renderPost({ template, quote, tag, timeZone }) {
  const date = getDateParts(timeZone);
  const author = cleanInline(quote.fromWho);
  const source = cleanInline(quote.from);

  let attribution = '';
  if (author && source) attribution = `—— ${author}《${source}》`;
  else if (source) attribution = `—— ${source}`;
  else if (author) attribution = `—— ${author}`;

  const values = {
    date: date.display,
    weekday: date.weekday,
    quote: quote.text,
    author,
    source,
    attribution,
    tag: cleanInline(tag),
  };

  let text = template.replace(
    /\{(date|weekday|quote|author|source|attribution|tag)\}/g,
    (_, key) => values[key] ?? '',
  );

  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (text.length > MAX_POST_LENGTH) {
    text = `${text.slice(0, MAX_POST_LENGTH - 1)}…`;
  }

  return { text, date };
}
