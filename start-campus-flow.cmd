@echo off
chcp 65001 >nul
cd /d "%~dp0"

powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:4173/' -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel% equ 0 (
  start "" "http://localhost:4173"
  exit /b 0
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js를 찾을 수 없습니다.
  echo Node.js LTS를 설치한 후 다시 실행해 주세요.
  pause
  exit /b 1
)

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 1; Start-Process 'http://localhost:4173'"
echo Campus Flow를 실행했습니다.
echo.
echo 이 창을 닫으면 사이트가 종료됩니다.
echo 사이트 주소: http://localhost:4173
echo.
node server.js

if errorlevel 1 (
  echo.
  echo 서버를 실행하지 못했습니다.
  pause
)
