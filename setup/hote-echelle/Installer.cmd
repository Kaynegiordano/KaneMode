@echo off
rem Complément KaneMode pour le PC hôte (mise à l'échelle pendant le streaming) : demande les droits
rem d'administrateur puis lance Installer.ps1. Desinstaller.cmd retire tout.
chcp 65001 >nul
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" & exit /b)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Installer.ps1" %*
pause
