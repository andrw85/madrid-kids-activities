@echo off
REM Launcher for the Madrid kids-activities finder.
REM Starts the Node server inside WSL and opens the browser.
title Actividades infantiles - Madrid
echo Iniciando servidor (Ctrl+C para parar)...
start "" http://localhost:8788/
wsl bash -c "cd /mnt/c/Users/enddooa/madrid-kids && node server.js"
