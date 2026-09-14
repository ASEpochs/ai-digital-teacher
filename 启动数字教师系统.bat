@echo off
setlocal
chcp 65001 >nul
title AI 数字教师课堂监督系统 - 启动器
cd /d "%~dp0"

echo ========================================
echo     AI 数字教师课堂监督系统
echo ========================================
echo.

where python >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Python。
    echo 请先安装 Python 3.9 或更高版本，并勾选 Add Python to PATH。
    echo.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js/npm。
    echo 请先安装 Node.js 20 LTS 或更高版本。
    echo.
    pause
    exit /b 1
)

if not exist "%~dp0start.ps1" (
    echo [错误] 没有找到 start.ps1，请确认启动文件位于项目根目录。
    echo.
    pause
    exit /b 1
)

echo [1/2] 正在启动前端和后端服务...
echo 服务窗口打开后请不要关闭，关闭窗口会停止系统。
start "AI 数字教师服务" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"

echo [2/2] 正在等待系统启动，首次运行安装依赖可能需要几分钟...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddMinutes(15); while((Get-Date) -lt $deadline) { try { $front=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173/' -TimeoutSec 2; $back=Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/health' -TimeoutSec 2; if($front.StatusCode -eq 200 -and $back.status -eq 'ok') { Start-Process 'http://127.0.0.1:5173/'; exit 0 } } catch { } Start-Sleep -Seconds 2 }; exit 1"

if errorlevel 1 (
    echo.
    echo [错误] 系统在 15 分钟内没有成功启动。
    echo 请查看“AI 数字教师服务”窗口中的错误信息。
    echo.
    pause
    exit /b 1
)

echo.
echo 系统已经启动，浏览器已自动打开。
timeout /t 3 >nul
exit /b 0
