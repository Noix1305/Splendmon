@echo off
rem Doble clic para actualizar la lista de fondos despues de agregar o borrar imagenes en img\backgrounds.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0actualizar-fondos.ps1"
pause
