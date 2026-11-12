@echo off
cd /d "%~dp0\.."
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 -m kontur.desktop
) else (
  python -m kontur.desktop
)
if errorlevel 1 pause
