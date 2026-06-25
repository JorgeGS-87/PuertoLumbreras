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
echo [1/6] Verificando Python... OK
echo.

REM Verificar si MongoDB esta corriendo
echo [2/6] Verificando MongoDB...
powershell -Command "try { $c = New-Object System.Net.Sockets.TcpClient('localhost', 27017); $c.Close(); Write-Host '       MongoDB detectado en localhost:27017 — OK' } catch { Write-Host ''; Write-Host '  AVISO: MongoDB no responde en localhost:27017'; Write-Host ''; Write-Host '  MongoDB es necesario para que la aplicacion funcione.'; Write-Host '  Si no lo tienes instalado:'; Write-Host '    1. Descargalo desde: https://www.mongodb.com/try/download/community'; Write-Host '    2. Instalalo con la opcion Install MongoD as a Service'; Write-Host '    3. Vuelve a ejecutar este setup.bat'; Write-Host ''; Write-Host '  Si ya esta instalado pero no arranca, ejecuta en cmd como admin:'; Write-Host '    net start MongoDB'; Write-Host '' }"
echo.

REM Eliminar venv antiguo si existe
if exist venv (
    echo [3/6] Eliminando entorno virtual antiguo...
    rmdir /s /q venv
) else (
    echo [3/6] Sin entorno virtual previo, continuando...
)
echo.

REM Crear nuevo entorno virtual
echo [4/6] Creando entorno virtual Python...
python -m venv venv
if errorlevel 1 (
    echo ERROR: No se pudo crear el entorno virtual
    pause
    exit /b 1
)
echo.

REM Activar entorno virtual e instalar dependencias
echo [5/6] Instalando dependencias Python...
call venv\Scripts\activate.bat
pip install --upgrade pip --quiet
pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: No se pudieron instalar las dependencias
    echo Comprueba tu conexion a internet e intentalo de nuevo
    pause
    exit /b 1
)
echo.
REM Asegurar la disponibilidad de herramientas de compilacion simples
echo Instalando 'wheel' por si fuese necesario para paquetes binarios...
pip install wheel --quiet
echo.

REM Descargar librerias JS para modo offline
echo [6/6] Descargando librerias JavaScript...
if not exist static\css mkdir static\css
if not exist static\js\vendor\images mkdir static\js\vendor\images

powershell -Command "Invoke-WebRequest 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js' -OutFile 'static\js\vendor\leaflet.js' -ErrorAction SilentlyContinue"
powershell -Command "Invoke-WebRequest 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css' -OutFile 'static\css\leaflet.css' -ErrorAction SilentlyContinue"
powershell -Command "Invoke-WebRequest 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png' -OutFile 'static\js\vendor\images\marker-icon.png' -ErrorAction SilentlyContinue"
powershell -Command "Invoke-WebRequest 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png' -OutFile 'static\js\vendor\images\marker-icon-2x.png' -ErrorAction SilentlyContinue"
powershell -Command "Invoke-WebRequest 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png' -OutFile 'static\js\vendor\images\marker-shadow.png' -ErrorAction SilentlyContinue"
powershell -Command "Invoke-WebRequest 'https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.8.0/proj4.js' -OutFile 'static\js\vendor\proj4.js' -ErrorAction SilentlyContinue"
powershell -Command "Invoke-WebRequest 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js' -OutFile 'static\js\vendor\chart.umd.min.js' -ErrorAction SilentlyContinue"
powershell -Command "Invoke-WebRequest 'https://cdn.socket.io/4.7.5/socket.io.min.js' -OutFile 'static\js\vendor\socket.io.min.js' -ErrorAction SilentlyContinue"
powershell -Command "Invoke-WebRequest 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js' -OutFile 'static\js\vendor\jspdf.umd.min.js' -ErrorAction SilentlyContinue"

echo Librerias JS descargadas.
echo.
if not exist cloudflared.exe (
    echo AVISO: no se ha encontrado 'cloudflared.exe' en la carpeta del proyecto.
    echo Si quieres exponer el servidor para pruebas en movil, descarga:
    echo   https://github.com/cloudflare/cloudflared/releases/latest
    echo y coloca el ejecutable renombrado a cloudflared.exe en la carpeta del proyecto.
    echo.
)

echo ================================================
echo   INSTALACION COMPLETADA
echo ================================================
echo.
echo Para iniciar el servidor ejecuta: start_server.bat
echo.
echo IMPORTANTE: Asegurate de que MongoDB esta corriendo
echo antes de arrancar el servidor.
echo Si no arranca automaticamente, ejecuta en cmd como admin:
echo   net start MongoDB
echo.
pause