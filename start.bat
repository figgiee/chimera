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

:: Warn if Ollama is missing (don't block)
where ollama >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARN] Ollama not found. Install from https://ollama.com
    echo        Then run: ollama pull qwen3:8b ^&^& ollama pull nomic-embed-text
    echo.
)

:: Kill stale process on port 3210 if any
echo [CLEANUP] Checking port 3210...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr "LISTENING" ^| findstr ":3210 "') do (
    echo          Killing PID %%a
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: Install dependencies
echo [1/3] Installing dependencies...
cd /d "%~dp0"
call npm install --prefer-offline

:: Build web frontend
echo [2/3] Building web frontend...
cd /d "%~dp0web"
call npm install --prefer-offline
call npm run build
cd /d "%~dp0"

:: Start server
echo [3/3] Starting Chimera server...
echo.
echo   ==============================
echo     Chimera is running at:
echo     http://localhost:3210
echo   ==============================
echo.
echo   Requires Ollama running with:
echo     ollama pull qwen3:8b
echo     ollama pull nomic-embed-text
echo.
echo   Press Ctrl+C to stop.
echo.

node "%~dp0chimera-chat.js"

echo.
echo Chimera server stopped.
pause
