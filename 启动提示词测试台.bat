@echo off
rem 启动提示词测试台（M1.3）。必须在项目根目录运行；不要用浏览器直接打开 index.html。
cd /d "%~dp0"
echo 正在启动提示词测试台...
npx electron prompt-lab
