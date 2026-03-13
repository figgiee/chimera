@echo off
title Chimera AI
color 0A

echo.
echo   ==============================
echo     Chimera AI - Starting Up
echo   ==============================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)

:: Kill stale process on port 3210 if any
echo [CLEANUP] Checking port 3210...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr "LISTENING" ^| findstr ":3210 "') do (
    echo          Killing PID %%a
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: Start RAG stack (optional)
echo [1/3] RAG stack...
where docker >nul 2>&1
if %errorlevel% neq 0 goto :no_docker
if not exist "%~dp0rag-setup\docker-compose.yml" goto :no_docker
docker compose -f "%~dp0rag-setup\docker-compose.yml" up -d 2>nul
echo       Started.
goto :check_build

:no_docker
echo       Skipped (no Docker or no compose file).

:check_build
:: Build web frontend if needed
if exist "%~dp0web\build" goto :build_exists
echo [2/3] Building web frontend (first run)...
cd /d "%~dp0web"
call npm install
call npm run build
cd /d "%~dp0"
goto :start

:build_exists
echo [2/3] Web frontend already built.

:start
echo [3/3] Starting Chimera server...
echo.
echo   ==============================
echo     Chimera is running at:
echo     http://localhost:3210
echo   ==============================
echo.
echo   Press Ctrl+C to stop.
echo.

node "%~dp0chimera-chat.js"

echo.
echo Chimera server stopped.
pause
