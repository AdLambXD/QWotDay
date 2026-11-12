// 在 Actions 日志里打印这张 Cookie 已经用了多久（用于统计实际寿命）
const minted = (process.env.COOKIE_MINTED_AT || '').trim();
const status = (process.env.JOB_STATUS || '').trim();
const at = Date.parse(minted);

const days = Number.isFinite(at) ? ((Date.now() - at) / 86400000).toFixed(2) : '未知';

console.log(`Cookie 换票时间：${minted || '(未记录)'}`);
console.log(`已存活：${days} 天`);
console.log(`本次任务：${status || '(未知)'}`);
