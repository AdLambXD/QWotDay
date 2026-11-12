# 注册 Windows 计划任务：开机后 + 每 6 小时从 QQ 客户端换一次空间 Cookie 并推送到 GitHub Secret
# 用法（普通 PowerShell 即可，不需要管理员）：
#   powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1
# 卸载：
#   schtasks /delete /tn QWotDay-RefreshCookie /f
#   schtasks /delete /tn QWotDay-RefreshCookie-Logon /f

$ErrorActionPreference = 'Continue'

$taskName = 'QWotDay-RefreshCookie'
$logonTaskName = 'QWotDay-RefreshCookie-Logon'
$repoDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$logDir = Join-Path $repoDir 'logs'
$vbsPath = Join-Path $PSScriptRoot 'refresh-hidden.vbs'

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
}

# 生成隐藏窗口启动器（计划任务直接跑 node 会闪一个黑框）
$vbs = @"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$repoDir"
sh.Run "cmd /c chcp 65001 >nul & node scripts\mint.mjs --push >> logs\refresh.log 2>&1", 0, False
"@
Set-Content -Path $vbsPath -Value $vbs -Encoding ASCII

$action = "wscript.exe ""$vbsPath"""

# 先删掉旧任务，避免重复（用 cmd 包一层，原生命令的 stderr 不会触发 Stop）
cmd /c "schtasks /delete /tn $taskName /f >nul 2>&1"
cmd /c "schtasks /delete /tn $logonTaskName /f >nul 2>&1"

# 每 6 小时一次（从创建时开始计时）
& schtasks @('/create', '/tn', $taskName, '/tr', $action, '/sc', 'MINUTE', '/mo', '360', '/f') | Out-Null
if ($LASTEXITCODE -ne 0) { throw '创建每 6 小时任务失败' }

# 每次登录后 2 分钟再跑一次（刚开机 QQ 通常还没登录完）
& schtasks @('/create', '/tn', $logonTaskName, '/tr', $action, '/sc', 'ONLOGON', '/delay', '0002:00', '/f') | Out-Null
if ($LASTEXITCODE -ne 0) { throw '创建登录触发任务失败' }

Write-Host "✅ 已注册计划任务："
Write-Host "   $taskName        每 6 小时一次"
Write-Host "   $logonTaskName   登录后 2 分钟一次"
Write-Host ""
Write-Host "   日志：$logDir\refresh.log"
Write-Host "   手动试跑：schtasks /run /tn $taskName"
Write-Host "   查看日志：Get-Content '$logDir\refresh.log' -Tail 20 -Encoding UTF8"
