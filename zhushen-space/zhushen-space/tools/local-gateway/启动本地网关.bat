@echo off
chcp 65001 >nul
title 诸神空间 · 本地网关
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [x] 未检测到 Node.js —— 请先安装（LTS 版即可，一路下一步）：
  echo      https://nodejs.org/
  echo.
  pause
  exit /b 1
)
if not exist "local-gateway.mjs" (
  echo.
  echo  [x] 同目录下找不到 local-gateway.mjs —— 请把两个文件放在同一个文件夹里。
  echo.
  pause
  exit /b 1
)
node local-gateway.mjs %*
echo.
pause
