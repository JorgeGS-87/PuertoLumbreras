@echo off
echo ================================================
echo   INSTALACION - SERVIDOR GIS PUERTO LUMBRERAS
echo ================================================
echo.

REM Verificar si Python esta instalado
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python no esta instalado
    echo Descargalo desde: https://www.python.org/downloads/
    pause
    exit /b 1
)

echo [1/5] Verificando Python... OK
echo.

REM Eliminar venv antiguo si existe
if exist venv (
    echo [2/5] Eliminando entorno virtual antiguo...
    rmdir /s /q venv
) else (
    echo [2/5] Sin entorno virtual previo, continuando...
)
echo.

REM Crear nuevo entorno virtual
echo [3/5] Creando entorno virtual...
python -m venv venv
if errorlevel 1 (
    echo ERROR: No se pudo crear el entorno virtual
    pause
    exit /b 1
)
echo.

REM Activar entorno virtual e instalar dependencias
echo [4/5] Instalando dependencias Python...
call venv\Scripts\activate.bat
pip install --upgrade pip
pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: No se pudieron instalar las dependencias
    pause
    exit /b 1
)
echo.

REM Descargar librerias JS para modo offline
echo [5/5] Descargando librerias JS (vendor)...
if not exist static\css mkdir static\css
if not exist static\js\vendor\images mkdir static\js\vendor\images

powershell -Command "Invoke-WebRequest 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js' -OutFile 'static\js\vendor\leaflet.js'"
powershell -Command "Invoke-WebRequest 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css' -OutFile 'static\css\leaflet.css'"
powershell -Command "Invoke-WebRequest 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png' -OutFile 'static\js\vendor\images\marker-icon.png'"
powershell -Command "Invoke-WebRequest 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png' -OutFile 'static\js\vendor\images\marker-icon-2x.png'"
powershell -Command "Invoke-WebRequest 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png' -OutFile 'static\js\vendor\images\marker-shadow.png'"
powershell -Command "Invoke-WebRequest 'https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.8.0/proj4.js' -OutFile 'static\js\vendor\proj4.js'"
powershell -Command "Invoke-WebRequest 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js' -OutFile 'static\js\vendor\chart.umd.min.js'"
powershell -Command "Invoke-WebRequest 'https://cdn.socket.io/4.7.5/socket.io.min.js' -OutFile 'static\js\vendor\socket.io.min.js'"
powershell -Command "Invoke-WebRequest 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js' -OutFile 'static\js\vendor\jspdf.umd.min.js'"

if errorlevel 1 (
    echo AVISO: Alguna libreria JS no se pudo descargar. Comprueba la conexion a internet.
    echo        La aplicacion puede no funcionar correctamente en modo offline.
) else (
    echo Librerias JS descargadas correctamente.
)

echo.
echo ================================================
echo   VERIFICANDO MONGODB
echo ================================================
echo.
echo Comprobando si MongoDB esta en ejecucion...
powershell -Command "try { $c = New-Object System.Net.Sockets.TcpClient('localhost', 27017); $c.Close(); Write-Host 'MongoDB detectado en localhost:27017 — OK' } catch { Write-Host 'AVISO: MongoDB no responde en localhost:27017'; Write-Host '       Asegurate de que el servicio MongoDB esta iniciado antes de arrancar el servidor.'; Write-Host '       Puedes iniciarlo con: net start MongoDB' }"

echo.
echo ================================================
echo   INSTALACION COMPLETADA
echo ================================================
echo.
echo Para iniciar el servidor ejecuta: start_server.bat
echo.
pause