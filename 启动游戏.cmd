@echo off
rem 六面世界 · Codex 桌面聊天窗 启动器（双击即可运行）
cd /d "%~dp0"
if not exist node_modules\electron\dist\electron.exe (
  echo 首次运行需要安装 Electron，正在安装…
  call npm install --no-audit --no-fund
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
