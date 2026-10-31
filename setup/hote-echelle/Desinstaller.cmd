@echo off
rem Retire les variantes de mise à l'échelle de Sunshine et le complément KaneMode du PC hôte.
chcp 65001 >nul
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" & exit /b)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Installer.ps1" -Desinstaller
pause
