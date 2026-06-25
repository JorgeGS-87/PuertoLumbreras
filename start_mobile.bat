@echo off
echo Iniciando GeoRuta (modo mobile)...

REM Si existe venv, usar el Python del entorno virtual
if exist venv\Scripts\activate.bat (
	call venv\Scripts\activate.bat
	if exist venv\Scripts\python.exe (
		start "" venv\Scripts\python.exe app.py
	) else (
		start "" python app.py
	)
) else (
	echo Entorno virtual no encontrado. Se intentara usar Python del sistema.
	start "" python app.py
)

timeout /t 3 /nobreak
echo Arrancando tunel Cloudflare...

REM Preferir cloudflared en PATH, si no existe buscar en la carpeta del proyecto
where cloudflared >nul 2>&1
if errorlevel 1 (
	if exist cloudflared.exe (
		cloudflared.exe tunnel --url http://localhost:5000
	) else (
		echo ERROR: cloudflared no encontrado en PATH ni en la carpeta del proyecto.
		echo Descargalo desde: https://github.com/cloudflare/cloudflared/releases/latest
	)
) else (
	cloudflared tunnel --url http://localhost:5000
)

pause