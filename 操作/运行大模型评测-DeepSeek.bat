@echo off
chcp 65001 >nul
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js。请先安装 Node.js LTS 版本：https://nodejs.org/zh-cn
  pause
  exit /b 1
)
if "%LLM_API_KEY%"=="" set /p LLM_API_KEY=请粘贴 DeepSeek API Key 后回车：
node eval\run.mjs --llm deepseek --trials 3
if errorlevel 1 ( pause & exit /b 1 )
node scripts\build_web.mjs reports\llm-deepseek-deepseek-chat.json
echo 完成。回到对话里告诉 Claude "跑完了" 即可。
pause
