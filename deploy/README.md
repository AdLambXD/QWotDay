# 云主机部署（方案 B：Oracle Cloud 永久免费 + NapCat）

这套方案把「小号」挂在云主机上 7×24 在线，机器人 **直接在云上发帖**，不再需要 GitHub Secrets、
不再有 Cookie 过期问题，也不再占用你的电脑。

```text
Oracle 云主机（永久免费）
├─ NapCat（QQ NT 协议端）── 小号 2707908134 一直在线
└─ cron 每天 07:17 ── node src/server.mjs
                          ├─ POST 127.0.0.1:3000/get_cookies  ← 现取现用，永不失效
                          └─ 调 QQ空间接口发一条说说 + 回读校验
```

> ⚠️ 用机器人挂 QQ 属于「非官方客户端」，理论上有被风控的风险。请只用一个不重要的**小号**，
> 不要用主号，也不要用它加重要好友或做账号绑定。

---

## 0. 你需要准备

- 一个 Oracle Cloud 账号（注册要信用卡/借记卡做身份验证，不会扣费）
- 手机上的 QQ（用来扫码登录小号）
- 大约 40 分钟

---

## 1. 创建免费实例

1. 登录 <https://cloud.oracle.com>，右上角把区域切到**你注册时选的区域**（不要随便换）。
2. 左侧菜单 → **Compute → Instances → Create instance**。
3. 关键选项：

| 项目 | 选择 |
| --- | --- |
| Name | `qwotday` |
| Image | **Ubuntu 24.04**（Canonical Ubuntu） |
| Shape | **Ampere · VM.Standard.A1.Flex**（ARM，永久免费额度 4 OCPU / 24 GB） |
| OCPU / Memory | 2 OCPU / 12 GB 就足够（用满 4/24 也行） |
| Boot volume | 默认 50 GB 即可（免费额度 200 GB） |
| SSH keys | **Upload public key** 或让它生成并下载私钥，保存好 |

> 如果提示 *Out of host capacity*：换个可用域（Availability Domain），或者过几小时再试，
> 也可以先把 OCPU 降到 1 / 内存 6 GB 试试。这是 Oracle 免费区最常见的坑。

4. 创建完成后记下 **Public IP address**。

### 放行端口（两处都要做）

**a. 云控制台安全列表**：实例详情 → 点击 VCN → **Security Lists** → 默认安全列表 →
**Add Ingress Rule**：

| Source CIDR | IP Protocol | Destination Port Range |
| --- | --- | --- |
| `0.0.0.0/0` | TCP | `6099` |

**b. 实例内部的 iptables**（Oracle 的 Ubuntu 镜像默认只放行 22，非常容易漏）：

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 6099 -j ACCEPT
sudo netfilter-persistent save
```

---

## 2. 连接服务器

Windows 上直接用 PowerShell：

```powershell
ssh -i "C:\Users\你\Downloads\ssh-key-2026-11-12.key" ubuntu@<公网IP>
```

> 提示 `bad permissions` 时先跑：
> `icacls "C:\路径\密钥.key" /inheritance:r /grant:r "$($env:USERNAME):(R)"`

---

## 3. 一键部署

```bash
# 下载仓库（cloud-init 已经装好 git；没有就 sudo apt install -y git）
git clone --depth 1 https://github.com/AdLambXD/QWotDay.git /tmp/qwotday

# 部署（装 Docker、Node 20、启动 NapCat、写 cron）
sudo bash /tmp/qwotday/deploy/setup.sh
```

脚本会依次做：

1. 安装 Docker / Node.js 20 / cron
2. 把仓库放到 `/opt/qwotday`
3. 生成 `/opt/qwotday/.env`
4. 用 `docker compose` 启动 NapCat，数据持久化在 `/opt/qwotday/deploy/ntqq`
5. 写入 `/etc/cron.d/qwotday`，每天 07:17（Asia/Shanghai）自动发帖

---

## 4. 扫码登录小号

```bash
docker logs -f napcat
```

日志里会出现两样东西：

- **WebUI 地址**：`http://<公网IP>:6099/webui/`
- **Token**（一串随机字符，之后还要用）

浏览器打开 WebUI → 输入 token → **QRCode → 扫码**，用手机上的**小号**确认登录。

登录成功后，把控制台里的二维码页关掉，**立刻把 6099 端口关掉**（控制台删掉那条 Ingress 规则 +
`sudo iptables -D INPUT -p tcp --dport 6099 -j ACCEPT`），只留 22 和本机 3000。

> 之后想再进 WebUI，用 SSH 隧道更安全：
> `ssh -L 6099:127.0.0.1:6099 ubuntu@<公网IP>`，然后访问 `http://127.0.0.1:6099/webui/`

---

## 5. 配置 HTTP 接口 + Token

WebUI → 左侧 **网络配置** → 新建 **HTTP 服务器**：

| 字段 | 值 |
| --- | --- |
| Host | `0.0.0.0` |
| Port | `3000` |
| Token | 自己设一串（或者用自动生成的） |

保存后启用。容器已经把 3000 映射到宿主机的 `127.0.0.1:3000`，外网访问不到，安全。

把 token 写进 `.env`：

```bash
sudo nano /opt/qwotday/.env
```

```dotenv
NAPCAT_API_URL=http://127.0.0.1:3000
NAPCAT_TOKEN=你刚设的token
QZONE_UIN=2707908134
TIMEZONE=Asia/Shanghai
```

```bash
sudo chmod 600 /opt/qwotday/.env
```

> `QZONE_UIN` 用来防止登错号：如果 NapCat 里登录的不是这个号，脚本会直接报错。

---

## 6. 验证

```bash
# 1) 确认能从 NapCat 拿到 Cookie
curl -s -X POST http://127.0.0.1:3000/get_cookies \
  -H "Authorization: Bearer <token>" \
  -H 'Content-Type: application/json' \
  -d '{"domain":"user.qzone.qq.com"}'
```

正常会返回 `data.cookies`（里面要有 `p_skey`）和 `data.bkn`。

```bash
# 2) 只打印文案，不发
sudo bash /opt/qwotday/deploy/run.sh --dry

# 3) 真发一条
sudo bash /opt/qwotday/deploy/run.sh

# 4) 看定时任务日志
tail -f /var/log/qwotday.log
```

---

## 7. 收尾：关掉 GitHub Actions 的定时

两边同时开会导致一天发两条。云上跑通之后，去仓库
**Settings → Actions → Workflow permissions** 保持不动，只要把 workflow 的定时去掉：

打开 `.github/workflows/daily-qzone.yml`，删掉或注释掉这几行：

```yaml
  schedule:
    - cron: '17 23 * * *'
```

保留 `workflow_dispatch` 手动触发即可。

---

## 常见问题

**Q：`docker compose up` 报 `no matching manifest for linux/arm64`？**

说明这个镜像没有 arm64 版本。改用官方一键安装（原生支持 arm64）：

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/NapNeko/NapCatQQ/main/script/install.sh)"
```

然后按官方文档 <https://napneko.icu/guide/start-install> 启动，其余步骤（WebUI / get_cookies / .env）不变。

**Q：扫码后提示登录失败 / 需要短信验证？**

机房 IP 首次登录常被要求验证。用手机 QQ 直接确认即可；反复失败可以换个区域重建实例。

**Q：机器人掉线了？**

`docker logs --tail 100 napcat` 看原因。多数是 QQ 在手机上被点了「退出登录」，
重新扫码即可。数据目录 `deploy/ntqq` 有持久化，一般不用重扫。

**Q：内存够吗？**

NapCat 本身 50~100 MB，QQ NT 客户端约 300~500 MB。ARM 12 GB 的实例非常宽裕。

**Q：能不用 Docker，直接用官方安装包吗？**

可以。Docker 只是为了好升级、好清理。用官方安装包时，把 `NAPCAT_API_URL`
和 `NAPCAT_TOKEN` 指向它监听的端口即可，`src/server.mjs` 不关心 NapCat 是怎么装的。
