@echo off
chcp 65001 >nul
title Ollama 后台保活
echo 正在启动 Ollama 后台保活服务...
echo 首次运行会自动安装开机自启计划任务。
echo.

powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0ollama-keepalive.ps1" -InstallStartupTask
echo 自启任务已安装，正在启动服务...
powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0ollama-keepalive.ps1"
