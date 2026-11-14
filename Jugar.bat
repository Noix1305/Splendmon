@echo off
rem Abre el juego. Antes actualiza la lista de fondos con las imagenes de img\backgrounds,
rem asi las imagenes nuevas aparecen sin hacer nada mas.
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0tools\actualizar-fondos.ps1" >nul 2>&1
start "" "%~dp0index.html"
