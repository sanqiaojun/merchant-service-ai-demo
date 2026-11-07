@echo off
chcp 65001 >nul
cd /d "%~dp0"
node scripts\build.mjs
start "" "docs\index.html"
pause
