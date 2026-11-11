#!/usr/bin/env node
// 本地校验 Cookie 是否仍然有效，不会发布任何内容
import { readConfig } from '../src/config.mjs';
import { cookieUin, hash33, inspectCookie, parseCookie } from '../src/qzone.mjs';

const config = readConfig();

if (!config.cookie) {
  console.error('❌ 没有找到 QZONE_COOKIE。');
  console.error('   请复制 .env.example 为 .env.local 并填写 Cookie，或先运行 npm run login。');
  process.exit(1);
}

const cookieMap = parseCookie(config.cookie);
const uin = config.uin || cookieUin(cookieMap);
const secret = cookieMap.get('p_skey') || cookieMap.get('skey') || '';

if (!uin) {
  console.error('❌ 无法从 Cookie 中解析 QQ 号，请设置 QZONE_UIN。');
  process.exit(1);
}

if (!secret) {
  console.error('❌ Cookie 中缺少 p_skey / skey。');
  console.error('   请从浏览器请求标头复制完整的 cookie（不要用 document.cookie，拿不到 HttpOnly）。');
  process.exit(1);
}

const gtk = hash33(secret);
console.log(`QQ：${uin}`);
console.log(`p_skey：${cookieMap.has('p_skey') ? '有' : '无（回落到 skey）'}`);
console.log(`g_tk：${gtk}`);
console.log('校验中…');

const result = await inspectCookie({ cookie: config.cookie, uin, gtk });

if (result.ok) {
  console.log('✅ Cookie 有效');
  console.log(`   qzonetoken：${result.qzonetoken ? '已获取' : '未获取（纯文字发布通常仍可用）'}`);
} else {
  console.error(`❌ Cookie 无效：${result.reason}`);
  console.error('   请重新运行 npm run login 或更新仓库 Secret QZONE_COOKIE。');
  process.exit(1);
}
