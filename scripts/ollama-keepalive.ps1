# Ollama 后台保活脚本
# 功能：
#   1. 检查 ollama.exe 是否在 PATH 或常见安装路径
#   2. 如果 Ollama 服务未运行，则启动它
#   3. 服务崩溃后自动重启
#   4. 可选：保持 qwen2.5 模型常驻内存（通过预热请求）

param(
    [switch]$InstallStartupTask,
    [switch]$Once
)

$ErrorActionPreference = "Stop"

function Find-OllamaExe {
    $candidates = @(
        "ollama.exe",
        "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
        "$env:USERPROFILE\AppData\Local\Programs\Ollama\ollama.exe",
        "C:\Program Files\Ollama\ollama.exe",
        "C:\Program Files (x86)\Ollama\ollama.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return (Resolve-Path $c).Path }
    }
    # 检查 PATH
    $inPath = Get-Command ollama.exe -ErrorAction SilentlyContinue
    if ($inPath) { return $inPath.Source }
    return $null
}

function Test-OllamaRunning {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -Method GET -TimeoutSec 3 -UseBasicParsing
        return $resp.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Invoke-ModelWarmup {
    param($OllamaExe)
    try {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 预热模型 qwen2.5 ..." -ForegroundColor Cyan
        $body = @{model="qwen2.5"; messages=@(@{role="user"; content="你好"}); stream=$false} | ConvertTo-Json -Compress
        $resp = Invoke-WebRequest -Uri "http://localhost:11434/api/chat" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 60 -UseBasicParsing
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 预热完成" -ForegroundColor Green
    } catch {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 预热失败: $_" -ForegroundColor Yellow
    }
}

function Install-StartupTask {
    $scriptPath = $PSCommandPath
    $taskName = "OllamaKeepAlive"
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`""
    $trigger = New-ScheduledTaskTrigger -AtLogon
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -RunLevel Highest -LogonType Interactive
    try {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
        Write-Host "已创建开机自启任务：$taskName" -ForegroundColor Green
    } catch {
        Write-Host "创建计划任务失败: $_" -ForegroundColor Red
    }
}

# 安装自启任务
if ($InstallStartupTask) {
    Install-StartupTask
    exit 0
}

$ollama = Find-OllamaExe
if (-not $ollama) {
    Write-Host "未找到 ollama.exe，请先安装 Ollama：https://ollama.com/download" -ForegroundColor Red
    exit 1
}
Write-Host "找到 Ollama: $ollama" -ForegroundColor Green

# 设置环境变量：保持模型常驻内存 24 小时
$env:OLLAMA_KEEP_ALIVE = "24h"
# 允许跨域（本地前后端调用）
$env:OLLAMA_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:8000,http://127.0.0.1:8000"

while ($true) {
    if (-not (Test-OllamaRunning)) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Ollama 未运行，正在启动..." -ForegroundColor Yellow
        $proc = Start-Process -FilePath $ollama -ArgumentList "serve" -WindowStyle Hidden -PassThru
        # 等待服务可用
        $maxWait = 60
        $started = $false
        for ($i = 0; $i -lt $maxWait; $i++) {
            Start-Sleep -Seconds 1
            if (Test-OllamaRunning) { $started = $true; break }
        }
        if ($started) {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Ollama 已启动 (PID: $($proc.Id))" -ForegroundColor Green
            Invoke-ModelWarmup -OllamaExe $ollama
        } else {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Ollama 启动超时" -ForegroundColor Red
        }
    } else {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Ollama 运行中" -ForegroundColor DarkGray
    }

    if ($Once) { break }
    Start-Sleep -Seconds 10
}
