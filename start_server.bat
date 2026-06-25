@echo off
echo ================================================
echo   SERVIDOR GIS - PUERTO LUMBRERAS
echo ================================================
echo.

REM Verificar si existe el entorno virtual
if not exist venv (
    echo ERROR: No se encuentra el entorno virtual
    echo Ejecuta primero: setup.bat
    pause
    exit /b 1
)

REM Verificar que Flask está instalado en el venv ejecutando un import simple
venv\Scripts\python.exe -c "import flask" 2>nul
if errorlevel 1 (
    echo ERROR: Flask no esta instalado en el entorno virtual
    echo Ejecuta setup.bat para reinstalar las dependencias
    pause
    exit /b 1
)

REM Crear carpetas necesarias si no existen
if not exist static mkdir static
if not exist static\data mkdir static\data
if not exist static\css mkdir static\css
if not exist static\js\vendor mkdir static\js\vendor
if not exist templates mkdir templates

REM Verificar que las librerias JS vendor están presentes
if not exist static\js\vendor\leaflet.js (
    echo AVISO: Las librerias JS offline no estan descargadas.
    echo        Ejecuta setup.bat para descargarlas.
    echo        La aplicacion puede no funcionar sin conexion a internet.
    echo.
)

REM Iniciar servidor usando el Python del venv directamente
echo Iniciando servidor en http://localhost:5000
echo Pulsa Ctrl+C para detenerlo
echo.
venv\Scripts\python.exe app.py

pause