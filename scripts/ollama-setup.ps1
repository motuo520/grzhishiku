# Ollama 安装后初始化脚本
# 拉取项目所需的本地模型并设置为开机自启

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
    $inPath = Get-Command ollama.exe -ErrorAction SilentlyContinue
    if ($inPath) { return $inPath.Source }
    return $null
}

function Wait-ForOllama {
    param([int]$TimeoutSeconds = 60)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        try {
            $resp = Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -TimeoutSec 2 -UseBasicParsing
            if ($resp.StatusCode -eq 200) { return $true }
        } catch {}
        Start-Sleep -Seconds 1
    }
    return $false
}

$ollama = Find-OllamaExe
if (-not $ollama) {
    Write-Host "未找到 ollama.exe，请先运行 OllamaSetup.exe 完成安装。" -ForegroundColor Red
    Write-Host "下载地址：https://ollama.com/download/OllamaSetup.exe" -ForegroundColor Yellow
    exit 1
}
Write-Host "找到 Ollama: $ollama" -ForegroundColor Green

# 确保服务在运行
if (-not (Wait-ForOllama -TimeoutSeconds 5)) {
    Write-Host "正在启动 Ollama 服务..." -ForegroundColor Cyan
    Start-Process -FilePath $ollama -ArgumentList "serve" -WindowStyle Hidden
    if (-not (Wait-ForOllama -TimeoutSeconds 60)) {
        Write-Host "Ollama 服务启动失败" -ForegroundColor Red
        exit 1
    }
}

# 拉取模型
$models = @("qwen2.5", "nomic-embed-text")
foreach ($m in $models) {
    Write-Host "正在拉取模型 $m ..." -ForegroundColor Cyan
    & $ollama pull $m
    if ($LASTEXITCODE -ne 0) {
        Write-Host "拉取 $m 失败，请检查网络后重试。" -ForegroundColor Red
    } else {
        Write-Host "$m 拉取完成" -ForegroundColor Green
    }
}

# 安装保活/自启脚本
$keepAliveScript = Join-Path (Split-Path -Parent $PSCommandPath) "ollama-keepalive.ps1"
if (Test-Path $keepAliveScript) {
    Write-Host "正在配置开机自启与后台保活..." -ForegroundColor Cyan
    & powershell.exe -ExecutionPolicy Bypass -File $keepAliveScript -InstallStartupTask
    Start-Process -WindowStyle Hidden -FilePath "powershell.exe" -ArgumentList "-ExecutionPolicy Bypass -File `"$keepAliveScript`""
    Write-Host "后台保活服务已启动" -ForegroundColor Green
}

Write-Host "`n本地模型初始化完成。" -ForegroundColor Green
Write-Host "可通过 http://localhost:11434/api/tags 查看已安装模型。" -ForegroundColor DarkGray
