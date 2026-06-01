================================================
  VISUALIZADOR GIS - PUERTO LUMBRERAS
================================================

REQUISITOS
----------
- Python 3.10 o superior
- Windows 10/11
- MongoDB Community 6.0 o superior (instalado y en ejecucion)


INSTALACIÓN (solo la primera vez)
----------------------------------
1. Copia la carpeta completa del proyecto:

   PuertoLumbreras_Server/
   ├── app.py
   ├── requirements.txt
   ├── setup.bat
   ├── start_server.bat
   ├── stop_server.bat
   ├── README.txt
   ├── templates/
   │   └── index.html
   └── static/
       ├── css/
       │   └── leaflet.css        <- descargado por setup.bat
       ├── js/
       │   └── vendor/            <- descargado por setup.bat
       │       ├── leaflet.js
       │       ├── proj4.js
       │       ├── chart.umd.min.js
       │       ├── jspdf.umd.min.js
       │       └── images/
       │           ├── marker-icon.png
       │           ├── marker-icon-2x.png
       │           └── marker-shadow.png
       └── data/                  <- se crea automáticamente

2. Asegurate de que MongoDB esta en ejecucion ANTES de ejecutar setup.bat
   Puedes iniciarlo con:  net start MongoDB
   O desde el Administrador de servicios de Windows.

3. Ejecuta setup.bat
   - Crea el entorno virtual Python
   - Instala todas las dependencias (incluyendo pymongo y bcrypt)
   - Descarga las librerias JS a static/js/vendor/ (requiere internet solo esta vez)
   - Verifica que MongoDB responde en localhost:27017


MONGODB — BASE DE DATOS DE USUARIOS
-------------------------------------
La aplicacion usa MongoDB para gestionar los usuarios del sistema.
La base de datos se llama "georuta" y la coleccion "usuarios".

Al arrancar el servidor por primera vez se crea automaticamente
un usuario administrador con las credenciales por defecto:

   Usuario: admin
   Contraseña: admin1234

IMPORTANTE: cambia la contraseña del admin en el primer inicio de sesion
desde el panel de administracion de usuarios.

Las contraseñas se almacenan siempre hasheadas con bcrypt.
Nadie, ni el administrador, puede ver las contraseñas en texto plano.

Si MongoDB no esta en ejecucion el servidor arrancara con un aviso
pero el sistema de usuarios no funcionara.


MODO OFFLINE
-------------
La aplicacion detecta automaticamente si hay conexion a internet:
- CON red:    carga el mapa de fondo OSM/PNOA normalmente
- SIN red:    activa fondo gris neutro; las capas vectoriales (vias,
              puntos, rutas, obstaculos) se ven con total normalidad

Las librerias JS (Leaflet, proj4, Chart.js, jsPDF) siempre se cargan
desde local, por lo que la logica de la aplicacion nunca necesita red.


INICIAR EL SERVIDOR
--------------------
1. Asegurate de que MongoDB esta en ejecucion (net start MongoDB)
2. Ejecuta start_server.bat
3. Abre el navegador en: http://localhost:5000


DETENER EL SERVIDOR
--------------------
Ejecuta stop_server.bat
  — o —
Pulsa Ctrl+C en la ventana del servidor


USO DE LA APLICACIÓN
---------------------
1. CARGAR CAPAS
   - Panel izquierdo -> pestana "Capas"
   - Boton "Cargar Vias" -> selecciona un archivo .geojson o .zip (shapefile)
   - Boton "Cargar Puntos" -> igual para puntos de interes

2. TABLA DE ATRIBUTOS
   - Pulsa el boton junto a cada capa para abrir la tabla
   - Consultas SQL: WHERE highway = 'residential' | WHERE lanes > 2 | LIMIT 50
   - Boton Editar: anadir columnas, eliminar columnas, editar valores

3. CALCULAR RUTAS
   - Pulsa el boton en el mapa para activar el modo rutas
   - Se abrira el panel de configuracion de atributos:
       · Velocidad maxima  -> columna numerica (km/h)
       · N de carriles     -> columna numerica
       · Tipo de via       -> columna de texto (opcional)
   - Haz clic en el mapa para marcar ORIGEN y DESTINO
   - La ruta optima se dibujara en azul

4. OBSTACULOS
   - Con el modo rutas activo, activa "Crear Obstaculo"
   - Haz clic en el mapa para bloquear zonas
   - La ruta los evitara automaticamente

5. GESTION DE USUARIOS (solo admin)
   - Accede desde el icono de usuario -> "Administrar usuarios"
   - Desde ahi puedes ver, crear, editar permisos y eliminar usuarios
   - Las contrasenas nunca se muestran en texto plano


NOTAS
------
- Los archivos GeoJSON cargados se guardan temporalmente en static/data/
- Si cambias la capa de vias, vuelve a configurar los atributos de ruta
- La base de datos MongoDB se llama "georuta" (coleccion: "usuarios")
- Para hacer copia de seguridad de usuarios: mongodump --db georuta