@echo off
echo Arrancando GeoRuta...
start "" python app.py
timeout /t 3 /nobreak
echo Arrancando tunel Cloudflare...
cloudflared tunnel --url http://localhost:5000
pause