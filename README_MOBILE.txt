Requisitos previos
------------------
- Haber ejecutado `setup.bat` al menos una vez para crear el entorno virtual y descargar recursos.

Instalación y uso
------------------
1) Descarga el ejecutable de Cloudflare Tunnel (cloudflared) para Windows:
   https://github.com/cloudflare/cloudflared/releases/latest
   - Elige la versión para Windows (AMD64 si tu máquina es 64 bits).
   - Renómbralo a `cloudflared.exe` y colócalo en la carpeta raíz del proyecto.

2) Asegúrate de que MongoDB está en ejecución (si usas el servidor con usuarios):
   - En CMD con privilegios: `net start MongoDB`

3) Inicia la aplicación y el túnel:
   - Ejecuta `start_mobile.bat` (el script activa el `venv` si existe y arranca `app.py`).
   - Espera a que aparezca la URL pública del túnel y ábrela en el móvil.

Notas
-----
- Si `cloudflared.exe` no está en la carpeta del proyecto ni en el PATH, `start_mobile.bat` mostrará un aviso.
- Si prefieres ejecutar manualmente, puedes activar el `venv` y ejecutar:
  `venv\Scripts\activate.bat`  (PowerShell: `venv\Scripts\Activate.ps1`)
  `venv\Scripts\python.exe app.py`

Si necesitas ayuda para elegir la versión correcta de `cloudflared`, indícame la arquitectura de tu equipo.