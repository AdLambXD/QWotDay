# QWotDay

每天自动把 [hitokoto.cn](https://hitokoto.cn/) 的「每日一言」发到 QQ 空间说说。

- 完全免费：GitHub Actions + hitokoto 公共 API，不需要服务器、不需要付费接口
- 零依赖运行：Node.js 20 内置 `fetch`，Actions 里不用 `npm install`
- 可配置文案：日期、出处、话题标签、一言分类都能改
- 发布后回读校验：接口说成功不算数，会去说说列表确认真的发出来了
- Cookie 失效会明确报错，GitHub 会发失败邮件提醒

效果示例：

```text
ヾ(•ω•`)o | 26年11月11日 一言

⌈  经历这种痛苦的人，我一个就够了！  ⌋

——莲华《美少女万华镜·理与迷宫的少女》
```

![workflow](https://github.com/AdLambXD/QWotDay/actions/workflows/daily-qzone.yml/badge.svg)

---

## 工作方式

```text
GitHub Actions 定时触发
        │
        ├─ 取一言（international.v1.hitokoto.cn → v1.hitokoto.cn 回落，自动重试）
        ├─ 用 Cookie 里的 p_skey 计算 g_tk
        ├─ 打开空间主页取 qzonetoken
        ├─ POST emotion_cgi_publish_v6 发布说说
        ├─ 等 45 秒回读 emotion_cgi_msglist_v6 校验
        └─ 把记录写进 data/state.json 并提交回仓库
```

`data/state.json` 的作用有两个：一是避免 30 天内重复发同一句，二是每天产生一次提交，防止公共仓库 60 天无活动后定时任务被 GitHub 自动禁用。

### 项目结构

```text
src/index.mjs      主流程
src/server.mjs     云主机入口（从 NapCat 取 Cookie 后走同一套流程）
src/napcat.mjs     NapCat /get_cookies 封装
src/qzone.mjs      Cookie / g_tk / 发布 / 回读
src/hitokoto.mjs   一言抓取
src/format.mjs     日期与文案模板
src/config.mjs     环境变量与 .env 读取
scripts/login.mjs  Playwright 扫码登录（备选）
scripts/mint.mjs   从本机 QQ 客户端换票
scripts/check.mjs  本地校验 Cookie
deploy/            云主机部署（Docker + NapCat + cron）
data/state.json    发布记录
```

## 已知限制（请先读）

1. **Cookie 会过期，且无法自动续期。** QQ 空间的网页登录态（`p_skey` / `skey`）不提供刷新接口，`p_skey` 通常能维持数周，`skey` 更短。失效后 Action 会失败并给你发邮件，重新获取一次 Cookie 即可（约 1 分钟）。
2. **机房 IP 有风控风险。** GitHub 的 runner 在海外机房，QQ 可能要求验证或直接拒绝登录态。建议先用**小号**试跑一两周，每天只发 1 条、纯文字。
3. **定时不是精确的。** GitHub 官方说明 `schedule` 可能延迟，极端情况下会丢弃当次运行；工作流里已经加了 0–10 分钟随机延迟和上报失败。
4. **公共仓库 60 天无提交会禁用定时任务。** 本项目每天提交 `data/state.json`，正常使用不会触发；如果你长时间停用，记得回来点一下 Enable。

如果上面第 1、2 条无法接受，用下面的 **B 方案**。

---

## 两种部署方式

| | **A. GitHub Actions** | **B. 云主机 + NapCat**（当前采用） |
| --- | --- | --- |
| 谁在发帖 | GitHub 的服务器 | 你自己的云主机 |
| 登录态 | Cookie，会过期，要手动/半自动续 | NapCat 常驻在线，**每次现取现用，不会过期** |
| 电脑要开着吗 | 偶尔开一次换票就行 | **完全不用** |
| 成本 | 免费 | 免费（有台能常开的机器就行） |
| 门槛 | 复制一次 Cookie | 会 SSH，约 40 分钟一次性配置 |

**B 方案**见 **[deploy/README.md](deploy/README.md)**。它同时把 A 方案当作备用：云主机每天把新
Cookie 同步到 Secret，Actions 在 12:17 检查「今天发过没有」，发过就跳过、没发才补发。
下面第 1~5 节是 **A 方案**的完整步骤，在没有服务器时仍然可用。

---

## 快速开始

### 0. 准备

- 一个 QQ 号（**建议小号**）
- 你自己的这个仓库（Fork 或直接使用）

> Fork 的仓库默认不会运行定时任务，而且拿不到原仓库的 Secrets。需要先在 Actions 页面点一次 **Enable workflow**，再按下面的步骤配置你自己的 Secrets。

### 1. 获取 Cookie

1. 用 Chrome / Edge 登录 <https://user.qzone.qq.com/>，确认能正常进入自己的空间。
2. 按 `F12` 打开开发者工具，切到 **Network（网络）**，刷新页面。
3. 在请求列表里点任意一个 `user.qzone.qq.com` 的请求（例如 `feeds_html_act_all`、`cgi_personal_card`、`emotion_cgi_msglist_v6`）。
4. 右侧 **Headers（标头）→ Request Headers（请求标头）**，找到 `cookie:` 这一行，**复制整行的值**。
5. 复制出来应该类似：

   ```text
   uin=o0123456789; skey=@AbCdEf123; p_skey=xxxxxxxx; pt4_token=xxxxxxxx
   ```

> ⚠️ 一定要从**请求标头**复制，不要用控制台里的 `document.cookie`——`p_skey` 是 HttpOnly，`document.cookie` 取不到。
>
> `uin` 带 `o` 前缀没关系，脚本会自动处理。
>
> 整行长度通常有 300 字符以上；如果只有几十个字符，说明没复制全。

### 2. 配置 Secret

仓库页面 → **Settings → Secrets and variables → Actions → New repository secret**：

| 名称 | 必填 | 内容 |
| --- | --- | --- |
| `QZONE_COOKIE` | ✅ | 上一步复制的整行 Cookie |
| `QZONE_UIN` | 可选 | QQ 号；Cookie 里能解析出来就不用填 |

### 3. 配置 Variables（可选）

同一页面的 **Variables** 标签：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `POST_TEMPLATE` | 见下方 | 文案模板，用 `\n` 表示换行（因为输入框是单行的） |
| `POST_TAG` | `#每日一言` | 话题标签；只有模板里写了 `{tag}` 才会出现，填 `-` 表示不显示 |
| `HITOKOTO_CATEGORIES` | `d,i,k` | 一言分类，逗号分隔；`all` 表示不限 |
| `STRICT_VERIFY` | `false` | 回读校验失败时是否让任务报错 |

默认模板（实际是多行）：

```text
ヾ(•ω•`)o | {shortDate} 一言

⌈  {quote}  ⌋

{attribution}
```

效果：

```text
ヾ(•ω•`)o | 26年11月12日 一言

⌈  儿童散学归来早，忙趁东风放纸鸢  ⌋

——高鼎《村居》
```

单行写法：

```text
ヾ(•ω•`)o | {shortDate} 一言\n\n⌈  {quote}  ⌋\n\n{attribution}
```

可用占位符：

| 占位符 | 含义 | 示例 |
| --- | --- | --- |
| `{shortDate}` | 两位年份的日期 | `26年11月12日` |
| `{date}` | 完整日期 | `2026年11月12日` |
| `{weekday}` | 星期 | `星期三` |
| `{quote}` | 一言正文 | `经历这种痛苦的人……` |
| `{author}` | 作者 | `莲华` |
| `{source}` | 出处 | `美少女万华镜·理与迷宫的少女` |
| `{attribution}` | 完整的「——作者《出处》」，缺失部分自动省略 | `——高鼎《村居》` |
| `{tag}` | 话题标签 | `#每日一言` |

一言分类：`a` 动画、`b` 漫画、`c` 游戏、`d` 文学、`e` 原创、`f` 来自网络、`g` 其他、`h` 影视、`i` 诗词、`j` 网易云、`k` 哲学、`l` 抖机灵。

### 4. 先演练一次

仓库 → **Actions → 每日一言 · QQ空间 → Run workflow**，勾选 `dry_run`。

演练会：抓一条一言、渲染文案、校验 Cookie，但**不会发布**。日志里能看到最终文案和 Cookie 状态。

### 5. 正式发布

再点一次 **Run workflow**，这次不勾 `dry_run`。成功后去 QQ 空间确认。

之后每天北京时间 07:17 左右会自动发布（GitHub 可能延迟几分钟到十几分钟）。

---

## 配置项

除了上表的 Variables，脚本还支持这些本地环境变量（`.env.local` 或 Actions `env`）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `TIMEZONE` | `Asia/Shanghai` | 日期使用的时区 |
| `DEDUPE_DAYS` | `30` | 多少天内不重复同一句 |
| `VERIFY_DELAY_SECONDS` | `45` | 发布后等多久回读校验，设 `0` 跳过 |
| `STATE_PATH` | `data/state.json` | 发布记录路径 |
| `DRY_RUN` | 空 | 设为 `1` 等同 `--dry` |

修改发布时间：编辑 `.github/workflows/daily-qzone.yml` 里的 `cron`。注意是 **UTC**，北京时间减 8 小时，例如 `17 23 * * *` = 次日 07:17。

---

## 本地使用

需要 Node.js 20+。

```bash
# 1. 演练（不需要 Cookie 也能看文案）
npm run dry

# 2. 校验 Cookie
npm run check

# 3. 立即发布一条（谨慎）
npm run post
```

### 自动续期（推荐）：从本机 QQ 客户端换票

QQ 桌面端登录后会在 `4300-4308` 上开一个本地服务，可以从中取到 `clientkey`（即 a2），再走
`ssl.ptlogin2.qq.com/jump` → `check_sig` 换出带 `p_skey` 的空间 Cookie。

```bash
# 写入 .env.local（需要 QQ 桌面端正在运行并已登录）
npm run refresh

# 同时更新仓库 Secret（需要 GitHub CLI：gh auth login）
npm run refresh -- --push
```

实测结论：

- `clientkey` **绑定客户端在线状态**，QQ 退出后再换票会返回 `code 69：QQ客户端已经下线`；所以「把 a2 存进 Actions 天天换票」不可行。
- 但**已经换出来的 Cookie 在 QQ 退出后仍然有效**，因此只需要在 QQ 在线时定期刷新一次 Secret。
- **切换或退出该账号会让此前换出的 Cookie 失效**：换票脚本会校验当前登录的 QQ 是否等于 `.env.local` 里的 `QZONE_UIN`，不一致就直接报错，不会把别的号悄悄推到仓库。

Windows 上可以一键注册计划任务（开机 2 分钟后 + 每 6 小时执行一次）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1
```

日志在 `logs\refresh.log`。PC 关机期间不影响 Actions 发帖，用的是上一次换到的 Cookie。

### 备选：Playwright 扫码登录

```bash
npm install
npx playwright install chromium
npm run login            # 扫码后写入 .env.local
npm run login -- --push  # 顺带更新 Secret
```

适合没有装 QQ 桌面端的机器。注意浏览器会话的 Cookie 更容易被 QQ 风控下线，不如上面的客户端换票稳定。

> 国内网络下载 Chromium 很慢时，可以先设置镜像再安装：
>
> ```powershell
> $env:PLAYWRIGHT_DOWNLOAD_HOST='https://npmmirror.com/mirrors/playwright'
> npx playwright install chromium
> ```

---

## 常见问题

**Q：日志提示「Cookie 已失效」或接口返回 `请先登录` / `code=-3000`？**
Cookie 过期了。重新获取一次：

```bash
npm run login -- --push
```

或者手动复制 Cookie 更新 `QZONE_COOKIE` Secret。

**Q：发布返回成功，但空间里看不到？**
可能进入了审核，或者被风控。等几分钟再看；也可以把 `STRICT_VERIFY` 设为 `true`，让任务在回读失败时直接报错提醒你。

**Q：定时任务没有按时跑？**
GitHub 的 cron 是 UTC 且允许延迟；整点最拥堵，所以本项目用了 `23:17 UTC`。另外确认：
- 工作流文件在**默认分支**上
- 仓库 60 天内有过提交（本项目每天会提交状态文件）
- Actions 页面里工作流是启用状态

**Q：提示 `Resource not accessible by integration` 或提交状态失败？**
仓库 **Settings → Actions → General → Workflow permissions** 选择 **Read and write permissions**。

**Q：能发图片吗？**
当前只发纯文字。带图需要额外调用图片上传接口，稳定性也更差，暂未实现。

**Q：Cookie 能自动续期吗？**
可以，但需要一台装着 QQ 桌面端的机器偶尔在线：`npm run refresh -- --push`（或计划任务 `scripts\install-task.ps1`）会在 QQ 在线时换出新 Cookie 并更新 Secret。腾讯没有提供纯服务端的续期接口，`clientkey`(a2) 绑定客户端在线状态，所以无法做到「只存一个密钥在云端自动续期」。

**Q：会不会封号？**
有概率触发风控，所以建议：用小号、每天 1 条、纯文字、不要短时间反复重试。本项目已经做了随机延迟和失败重试上限。

**Q：`data/state.json` 每天都在变，很烦？**
它是去重记录，同时负责让仓库保持活跃（避免 60 天后定时任务被禁用）。如果不需要，可以删掉工作流里的「记录发布状态」步骤。

---

## 安全说明

- `QZONE_COOKIE` **只存放在 GitHub Actions Secrets**，不会进入 Git 仓库内容，`git clone`、Fork、公开网页和 API 都拿不到；Secrets 加密存储且创建后不可读回。
- 但公共仓库的 **Actions 日志是公开的**，所以代码里绝不打印 Cookie（本项目只输出 QQ 号和 `g_tk`）。如果你修改代码，请保持这个约定。
- 有仓库写权限的人可以修改 workflow 读取 Secret。请开启 2FA，不要随意给别人写权限；不要在 Issue、PR、截图中粘贴 Cookie。
- 如果你连“密钥存在公共仓库的 Secrets 设置里”都不接受，可以把仓库转成 Private，或改用「公共代码仓 + 私有运行仓」模式；私有仓库同样有每月 2000 分钟的免费额度，本项目只消耗约 45 分钟/月。
- Cookie 等同账号登录凭证，**不要**提交到仓库、截图或发给别人。怀疑泄露时，去 QQ 安全中心退出所有设备，Cookie 会立即失效。
- Fork 无法读取原仓库的 Secrets。
- 本项目与腾讯无关，使用风险自负，建议不要用主号。

## 备选方案

如果 GitHub Actions 的机房 IP 一直触发风控，可以换成：

**Oracle Cloud Always Free（永久免费 ARM 机器）+ NapCat**

NapCat 在本机登录 QQ 后，插件可以直接通过 `get_cookies` 拿到最新的 QQ 空间 Cookie，做到真正的自动续期；代价是需要一台常开的机器和稍多的部署工作。

## License

[MIT](./LICENSE)
