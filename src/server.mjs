#!/usr/bin/env node
// 云主机入口：从本机 NapCat 取空间 Cookie，再走一遍正常发布流程。
// 这样 Cookie 永远是新换的，不存在「过期」问题。
import { loadEnvFiles } from './config.mjs';
import { fetchNapCatCookie, NapCatError } from './napcat.mjs';

loadEnvFiles();

const dryRun = process.argv.includes('--dry') || process.env.DRY_RUN === '1';

try {
  const { cookie, uin, gtk, hasPSkey } = await fetchNapCatCookie();

  console.log(`🚀 NapCat 已就绪：QQ ${uin}（p_skey ${hasPSkey ? '有' : '缺失'}）`);
  console.log(`   g_tk=${gtk}`);

  // index.mjs 的 readConfig() 直接读 process.env，且 loadEnvFiles 不会覆盖已有变量
  process.env.QZONE_COOKIE = cookie;
  process.env.QZONE_UIN = uin;
  if (dryRun) process.env.DRY_RUN = '1';

  await import('./index.mjs');
} catch (error) {
  if (error instanceof NapCatError) {
    console.error(`\n❌ ${error.message}`);
    console.error('   排查：docker ps | grep napcat   然后 docker logs --tail 50 napcat');
  } else {
    console.error(`\n❌ ${error.message}`);
  }
  process.exitCode = 1;
}
