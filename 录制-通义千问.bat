@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo 需要先安装 Node.js 18 以上：https://nodejs.org/zh-cn & pause & exit /b)
if "%DASHSCOPE_API_KEY%"=="" set /p DASHSCOPE_API_KEY=请粘贴通义千问 API Key（DashScope，只在本窗口使用）：
echo.
echo 开始录制：36 个场景，每个跑 3 次，大约需要 5-10 分钟……
node scripts\record.mjs
if errorlevel 1 (pause & exit /b)
node scripts\build.mjs
start "" "docs\index.html"
pause
