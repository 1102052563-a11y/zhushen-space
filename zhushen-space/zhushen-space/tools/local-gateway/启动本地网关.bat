@echo off
chcp 65001 >nul
setlocal
title 诸神空间 · 本地网关
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto no_node
if not exist "local-gateway.mjs" goto no_file

node local-gateway.mjs %*
echo.
echo  按任意键关闭窗口...
pause >nul
exit /b 0

:no_node
echo.
echo  [x] 未检测到 Node.js —— 请先安装（LTS 版即可，一路下一步）：
echo      https://nodejs.org/
echo.
echo  按任意键关闭窗口...
pause >nul
exit /b 1

:no_file
echo.
echo  [x] 同目录下找不到 local-gateway.mjs —— 请把两个文件放在同一个文件夹里。
echo.
echo  按任意键关闭窗口...
pause >nul
exit /b 1
