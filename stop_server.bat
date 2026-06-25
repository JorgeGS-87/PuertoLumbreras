@echo off
echo Deteniendo servidor Flask (buscando procesos que ejecuten app.py)...
echo.
REM Intentar detener procesos de Python que contienen 'app.py' en la línea de comando
powershell -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match 'app.py' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host ('Stopped PID: ' + $_.ProcessId) }"

REM Comprobar si se han detenido procesos; si no, preguntar si desea forzar
powershell -Command "if ((Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match 'app.py' }) -eq $null) { Write-Host 'No se han encontrado procesos con app.py.' } else { Write-Host 'Algunos procesos con app.py pudieron no detenerse.' }"

echo.
set /p FORCE=¿Forzar cierre de todos los procesos python.exe? (s/N):
if /I "%FORCE%"=="s" (
    taskkill /F /IM python.exe 2>nul
    if errorlevel 1 (
        echo No hay procesos python.exe en ejecución o no se pudieron cerrar.
    ) else (
        echo ✅ Todos los procesos python.exe han sido forzados a cerrar.
    )
) else (
    echo Operación cancelada. Si quedan procesos, ciérralos manualmente.
)

echo.
pause