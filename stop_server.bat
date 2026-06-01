@echo off
echo Deteniendo servidor Flask...
echo.
taskkill /F /IM python.exe 2>nul
if errorlevel 1 (
    echo No hay servidores Python ejecutándose
) else (
    echo ✅ Servidor detenido
)
echo.
pause