@echo off
chcp 65001 >nul
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js。请先安装 Node.js LTS 版本：https://nodejs.org/zh-cn
  pause
  exit /b 1
)
if not "%DASHSCOPE_API_KEY%"=="" set "LLM_API_KEY=%DASHSCOPE_API_KEY%"
if "%LLM_API_KEY%"=="" set /p LLM_API_KEY=未找到环境变量 DASHSCOPE_API_KEY，请粘贴通义千问 API Key 后回车：
echo 开始评测：110 条用例 x 3 个版本 x 3 轮，约需 10-20 分钟……
node eval\run.mjs --llm qwen --trials 3
if errorlevel 1 (
  echo 评测失败，请把上面的报错截图发给 Claude。
  pause
  exit /b 1
)
node scripts\build_web.mjs reports\llm-qwen-qwen-plus.json
echo.
echo 完成。报告在 reports 文件夹，体验页已更新到 dist\index.html。回到对话里告诉 Claude "跑完了" 即可。
pause
