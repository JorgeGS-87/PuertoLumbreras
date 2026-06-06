from flask import Flask, render_template, jsonify, request, Response, session, redirect, url_for, send_file
import os
import json
import csv
import io
import geopandas as gpd
import pandas as pd
import networkx as nx
from shapely.geometry import Point, LineString, Polygon as ShapelyPolygon
import numpy as np
from math import radians, degrees, sin, cos, sqrt, atan2, acos
import re
import socket
import zipfile
import tempfile
import shutil
from datetime import datetime, timedelta
from flask_sqlalchemy import SQLAlchemy
from flask_socketio   import SocketIO, emit as ws_emit
import matplotlib
import matplotlib.pyplot as plt

# ── MongoDB (usuarios) ────────────────────────────────────────────────────────
try:
    from pymongo import MongoClient
    from pymongo.errors import ConnectionFailure, DuplicateKeyError
    from bson import ObjectId
    import bcrypt
    _MONGO_DISPONIBLE = True
except ImportError:
    _MONGO_DISPONIBLE = False
    print("⚠️  pymongo o bcrypt no instalados — sistema de usuarios en modo legacy.")
    print("    Ejecuta: pip install pymongo bcrypt")

# ==================== Basear ====================

def distanciaLatLon(p1, p2):
    # Distancia en metros entre dos puntos (lat, lon) usando la fórmula de Haversine
    lat1, lon1 = radians(p1[0]), radians(p1[1])
    lat2, lon2 = radians(p2[0]), radians(p2[1])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    return 6371000 * 2 * atan2(sqrt(a), sqrt(1 - a))


def normalizar_lanes(valor):
    # Normaliza el número de carriles, asegurando que sea un entero positivo.
    if valor is None or str(valor).strip().lower() in ('', 'none', 'nan', 'null'):
        return 1
    try:
        return max(1, int(float(valor)))
    except Exception:
        return 1


def normalizar_maxspeed(valor):
    # Normaliza el valor de velocidad máxima, extrayendo el número y asegurando que esté entre 10 y 120 km/h.
    if valor is None or str(valor).strip().lower() in ('', 'none', 'nan', 'null'):
        return 50
    try:
        if isinstance(valor, str):
            nums = re.findall(r'\d+', valor)
            speed = int(nums[0]) if nums else 50
        else:
            speed = int(float(valor))
        return max(10, min(120, speed))
    except Exception:
        return 50


def EPSG4258(filepath):
    """
    Lee un archivo GeoJSON/SHP y lo garantiza en EPSG:4258 (ETRS89 geográfico),
    sistema de referencia oficial del proyecto.

    ETRS89 y WGS84 comparten el elipsoide GRS80; sus coordenadas geográficas
    difieren menos de 1 m en la Península Ibérica, por lo que Leaflet las
    renderiza directamente sin conversión adicional.

    Si el CRS no está definido se infiere por el rango de coordenadas:
      - valores > 180  →  EPSG:25830 (UTM 30N / ETRS89)
      - en caso contrario →  EPSG:4258 ya geográfico
    """
    gdf = gpd.read_file(filepath)
    if gdf.crs is None:
        b = gdf.total_bounds
        gdf = gdf.set_crs('EPSG:25830' if (abs(b[0]) > 180 or abs(b[2]) > 180) else 'EPSG:4258')
    if gdf.crs.to_epsg() != 4258:
        gdf = gdf.to_crs('EPSG:4258')
    mask = ~gdf.geometry.is_valid
    if mask.any():
        gdf.loc[mask, 'geometry'] = gdf.loc[mask, 'geometry'].buffer(0)
    gdf = gdf[gdf.geometry.is_valid].copy()
    return gdf

# Alias de compatibilidad interna
EPSG4326 = EPSG4258


def gdf_json(gdf):
    """Convierte un GeoDataFrame a respuesta JSON utf-8 etiquetada como EPSG:4258."""
    gdf = gdf.copy()
    for col in gdf.columns:
        if col != 'geometry':
            try:
                gdf[col] = gdf[col].astype(str)
            except Exception:
                pass
    data = json.loads(gdf.to_json())
    # CRS oficial del proyecto: ETRS89 geográfico (EPSG:4258)
    data['crs'] = {'type': 'name', 'properties': {'name': 'EPSG:4258'}}
    return Response(json.dumps(data, ensure_ascii=False), mimetype='application/json; charset=utf-8')


# ==================== App ====================

app = Flask(__name__) 
app.config['DEBUG'] = True # Permite recarga automática y mensajes de error detallados.
app.config['JSON_AS_ASCII'] = False # Para mantener los caracteres especiales
app.config['UPLOAD_FOLDER'] = 'static/data' # Carpeta para tempfile.
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024 # Límite de los archivos subidos a 500MB
app.secret_key = os.urandom(24)   # nueva clave cada arranque → sesiones previas invalidas

# — SQLite en la carpeta del proyecto —
app.config['SQLALCHEMY_DATABASE_URI']        = 'sqlite:///georuta.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# — SocketIO (threading: no requiere eventlet, más estable) —
socketio = SocketIO(app, cors_allowed_origins='*', async_mode='threading')


# ── Modelos de BD ────────────────────────────────────────────────────────────

class HistorialRuta(db.Model):
    """Una ruta calculada por un usuario registrado."""
    __tablename__ = 'historial_rutas'

    id            = db.Column(db.Integer,    primary_key=True)
    usuario       = db.Column(db.String(64), nullable=False, index=True)
    fecha         = db.Column(db.DateTime,   default=datetime.utcnow)
    origen_label  = db.Column(db.String(256))
    destino_label = db.Column(db.String(256))
    tiempo_min    = db.Column(db.Float)
    distancia_km  = db.Column(db.Float)
    vehiculo      = db.Column(db.String(32))
    origen_lat    = db.Column(db.Float)
    origen_lng    = db.Column(db.Float)
    destino_lat   = db.Column(db.Float)
    destino_lng   = db.Column(db.Float)
    geojson_ruta  = db.Column(db.Text)   # GeoJSON serializado como string


class SesionObstaculos(db.Model):
    """Último estado de obstáculos guardado por un usuario."""
    __tablename__ = 'sesion_obstaculos'

    id           = db.Column(db.Integer,    primary_key=True)
    usuario      = db.Column(db.String(64), nullable=False, unique=True, index=True)
    guardado_en  = db.Column(db.DateTime,   default=datetime.utcnow, onupdate=datetime.utcnow)
    datos_json   = db.Column(db.Text,       nullable=False)
    confirmado   = db.Column(db.Boolean,    default=False)


class ObstaculoCompartido(db.Model):
    """Obstáculo de la capa compartida, editable por todos los registrados/admin en tiempo real."""
    __tablename__ = 'obstaculos_compartidos'

    id            = db.Column(db.Integer,     primary_key=True)
    obs_id        = db.Column(db.String(64),  nullable=True)
    lat           = db.Column(db.Float,       nullable=False)
    lng           = db.Column(db.Float,       nullable=False)
    nivel_val     = db.Column(db.Integer,     nullable=False, default=2)
    portal        = db.Column(db.String(256), nullable=True,  default='')
    autor         = db.Column(db.String(64),  nullable=False)
    creado_en     = db.Column(db.DateTime,    default=datetime.utcnow)
    modificado_en = db.Column(db.DateTime,    default=datetime.utcnow, onupdate=datetime.utcnow)


# Crear tablas si no existen (idempotente, no destruye datos)
with app.app_context():
    db.create_all()


# ==================== MongoDB — Conexión y usuarios ====================

_mongo_client = None
_db_mongo     = None
_col_usuarios = None   # colección "usuarios"

def _conectar_mongo():
    """Conecta a MongoDB local e inicializa la colección de usuarios.
    Crea índices únicos y el admin por defecto si la BD está vacía.
    Devuelve True si la conexión fue exitosa."""
    global _mongo_client, _db_mongo, _col_usuarios
    if not _MONGO_DISPONIBLE:
        return False
    try:
        _mongo_client = MongoClient('mongodb://localhost:27017/', serverSelectionTimeoutMS=3000)
        _mongo_client.admin.command('ping')
        _db_mongo     = _mongo_client['georuta']
        _col_usuarios = _db_mongo['usuarios']

        # Índices únicos sobre email y username
        _col_usuarios.create_index('email',    unique=True)
        _col_usuarios.create_index('username', unique=True)

        # Crear admin por defecto si no existe ningún usuario
        if _col_usuarios.count_documents({}) == 0:
            _crear_usuario_defecto()

        print(f"✅ MongoDB conectado — {_col_usuarios.count_documents({})} usuario(s)")
        return True
    except Exception as e:
        print(f"⚠️  MongoDB no disponible: {e}")
        print("    El sistema de usuarios funcionará en modo legacy (sin BD).")
        _mongo_client = _db_mongo = _col_usuarios = None
        return False


def _crear_usuario_defecto():
    """Inserta el usuario admin con contraseña admin1234 la primera vez."""
    hash_pw = bcrypt.hashpw('admin1234'.encode(), bcrypt.gensalt())
    _col_usuarios.insert_one({
        'username':       'admin',
        'email':          'admin@georuta.local',
        'password_hash':  hash_pw,
        'rol':            'admin',
        'activo':         True,
        'fecha_registro': datetime.utcnow(),
        'ultimo_acceso':  None,
    })
    print("👤 Usuario admin creado — contraseña por defecto: admin1234")
    print("   ⚠️  Cambia la contraseña en el primer inicio de sesión.")


def _hash_password(plaintext: str) -> bytes:
    return bcrypt.hashpw(plaintext.encode('utf-8'), bcrypt.gensalt())


def _verificar_password(plaintext: str, hashed: bytes) -> bool:
    try:
        return bcrypt.checkpw(plaintext.encode('utf-8'), hashed)
    except Exception:
        return False


def _mongo_ok() -> bool:
    return _col_usuarios is not None


def _usuario_a_dict(doc) -> dict:
    """Documento MongoDB → dict serializable (sin _id ni password_hash)."""
    return {
        'id':             str(doc['_id']),
        'username':       doc.get('username', ''),
        'email':          doc.get('email', ''),
        'rol':            doc.get('rol', 'registrado'),
        'activo':         doc.get('activo', True),
        'fecha_registro': doc['fecha_registro'].isoformat() if isinstance(doc.get('fecha_registro'), datetime) else str(doc.get('fecha_registro', '')),
        'ultimo_acceso':  doc['ultimo_acceso'].isoformat()  if isinstance(doc.get('ultimo_acceso'),  datetime) else str(doc.get('ultimo_acceso',  '') or ''),
    }


def _requiere_admin(f):
    """Decorador: devuelve 403 si el usuario no es admin."""
    from functools import wraps
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not session.get('autenticado') or session.get('rol') != 'admin':
            return jsonify({'error': 'Acceso denegado — se requiere rol admin'}), 403
        if not _mongo_ok():
            return jsonify({'error': 'Base de datos no disponible'}), 503
        return f(*args, **kwargs)
    return wrapper


os.makedirs('static/data', exist_ok=True) 
os.makedirs('templates', exist_ok=True)

# Variables globales
vias_gdf            = None # GeoDataFrame de las vías cargadas ya limpias
grafo_vias          = None # Grafo de NetworkX construido a partir de vias_gdf
PuntosDinteres_dic  = {}
portales_gdf        = None # GeoDataFrame de portales (Num_portal.geojson)

# ==================== Carga de capas ====================

def _normalizar_nombre_via(nombre):
    """
    Normaliza un nombre de vía para comparación aproximada:
    minúsculas, sin tildes, sin prefijos de tipo (calle, avenida, etc.).
    """
    import unicodedata
    if not nombre:
        return ''
    nfd = unicodedata.normalize('NFD', str(nombre))
    sin_tildes = ''.join(c for c in nfd if unicodedata.category(c) != 'Mn')
    s = sin_tildes.lower().strip()
    for prefijo in ('calle ', 'avenida ', 'avda. ', 'avda ', 'plaza ', 'paseo ',
                    'carretera ', 'camino ', 'ronda ', 'travesia ', 'travesía ',
                    'glorieta ', 'rambla ', 'urbanizacion ', 'urbanización '):
        if s.startswith(prefijo):
            s = s[len(prefijo):]
            break
    return s.strip()


def capasDarranque():
    """Carga automática de Vías.geojson, PuntosDinteres.zip y Num_portal.geojson."""
    global vias_gdf, grafo_vias, PuntosDinteres_dic, portales_gdf

    vias_path   = os.path.join('static', 'data', 'Vías.geojson')
    puntos_path = os.path.join('static', 'data', 'PuntosDinteres.zip')

    if os.path.exists(vias_path):
        try:
            gdf = EPSG4326(vias_path)
            gdf['lanes']    = gdf['lanes'].apply(normalizar_lanes)       if 'lanes'    in gdf.columns else 1
            gdf['maxspeed'] = gdf['maxspeed'].apply(normalizar_maxspeed) if 'maxspeed' in gdf.columns else 50

            # Recorte automático con el perímetro de Puerto Lumbreras
            clip_path = os.path.join('static', 'data', 'PuertoLumbreras.zip')
            if os.path.exists(clip_path):
                try:
                    clip_dir = tempfile.mkdtemp(prefix='clip_init_')
                    with zipfile.ZipFile(clip_path) as z:
                        z.extractall(clip_dir)
                    shp = next((os.path.join(r, f)
                                for r, _, fs in os.walk(clip_dir)
                                for f in fs if f.endswith('.shp')), None)
                    if shp:
                        clip_gdf = EPSG4326(shp)
                        poligono = clip_gdf.unary_union
                        antes = len(gdf)
                        gdf = gdf[gdf.intersects(poligono)].reset_index(drop=True)
                        print(f"✂️  Recorte aplicado: {len(gdf)} de {antes} vías dentro del perímetro")
                    shutil.rmtree(clip_dir, ignore_errors=True)
                except Exception as e:
                    print(f"⚠️  No se pudo aplicar el recorte: {e}")

            vias_gdf   = gdf
            grafo_vias = crear_grafo(gdf)
            print(f"✅ Vías cargadas automáticamente: {len(gdf)} | Grafo: {grafo_vias.number_of_nodes()} nodos")
        except Exception as e:
            print(f"⚠️  No se pudo cargar Vías.geojson: {e}")

    if os.path.exists(puntos_path):
        try:
            extract_dir = tempfile.mkdtemp(prefix='puntos_init_')
            with zipfile.ZipFile(puntos_path) as z:
                z.extractall(extract_dir)
            shp_files = [os.path.join(r, f)
                         for r, _, fs in os.walk(extract_dir)
                         for f in fs if f.lower().endswith('.shp')]
            for shp in shp_files:
                nombre = os.path.splitext(os.path.basename(shp))[0]
                try:
                    gdf = EPSG4326(shp)
                    gdf = gdf[gdf.geometry.geom_type == 'Point']
                    if not gdf.empty:
                        PuntosDinteres_dic[nombre] = gdf
                except Exception as e:
                    print(f"  ⚠️ Error en {nombre}: {e}")
            shutil.rmtree(extract_dir, ignore_errors=True)
            print(f"✅ Puntos de interés cargados: {len(PuntosDinteres_dic)} capas")
        except Exception as e:
            print(f"⚠️  No se pudo cargar PuntosDinteres.zip: {e}")

    # ── Portales (Num_portal.geojson) ────────────────────────────────────────
    portales_path = os.path.join('static', 'data', 'Num_portal.geojson')
    if os.path.exists(portales_path):
        try:
            gdf = EPSG4258(portales_path)
            # Normalizar campos clave para búsqueda
            gdf['_nombre_norm'] = gdf['nombre_via'].apply(_normalizar_nombre_via)
            gdf['_numero_str']  = gdf['numero'].fillna('').astype(str).str.strip()
            portales_gdf = gdf
            print(f"✅ Portales cargados automáticamente: {len(gdf)} registros")
        except Exception as e:
            print(f"⚠️  No se pudo cargar Num_portal.geojson: {e}")


# ==================== API Portales ====================

@app.route('/api/buscar-portal')
def buscar_portal():
    """
    Busca portales (calle + número) en el GeoJSON de numeración postal.

    Query params:
      q      → texto libre, ej. "Hernán Cortés 3" o "CALLE GRANADA 12"
      nombre → nombre de vía (sin número)
      numero → número de portal

    Devuelve lista de candidatos con coordenadas EPSG:4258:
      [ { nombre_via, tipo_vial, numero, lat, lon, cod_postal, municipio }, … ]
    """
    import unicodedata

    if portales_gdf is None:
        return jsonify({'error': 'Capa de portales no cargada', 'resultados': []}), 503

    q      = request.args.get('q', '').strip()
    nombre = request.args.get('nombre', '').strip()
    numero = request.args.get('numero', '').strip()

    # ── Parsear query libre ─────────────────────────────────────────────────
    if q and not nombre:
        # Separar el último token numérico como número de portal
        partes = q.rsplit(None, 1)
        if len(partes) == 2 and partes[-1].isdigit():
            nombre, numero = partes[0], partes[-1]
        else:
            nombre = q

    if not nombre:
        return jsonify({'resultados': []})

    nombre_norm = _normalizar_nombre_via(nombre)
    numero_norm = numero.strip() if numero else ''

    # DEBUG
    print(f"🔍 Búsqueda: nombre_orig='{nombre}' => norm='{nombre_norm}', numero='{numero_norm}'")
    print(f"   GeoDataFrame tiene {len(portales_gdf)} registros, columnas: {list(portales_gdf.columns)}")

    df = portales_gdf.copy()

    # ── Filtro por nombre (contains normalizado) ────────────────────────────
    mask_nombre = df['_nombre_norm'].str.contains(nombre_norm, case=False, na=False, regex=False)
    df = df[mask_nombre]
    print(f"   Después de filtro por nombre: {len(df)} coincidencias")

    # ── Filtro por número si se proporcionó ────────────────────────────────
    if numero_norm:
        # Intentar coincidencia exacta primero
        mask_numero = df['_numero_str'] == numero_norm
        if not mask_numero.any():
            # Intenta sin ceros a la izquierda (ej "32" vs "032")
            mask_numero = df['_numero_str'].str.lstrip('0') == numero_norm.lstrip('0')
        if not mask_numero.any():
            # Intenta convertir a int para comparación numérica
            try:
                num_int = int(numero_norm)
                mask_numero = df['numero'].fillna('').astype(str).str.strip().astype(int) == num_int
            except:
                mask_numero = pd.Series([False] * len(df), index=df.index)
        
        df = df[mask_numero]
        print(f"   Después de filtro por número '{numero_norm}': {len(df)} coincidencias")

    if df.empty:
        print(f"   ❌ Sin resultados")
        return jsonify({'resultados': []})

    # ── Construir resultados ────────────────────────────────────────────────
    resultados = []
    for _, row in df.head(20).iterrows():
        coords = row.geometry
        resultado = {
            'nombre_via': str(row.get('nombre_via', '')),
            'tipo_vial':  str(row.get('tipo_vial',  '')),
            'numero':     str(row.get('numero',     '')),
            'extension':  str(row.get('extension',  '')),
            'cod_postal': str(row.get('cod_postal', '')),
            'municipio':  str(row.get('municipio',  '')),
            'lat': float(coords.y),  # Asegurar que es float
            'lon': float(coords.x),  # Asegurar que es float
        }
        resultados.append(resultado)
        print(f"   Portal: {resultado['nombre_via']} {resultado['numero']} -> ({resultado['lat']}, {resultado['lon']})")

    print(f"   ✅ Devolviendo {len(resultados)} resultado(s)")
    return jsonify({'resultados': resultados})


@app.route('/api/buscar-portal-numeros')
def buscar_portal_numeros():
    """
    Devuelve todos los números de portal disponibles para una calle dada.
    
    Query params:
      nombre → nombre de vía (ej. "Calle Francia")
    
    Devuelve:
      { numeros: [32, 45, 67, ...] }  (números ordenados numéricamente)
    """
    if portales_gdf is None:
        return jsonify({'numeros': []}), 503
    
    nombre = request.args.get('nombre', '').strip()
    if not nombre:
        return jsonify({'numeros': []})
    
    nombre_norm = _normalizar_nombre_via(nombre)
    
    # Filtrar portales por nombre
    mask = portales_gdf['_nombre_norm'].str.contains(nombre_norm, case=False, na=False, regex=False)
    df = portales_gdf[mask]
    
    if df.empty:
        return jsonify({'numeros': []})
    
    # Obtener números únicos y ordenarlos numéricamente
    numeros = df['numero'].dropna().astype(str).str.strip().unique()
    # Intentar convertir a int para ordenar numéricamente
    try:
        numeros_int = [int(n) if n.isdigit() else n for n in numeros]
        numeros_int.sort(key=lambda x: (isinstance(x, str), x))
        numeros = [str(n) for n in numeros_int]
    except:
        numeros = sorted(numeros)
    
    return jsonify({'numeros': numeros.tolist() if hasattr(numeros, 'tolist') else list(numeros)})


@app.route('/api/portal-por-coordenadas')
def portal_por_coordenadas():
    """
    Devuelve el portal más cercano a unas coordenadas dadas.

    Query params:
      lat → latitud
      lon → longitud
      radio → radio de búsqueda en metros (defecto 100)
    """
    if portales_gdf is None:
        return jsonify({'error': 'Capa de portales no cargada'}), 503

    try:
        lat   = float(request.args.get('lat'))
        lon   = float(request.args.get('lon'))
        radio = float(request.args.get('radio', 100))
    except (TypeError, ValueError):
        return jsonify({'error': 'Parámetros inválidos'}), 400

    punto = Point(lon, lat)

    # Calcular distancia en metros a todos los portales
    dists = portales_gdf.geometry.apply(
        lambda g: distanciaLatLon((lat, lon), (g.y, g.x))
    )
    idx_min = dists.idxmin()
    dist_min = dists[idx_min]

    if dist_min > radio:
        return jsonify({'resultado': None, 'distancia': dist_min})

    row = portales_gdf.loc[idx_min]
    return jsonify({
        'resultado': {
            'nombre_via': row.get('nombre_via', ''),
            'tipo_vial':  row.get('tipo_vial',  ''),
            'numero':     row.get('numero',     ''),
            'cod_postal': row.get('cod_postal', ''),
            'municipio':  row.get('municipio',  ''),
            'provincia':  row.get('provincia',  ''),
            'lat': row.geometry.y,
            'lon': row.geometry.x,
        },
        'distancia': round(dist_min, 1)
    })


@app.route('/api/portales/estado')
def portales_estado():
    """Devuelve si la capa de portales está cargada y cuántos registros tiene."""
    if portales_gdf is None:
        return jsonify({'cargado': False, 'total': 0, 'columnas': []})
    
    # Mostrar primeros registros y estructura para debug
    muestra = []
    if len(portales_gdf) > 0:
        for idx, (_, row) in enumerate(portales_gdf.head(3).iterrows()):
            muestra.append({
                'nombre_via': str(row.get('nombre_via', '?')),
                'numero': str(row.get('numero', '?')),
                'tipo_vial': str(row.get('tipo_vial', '?')),
                'lat': row.geometry.y,
                'lon': row.geometry.x,
            })
    
    return jsonify({
        'cargado': True, 
        'total': len(portales_gdf),
        'columnas': list(portales_gdf.columns),
        'muestra': muestra
    })


# ==================== Ruta ====================

# Página principal
@app.route('/')
def index():
    ua = request.headers.get('User-Agent', '')
    es_movil = any(x in ua for x in ['Mobile', 'Android', 'iPhone', 'iPad'])
    if es_movil:
        # En movil, si no hay sesion activa, crear una de invitado automaticamente
        # para evitar que el JS muestre el modal de registro al arrancar.
        if not session.get('autenticado'):
            session['autenticado'] = True
            session['usuario']     = 'Invitado'
            session['invitado']    = True
            session['rol']         = 'invitado'
        return render_template('mobile.html')
    
    # Para desktop, verificar autenticación
    if not session.get('autenticado'):
        return redirect(url_for('login_page'))
    return render_template('index.html')


@app.route('/login')
def login_page():
    return render_template('login.html')


@app.route('/admin/usuarios')
def admin_usuarios_page():
    """Panel de administración de usuarios — solo admin."""
    if not session.get('autenticado') or session.get('rol') != 'admin':
        return redirect(url_for('login_page'))
    return render_template('admin_usuarios.html')


# ── Auth con MongoDB ─────────────────────────────────────────────────────────

@app.route('/api/auth/entrar', methods=['POST'])
def api_entrar():
    """Login real contra MongoDB. Fallback legacy si MongoDB no está disponible."""
    data     = request.get_json(force=True, silent=True) or {}
    invitado = data.get('invitado', False)

    # Modo invitado — siempre disponible
    if invitado:
        session['autenticado'] = True
        session['usuario']     = 'Invitado'
        session['invitado']    = True
        session['rol']         = 'invitado'
        return jsonify({'ok': True, 'rol': 'invitado', 'usuario': 'Invitado'})

    email    = data.get('email', '').strip().lower()
    password = data.get('password', '')

    # Login con MongoDB
    if _mongo_ok() and email and password:
        doc = _col_usuarios.find_one({'email': email})
        if not doc:
            return jsonify({'ok': False, 'error': 'Email o contraseña incorrectos'}), 401
        if not doc.get('activo', True):
            return jsonify({'ok': False, 'error': 'Cuenta desactivada. Contacta con el administrador.'}), 403
        if not _verificar_password(password, doc['password_hash']):
            return jsonify({'ok': False, 'error': 'Email o contraseña incorrectos'}), 401

        _col_usuarios.update_one({'_id': doc['_id']}, {'$set': {'ultimo_acceso': datetime.utcnow()}})

        rol      = doc.get('rol', 'registrado')
        username = doc.get('username', email)
        session['autenticado'] = True
        session['usuario']     = username
        session['email']       = email
        session['invitado']    = False
        session['rol']         = rol
        session['user_id']     = str(doc['_id'])
        return jsonify({'ok': True, 'rol': rol, 'usuario': username})

    # Fallback legacy (MongoDB no disponible)
    usuario = data.get('usuario', '').strip() or 'Invitado'
    if usuario.lower() == 'admin':
        rol = 'admin'
    elif usuario and usuario != 'Invitado':
        rol = 'registrado'
    else:
        rol     = 'invitado'
        usuario = 'Invitado'

    session['autenticado'] = True
    session['usuario']     = usuario
    session['invitado']    = (rol == 'invitado')
    session['rol']         = rol
    return jsonify({'ok': True, 'rol': rol, 'usuario': usuario})


@app.route('/api/auth/registrar', methods=['POST'])
def api_registrar():
    """Registro de nuevo usuario. Requiere MongoDB activo."""
    if not _mongo_ok():
        return jsonify({'ok': False, 'error': 'Base de datos no disponible'}), 503

    data     = request.get_json(force=True, silent=True) or {}
    username = data.get('username', '').strip()
    email    = data.get('email', '').strip().lower()
    password = data.get('password', '')

    if not username or not email or not password:
        return jsonify({'ok': False, 'error': 'Todos los campos son obligatorios'}), 400
    if len(password) < 6:
        return jsonify({'ok': False, 'error': 'La contraseña debe tener al menos 6 caracteres'}), 400
    if '@' not in email:
        return jsonify({'ok': False, 'error': 'Email no válido'}), 400

    try:
        _col_usuarios.insert_one({
            'username':       username,
            'email':          email,
            'password_hash':  _hash_password(password),
            'rol':            'registrado',
            'activo':         True,
            'fecha_registro': datetime.utcnow(),
            'ultimo_acceso':  None,
        })
        return jsonify({'ok': True, 'mensaje': 'Usuario registrado correctamente'})
    except DuplicateKeyError:
        return jsonify({'ok': False, 'error': 'El email o nombre de usuario ya está en uso'}), 409
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/auth/cambiar-password', methods=['POST'])
def api_cambiar_password():
    """Cambia la contraseña del usuario autenticado."""
    if not session.get('autenticado') or session.get('invitado'):
        return jsonify({'ok': False, 'error': 'No autenticado'}), 401
    if not _mongo_ok():
        return jsonify({'ok': False, 'error': 'Base de datos no disponible'}), 503

    data         = request.get_json(force=True, silent=True) or {}
    password_old = data.get('password_old', '')
    password_new = data.get('password_new', '')

    if len(password_new) < 6:
        return jsonify({'ok': False, 'error': 'La nueva contraseña debe tener al menos 6 caracteres'}), 400

    doc = _col_usuarios.find_one({'_id': ObjectId(session['user_id'])})
    if not doc or not _verificar_password(password_old, doc['password_hash']):
        return jsonify({'ok': False, 'error': 'Contraseña actual incorrecta'}), 401

    _col_usuarios.update_one(
        {'_id': doc['_id']},
        {'$set': {'password_hash': _hash_password(password_new)}}
    )
    return jsonify({'ok': True, 'mensaje': 'Contraseña actualizada'})


@app.route('/api/auth/me')
def api_me():
    if not session.get('autenticado'):
        return jsonify({'autenticado': False}), 401
    return jsonify({
        'autenticado':  True,
        'usuario':      session.get('usuario', 'Invitado'),
        'email':        session.get('email', ''),
        'invitado':     session.get('invitado', True),
        'rol':          session.get('rol', 'invitado'),
        'mongo_activo': _mongo_ok(),
    })


@app.route('/api/auth/salir', methods=['POST'])
def api_salir():
    session.clear()
    return jsonify({'ok': True})


# ── API Administración de usuarios (solo admin) ───────────────────────────────

@app.route('/api/admin/usuarios')
@_requiere_admin
def admin_listar_usuarios():
    """Lista todos los usuarios sin exponer password_hash."""
    docs = list(_col_usuarios.find({}, {'password_hash': 0}))
    return jsonify({'usuarios': [_usuario_a_dict(d) for d in docs]})

@app.route('/api/admin/usuarios/online')
@_requiere_admin
def admin_usuarios_online():
    """Lista usuarios con estado online aproximado (último acceso < 15 min)."""
    docs = list(_col_usuarios.find({}, {'password_hash': 0}))
    ahora = datetime.utcnow()
    resultado = []
    for d in docs:
        ua = d.get('ultimo_acceso')
        online = isinstance(ua, datetime) and (ahora - ua).total_seconds() < 900
        resultado.append({
            'username':      d.get('username', ''),
            'rol':           d.get('rol', 'registrado'),
            'online':        online,
            'ultimo_acceso': ua.isoformat() if isinstance(ua, datetime) else None,
        })
    return jsonify({'usuarios': resultado})

@app.route('/api/admin/usuarios', methods=['POST'])
@_requiere_admin
def admin_crear_usuario():
    """El admin crea un usuario nuevo con rol a elegir."""
    data     = request.get_json(force=True, silent=True) or {}
    username = data.get('username', '').strip()
    email    = data.get('email', '').strip().lower()
    password = data.get('password', '')
    rol      = data.get('rol', 'registrado')

    if rol not in ('registrado', 'admin'):
        return jsonify({'ok': False, 'error': 'Rol no válido'}), 400
    if not username or not email or not password:
        return jsonify({'ok': False, 'error': 'Todos los campos son obligatorios'}), 400
    if len(password) < 6:
        return jsonify({'ok': False, 'error': 'La contraseña debe tener al menos 6 caracteres'}), 400

    try:
        _col_usuarios.insert_one({
            'username':       username,
            'email':          email,
            'password_hash':  _hash_password(password),
            'rol':            rol,
            'activo':         True,
            'fecha_registro': datetime.utcnow(),
            'ultimo_acceso':  None,
        })
        return jsonify({'ok': True, 'mensaje': f'Usuario {username} creado'})
    except DuplicateKeyError:
        return jsonify({'ok': False, 'error': 'El email o nombre de usuario ya está en uso'}), 409
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/admin/usuarios/<user_id>', methods=['PATCH'])
@_requiere_admin
def admin_editar_usuario(user_id):
    """Edita rol, estado activo, username, email o resetea contraseña."""
    data = request.get_json(force=True, silent=True) or {}

    # Proteger al admin que hace la petición
    if user_id == session.get('user_id'):
        if data.get('rol') and data['rol'] != 'admin':
            return jsonify({'ok': False, 'error': 'No puedes quitarte el rol de administrador a ti mismo'}), 400
        if data.get('activo') is False:
            return jsonify({'ok': False, 'error': 'No puedes desactivar tu propia cuenta'}), 400

    cambios = {}
    if 'rol' in data and data['rol'] in ('registrado', 'admin'):
        cambios['rol'] = data['rol']
    if 'activo' in data and isinstance(data['activo'], bool):
        cambios['activo'] = data['activo']
    if 'username' in data and data['username'].strip():
        cambios['username'] = data['username'].strip()
    if 'email' in data and '@' in data['email']:
        cambios['email'] = data['email'].strip().lower()
    if 'password_nueva' in data and len(data['password_nueva']) >= 6:
        cambios['password_hash'] = _hash_password(data['password_nueva'])

    if not cambios:
        return jsonify({'ok': False, 'error': 'Sin cambios válidos'}), 400

    try:
        result = _col_usuarios.update_one({'_id': ObjectId(user_id)}, {'$set': cambios})
        if result.matched_count == 0:
            return jsonify({'ok': False, 'error': 'Usuario no encontrado'}), 404
        return jsonify({'ok': True, 'mensaje': 'Usuario actualizado'})
    except DuplicateKeyError:
        return jsonify({'ok': False, 'error': 'El email o nombre de usuario ya está en uso'}), 409
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/admin/usuarios/<user_id>', methods=['DELETE'])
@_requiere_admin
def admin_eliminar_usuario(user_id):
    """Elimina un usuario. El admin no puede eliminarse a sí mismo."""
    if user_id == session.get('user_id'):
        return jsonify({'ok': False, 'error': 'No puedes eliminar tu propia cuenta'}), 400

    result = _col_usuarios.delete_one({'_id': ObjectId(user_id)})
    if result.deleted_count == 0:
        return jsonify({'ok': False, 'error': 'Usuario no encontrado'}), 404
    return jsonify({'ok': True, 'mensaje': 'Usuario eliminado'})


@app.route('/api/status')
# Devuelve el estado actual del servidor y las capas cargadas
def status():
    info = {
        'status': 'online',
        'vias_cargadas': vias_gdf is not None,
        'grafo_listo':   grafo_vias is not None,
        'puntos_capas':  list(PuntosDinteres_dic.keys()),
    }
    if vias_gdf is not None:
        info['vias_count'] = len(vias_gdf)
    return jsonify(info)


# ==================== Vías ====================

@app.route('/api/cargar-vias', methods=['POST'])
def cargar_vias():
    global vias_gdf, grafo_vias

    if 'file' not in request.files or request.files['file'].filename == '':
        return jsonify({'error': 'No se envió ningún archivo'}), 400

    try:
        file  = request.files['file']
        fname = file.filename.lower()

        if fname.endswith('.shp'):
            return jsonify({'error': 'Sube el shapefile comprimido en .zip (con .shp, .dbf, .shx y .prj juntos)'}), 400
        elif fname.endswith(('.geojson', '.json')):
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], 'vias_temp.geojson')
            file.save(filepath)
        elif fname.endswith('.zip'):
            zip_path = os.path.join(app.config['UPLOAD_FOLDER'], 'vias_upload.zip')
            file.save(zip_path)
            extract_dir = os.path.join(app.config['UPLOAD_FOLDER'], 'vias_shp_extract')
            os.makedirs(extract_dir, exist_ok=True)
            with zipfile.ZipFile(zip_path) as z:
                z.extractall(extract_dir)
            shp = next((os.path.join(r, f)
                        for r, _, fs in os.walk(extract_dir)
                        for f in fs if f.endswith('.shp')), None)
            if not shp:
                return jsonify({'error': 'No se encontró .shp en el ZIP'}), 400
            filepath = shp
        else:
            return jsonify({'error': 'Formato no soportado. Use .geojson, .shp o .zip'}), 400

        gdf = EPSG4326(filepath)

        b = gdf.total_bounds
        if not (-180 <= b[0] <= 180 and -180 <= b[2] <= 180 and -90 <= b[1] <= 90 and -90 <= b[3] <= 90):
            return jsonify({'error': 'Coordenadas fuera de rango EPSG:4326'}), 400

        gdf['lanes']    = gdf['lanes'].apply(normalizar_lanes)       if 'lanes'    in gdf.columns else 1
        gdf['maxspeed'] = gdf['maxspeed'].apply(normalizar_maxspeed) if 'maxspeed' in gdf.columns else 50

        vias_gdf   = gdf
        grafo_vias = crear_grafo(gdf)

        print(f"✅ Vías: {len(gdf)} | Grafo: {grafo_vias.number_of_nodes()} nodos, {grafo_vias.number_of_edges()} aristas")

        return jsonify({
            'mensaje':       f'{len(gdf)} vías cargadas',
            'total_vias':    len(gdf),
            'nodos_grafo':   grafo_vias.number_of_nodes(),
            'aristas_grafo': grafo_vias.number_of_edges(),
            'columnas':      list(gdf.columns),
            'bounds':        b.tolist(),
            'crs':           str(gdf.crs),
        })

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/obtener-vias')
def obtener_vias():
    if vias_gdf is None:
        return jsonify({'error': 'No hay vías cargadas'}), 404
    try:
        return gdf_json(vias_gdf)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/eliminar-vias', methods=['POST'])
def eliminar_vias():
    global vias_gdf, grafo_vias
    vias_gdf = grafo_vias = None

    # Intentar restaurar la capa OSM por defecto (Vías.geojson)
    vias_path = os.path.join('static', 'data', 'Vías.geojson')
    if os.path.exists(vias_path):
        try:
            gdf = EPSG4326(vias_path)
            gdf['lanes']    = gdf['lanes'].apply(normalizar_lanes)       if 'lanes'    in gdf.columns else 1
            gdf['maxspeed'] = gdf['maxspeed'].apply(normalizar_maxspeed) if 'maxspeed' in gdf.columns else 50

            clip_path = os.path.join('static', 'data', 'PuertoLumbreras.zip')
            if os.path.exists(clip_path):
                try:
                    clip_dir = tempfile.mkdtemp(prefix='clip_restore_')
                    with zipfile.ZipFile(clip_path) as z:
                        z.extractall(clip_dir)
                    shp = next((os.path.join(r, f)
                                for r, _, fs in os.walk(clip_dir)
                                for f in fs if f.endswith('.shp')), None)
                    if shp:
                        clip_gdf = EPSG4326(shp)
                        gdf = gdf[gdf.intersects(clip_gdf.unary_union)].reset_index(drop=True)
                    shutil.rmtree(clip_dir, ignore_errors=True)
                except Exception:
                    pass

            vias_gdf   = gdf
            grafo_vias = crear_grafo(gdf)
            print(f'[eliminar-vias] OSM restaurada: {len(gdf)} vias')
            return jsonify({
                'mensaje':        'Capa eliminada — vías OSM restauradas',
                'osm_restaurada': True,
                'total_vias':     len(gdf),
                'nodos_grafo':    grafo_vias.number_of_nodes(),
            })
        except Exception as e:
            print(f'[eliminar-vias] No se pudo restaurar OSM: {e}')

    return jsonify({'mensaje': 'Vias eliminadas', 'osm_restaurada': False})


@app.route('/api/recortar-capa', methods=['POST'])
def recortar_capa():
    global vias_gdf, grafo_vias

    if vias_gdf is None:
        return jsonify({'error': 'No hay vías cargadas'}), 404
    if 'file' not in request.files:
        return jsonify({'error': 'Falta el archivo polígono'}), 400

    try:
        file  = request.files['file']
        fname = file.filename.lower()

        if fname.endswith('.zip'):
            zip_path = os.path.join(app.config['UPLOAD_FOLDER'], 'clip.zip')
            file.save(zip_path)
            extract_dir = os.path.join(app.config['UPLOAD_FOLDER'], 'clip_extract')
            os.makedirs(extract_dir, exist_ok=True)
            with zipfile.ZipFile(zip_path) as z:
                z.extractall(extract_dir)
            shp = next((os.path.join(r, f)
                        for r, _, fs in os.walk(extract_dir)
                        for f in fs if f.endswith('.shp')), None)
            if not shp:
                return jsonify({'error': 'No se encontró .shp en el ZIP'}), 400
            clip_path = shp
        elif fname.endswith(('.geojson', '.json')):
            clip_path = os.path.join(app.config['UPLOAD_FOLDER'], 'clip.geojson')
            file.save(clip_path)
        else:
            return jsonify({'error': 'Formato no soportado (.geojson o .zip)'}), 400

        clip_gdf  = EPSG4326(clip_path)
        poligono  = clip_gdf.unary_union
        antes     = len(vias_gdf)
        vias_gdf  = vias_gdf[vias_gdf.intersects(poligono)].reset_index(drop=True)
        grafo_vias = crear_grafo(vias_gdf)

        return jsonify({
            'mensaje':       f'Vías recortadas: {len(vias_gdf)} de {antes}',
            'total_antes':   antes,
            'total_despues': len(vias_gdf),
            'eliminados':    antes - len(vias_gdf),
            'nodos_grafo':   grafo_vias.number_of_nodes(),
            'aristas_grafo': grafo_vias.number_of_edges(),
            'bounds':        vias_gdf.total_bounds.tolist(),
        })

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ==================== PUNTOS DE INTERÉS ====================

@app.route('/api/cargar-puntos-interes', methods=['POST'])
def cargar_puntos_interes():
    global PuntosDinteres_dic

    if 'file' not in request.files or not request.files['file'].filename.lower().endswith('.zip'):
        return jsonify({'error': 'Se requiere un archivo .zip con shapefiles'}), 400

    try:
        zip_path    = os.path.join(app.config['UPLOAD_FOLDER'], 'puntos.zip')
        extract_dir = tempfile.mkdtemp(prefix='puntos_')
        request.files['file'].save(zip_path)

        try:
            with zipfile.ZipFile(zip_path) as z:
                z.extractall(extract_dir)

            shp_files = [os.path.join(r, f)
                         for r, _, fs in os.walk(extract_dir)
                         for f in fs if f.lower().endswith('.shp')]

            if not shp_files:
                return jsonify({'error': 'No se encontraron .shp en el ZIP'}), 400

            PuntosDinteres_dic.clear()
            total_puntos = 0

            for shp in shp_files:
                nombre = os.path.splitext(os.path.basename(shp))[0]
                try:
                    gdf = EPSG4326(shp)
                    gdf = gdf[gdf.geometry.geom_type == 'Point']
                    if gdf.empty:
                        continue
                    PuntosDinteres_dic[nombre] = gdf
                    total_puntos += len(gdf)
                except Exception as e:
                    print(f"  ⚠️ Error en {nombre}: {e}")

            if not PuntosDinteres_dic:
                return jsonify({'error': 'No se pudo cargar ninguna capa válida'}), 400

            return jsonify({
                'mensaje':      f'{len(PuntosDinteres_dic)} capas cargadas',
                'capas':        list(PuntosDinteres_dic.keys()),
                'total_capas':  len(PuntosDinteres_dic),
                'total_puntos': total_puntos,
            })

        finally:
            shutil.rmtree(extract_dir, ignore_errors=True)

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/obtener-puntos-interes')
def obtener_puntos_interes():
    if not PuntosDinteres_dic:
        return jsonify({'error': 'No hay puntos cargados'}), 404
    try:
        features   = []
        capas_info = {}
        for nombre, gdf in PuntosDinteres_dic.items():
            gdf_copy = gdf.copy()
            for col in gdf_copy.columns:
                if col != 'geometry':
                    try: gdf_copy[col] = gdf_copy[col].astype(str)
                    except: pass
            data = json.loads(gdf_copy.to_json())
            for feat in data['features']:
                feat['properties']['_capa'] = nombre
                features.append(feat)
            capas_info[nombre] = {'total': len(gdf)}
        result = {'type': 'FeatureCollection', 'features': features, 'capas': capas_info}
        return Response(json.dumps(result, ensure_ascii=False),
                        mimetype='application/json; charset=utf-8')
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/eliminar-puntos-interes', methods=['POST'])
def eliminar_puntos_interes():
    PuntosDinteres_dic.clear()
    return jsonify({'mensaje': 'Puntos eliminados'})


# ── Capa _manual: añadir / eliminar POIs individuales ──────────────────────

_MANUAL_LAYER = '_manual'   # nombre reservado para POIs creados manualmente

def _asegurar_capa_manual():
    """Crea la capa _manual en PuntosDinteres_dic si no existe."""
    if _MANUAL_LAYER not in PuntosDinteres_dic:
        PuntosDinteres_dic[_MANUAL_LAYER] = gpd.GeoDataFrame(
            columns=['geometry', 'nombre', 'tipo', 'poi_id'],
            geometry='geometry',
            crs='EPSG:4326'
        )

def _total_pois_manuales():
    capa = PuntosDinteres_dic.get(_MANUAL_LAYER)
    return 0 if capa is None else len(capa)


@app.route('/api/añadir-poi', methods=['POST'])
def añadir_poi():
    """
    Añade un punto a la capa _manual.
    Body JSON: { lat, lon, nombre, tipo, poi_id? }
    """
    global PuntosDinteres_dic
    data = request.get_json(force=True, silent=True) or {}

    try:
        lat   = float(data['lat'])
        lon   = float(data['lon'])
    except (KeyError, TypeError, ValueError):
        return jsonify({'error': 'Faltan o son inválidos lat/lon'}), 400

    nombre = str(data.get('nombre', '')).strip() or 'POI sin nombre'
    tipo   = str(data.get('tipo',   '')).strip()
    poi_id = str(data.get('poi_id', '')).strip() or None

    _asegurar_capa_manual()
    capa = PuntosDinteres_dic[_MANUAL_LAYER]

    # Comprobar ID duplicado si se proporcionó
    if poi_id and 'poi_id' in capa.columns and poi_id in capa['poi_id'].values:
        return jsonify({'error': f'El ID "{poi_id}" ya existe en la capa manual'}), 409

    nueva_fila = gpd.GeoDataFrame(
        [{'geometry': Point(lon, lat), 'nombre': nombre, 'tipo': tipo, 'poi_id': poi_id}],
        crs='EPSG:4326'
    )
    PuntosDinteres_dic[_MANUAL_LAYER] = gpd.GeoDataFrame(
        pd.concat([capa, nueva_fila], ignore_index=True),
        crs='EPSG:4326'
    )

    total = len(PuntosDinteres_dic[_MANUAL_LAYER])
    return jsonify({'mensaje': 'POI añadido', 'total_manual': total})


@app.route('/api/eliminar-poi', methods=['POST'])
def eliminar_poi():
    """
    Elimina un POI de la capa _manual por poi_id o índice.
    Body JSON: { poi_id } o { idx }
    """
    global PuntosDinteres_dic
    data = request.get_json(force=True, silent=True) or {}

    if _MANUAL_LAYER not in PuntosDinteres_dic:
        return jsonify({'error': 'No hay POIs manuales'}), 404

    capa = PuntosDinteres_dic[_MANUAL_LAYER]

    if 'poi_id' in data and data['poi_id'] is not None:
        mascara = capa['poi_id'] == str(data['poi_id'])
        if not mascara.any():
            return jsonify({'error': f'POI con id "{data["poi_id"]}" no encontrado'}), 404
        capa = capa[~mascara].reset_index(drop=True)
    elif 'idx' in data:
        idx = int(data['idx'])
        if idx < 0 or idx >= len(capa):
            return jsonify({'error': 'Índice fuera de rango'}), 400
        capa = capa.drop(index=idx).reset_index(drop=True)
    else:
        return jsonify({'error': 'Se requiere poi_id o idx'}), 400

    PuntosDinteres_dic[_MANUAL_LAYER] = capa
    return jsonify({'mensaje': 'POI eliminado', 'total_manual': len(capa)})


@app.route('/api/importar-pois', methods=['POST'])
def importar_pois():
    """
    Importa POIs desde .gpkg / .geojson / .shp / .zip / .csv
    y los AÑADE a la capa _manual (no reemplaza).
    """
    global PuntosDinteres_dic

    if 'file' not in request.files:
        return jsonify({'error': 'No se recibió ningún archivo'}), 400

    archivo = request.files['file']
    nombre  = archivo.filename.lower()

    tmp_dir = tempfile.mkdtemp(prefix='poi_import_')
    try:
        if nombre.endswith('.csv'):
            import io
            contenido = archivo.read().decode('utf-8-sig', errors='replace')
            df = pd.read_csv(io.StringIO(contenido))
            df.columns = [c.strip().lower() for c in df.columns]
            lat_col = next((c for c in df.columns if c in ('lat', 'latitud', 'latitude', 'coord_lat')), None)
            lon_col = next((c for c in df.columns if c in ('lon', 'lng', 'longitud', 'longitude', 'coord_lon')), None)
            if not lat_col or not lon_col:
                return jsonify({'error': 'El CSV debe tener columnas de latitud y longitud'}), 400
            df = df.dropna(subset=[lat_col, lon_col])
            geometrias = [Point(row[lon_col], row[lat_col]) for _, row in df.iterrows()]
            gdf = gpd.GeoDataFrame(df, geometry=geometrias, crs='EPSG:4326')
        else:
            if nombre.endswith('.zip'):
                zip_path = os.path.join(tmp_dir, archivo.filename)
                archivo.save(zip_path)
                with zipfile.ZipFile(zip_path) as zf:
                    zf.extractall(tmp_dir)
                ruta = next((os.path.join(r, f)
                             for r, _, fs in os.walk(tmp_dir)
                             for f in fs if f.lower().endswith('.shp')), None)
                if not ruta:
                    return jsonify({'error': 'No se encontró .shp dentro del ZIP'}), 400
            else:
                ruta = os.path.join(tmp_dir, archivo.filename)
                archivo.save(ruta)

            gdf = gpd.read_file(ruta)
            if gdf.crs is None:
                gdf = gdf.set_crs('EPSG:4326')
            elif gdf.crs.to_epsg() != 4326:
                gdf = gdf.to_crs('EPSG:4326')

        gdf = gdf[gdf.geometry.geom_type == 'Point'].reset_index(drop=True)
        if gdf.empty:
            return jsonify({'error': 'El archivo no contiene puntos válidos'}), 400

        # Normalizar columnas nombre / tipo / poi_id
        cols = [c.lower() for c in gdf.columns]
        def _col(opciones):
            for op in opciones:
                if op in cols:
                    return gdf.columns[[c.lower() for c in gdf.columns].index(op)]
            return None

        nom_col  = _col(['nombre', 'name', 'denominaci', 'denCorta'])
        tipo_col = _col(['tipo', 'amenity', 'type', 'building', 'tipo_centr'])
        id_col   = _col(['poi_id', 'id', 'fid'])

        _asegurar_capa_manual()

        nuevas_filas = []
        for _, row in gdf.iterrows():
            nuevas_filas.append({
                'geometry': row.geometry,
                'nombre':   str(row[nom_col]).strip()  if nom_col  else '',
                'tipo':     str(row[tipo_col]).strip() if tipo_col else '',
                'poi_id':   str(row[id_col]).strip()   if id_col   else None,
            })

        nueva_gdf = gpd.GeoDataFrame(nuevas_filas, crs='EPSG:4326')
        PuntosDinteres_dic[_MANUAL_LAYER] = gpd.GeoDataFrame(
            pd.concat([PuntosDinteres_dic[_MANUAL_LAYER], nueva_gdf], ignore_index=True),
            crs='EPSG:4326'
        )

        total = len(PuntosDinteres_dic[_MANUAL_LAYER])
        return jsonify({'mensaje': f'{len(nuevas_filas)} POI(s) importados', 'total_manual': total,
                        'importados': len(nuevas_filas)})

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


@app.route('/api/exportar-pois', methods=['POST'])
def exportar_pois():
    """
    Exporta la capa _manual como .gpkg, .shp (zip) o .csv.
    Body JSON: { formato: 'gpkg'|'shp'|'csv' }
    """
    global PuntosDinteres_dic

    if _MANUAL_LAYER not in PuntosDinteres_dic or PuntosDinteres_dic[_MANUAL_LAYER].empty:
        return jsonify({'error': 'No hay POIs manuales que exportar'}), 400

    data    = request.get_json(force=True, silent=True) or {}
    formato = data.get('formato', 'gpkg').lower()
    capa    = PuntosDinteres_dic[_MANUAL_LAYER].copy()

    fecha   = datetime.now().strftime('%Y%m%d_%H%M%S')
    tmp_dir = tempfile.mkdtemp(prefix='poi_export_')

    try:
        if formato == 'csv':
            rows = []
            for _, row in capa.iterrows():
                rows.append({
                    'poi_id': row.get('poi_id', ''),
                    'nombre': row.get('nombre', ''),
                    'tipo':   row.get('tipo', ''),
                    'lat':    row.geometry.y,
                    'lon':    row.geometry.x,
                })
            import io
            import csv as csv_mod
            buf = io.StringIO()
            writer = csv_mod.DictWriter(buf, fieldnames=['poi_id','nombre','tipo','lat','lon'])
            writer.writeheader()
            writer.writerows(rows)
            return Response(
                buf.getvalue().encode('utf-8-sig'),
                mimetype='text/csv; charset=utf-8',
                headers={'Content-Disposition': f'attachment; filename=pois_{fecha}.csv'}
            )

        if formato == 'shp':
            shp_path = os.path.join(tmp_dir, 'pois.shp')
            capa.to_file(shp_path, driver='ESRI Shapefile')
            zip_path = os.path.join(tmp_dir, 'pois_shapefile.zip')
            with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
                for root, _, files in os.walk(tmp_dir):
                    for filename in files:
                        if filename.lower().endswith(('.shp', '.shx', '.dbf', '.prj', '.cpg')):
                            zf.write(os.path.join(root, filename), arcname=filename)
            return send_file(zip_path, mimetype='application/zip',
                             as_attachment=True, download_name=f'pois_{fecha}.zip')

        # gpkg por defecto
        gpkg_path = os.path.join(tmp_dir, 'pois.gpkg')
        capa.to_file(gpkg_path, driver='GPKG', layer='pois')
        return send_file(gpkg_path, mimetype='application/geopackage+sqlite3',
                         as_attachment=True, download_name=f'pois_{fecha}.gpkg')

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/limpiar-pois-manuales', methods=['POST'])
def limpiar_pois_manuales():
    """Vacía solo la capa _manual, dejando las capas del ZIP intactas."""
    global PuntosDinteres_dic
    if _MANUAL_LAYER in PuntosDinteres_dic:
        PuntosDinteres_dic[_MANUAL_LAYER] = gpd.GeoDataFrame(
            columns=['geometry', 'nombre', 'tipo', 'poi_id'],
            geometry='geometry',
            crs='EPSG:4326'
        )
    return jsonify({'mensaje': 'POIs manuales eliminados'})


# ==================== GRAFO Y RUTAS ====================

FACTORES_VIA = {
    'motorway': 0.7,       'motorway_link': 0.75,
    'trunk': 0.8,          'trunk_link': 0.85,
    'primary': 0.9,        'primary_link': 0.95,
    'secondary': 1.0,      'secondary_link': 1.05,
    'tertiary': 1.1,       'tertiary_link': 1.15,
    'unclassified': 1.2,   'residential': 1.25,
    'living_street': 1.3,  'service': 1.35,
    'road': 1.2,           'track': 1.5,
    'path': 1.6,           'footway': 2.0,
    'pedestrian': 2.0,     'steps': 3.0,
}


# ==================== VEHÍCULO PESADO ====================

# Ancho estimado por carril según tipo de vía OSM (metros)
ANCHO_CARRIL_POR_TIPO = {
    'motorway':      3.75, 'motorway_link':  3.50,
    'trunk':         3.50, 'trunk_link':     3.25,
    'primary':       3.50, 'primary_link':   3.25,
    'secondary':     3.25, 'secondary_link': 3.00,
    'tertiary':      3.00, 'tertiary_link':  2.90,
    'unclassified':  2.90,
    'residential':   3.00,   # en España suele ser mínimo 3 m
    'living_street': 2.75,
    'service':       3.00,
    'road':          2.90,
    'track':         2.50,
    'path':          1.50,
    'footway':       1.50,
    'pedestrian':    2.00,
    'steps':         1.00,
}

# Vías exclusivamente peatonales: prohibidas para TODOS los vehículos.
# Se excluyen del grafo al construirlo → Dijkstra nunca las considera.
TIPOS_PROHIBIDOS_VEHICULOS = {'footway', 'pedestrian', 'steps', 'path', 'cycleway'}

# Vías que un camión no puede usar físicamente bajo ningún concepto
# (subconjunto de las anteriores + algunas adicionales por anchura)
TIPOS_PROHIBIDOS_CAMION = TIPOS_PROHIBIDOS_VEHICULOS

# Ancho mínimo cómodo para un camión (2.55 m de vehículo + margen)
ANCHO_COMODO_CAMION  = 3.5   # por debajo → penalizar, no eliminar
ANCHO_MINIMO_CAMION  = 2.8   # por debajo → penalizar fuerte (×20), pero no eliminar

# Ángulos de giro: solo penalizar, nunca eliminar aristas
MAX_ANGULO_PENALIZAR = 120   # giros > 80° empiezan a penalizarse
MAX_ANGULO_FUERTE    = 120  # giros > 120° penalización máxima (×10)


def _angulo_giro(nodo_prev, nodo_actual, nodo_next):
    """
    Calcula el ángulo de cambio de dirección en nodo_actual.
    Devuelve grados [0, 180]: 0° = recto, 90° = escuadra, 180° = inversión.
    """
    vx_in  = nodo_actual[0] - nodo_prev[0]
    vy_in  = nodo_actual[1] - nodo_prev[1]
    vx_out = nodo_next[0]   - nodo_actual[0]
    vy_out = nodo_next[1]   - nodo_actual[1]
    mag_in  = sqrt(vx_in**2  + vy_in**2)
    mag_out = sqrt(vx_out**2 + vy_out**2)
    if mag_in < 1e-12 or mag_out < 1e-12:
        return 0.0
    angulo = degrees(atan2(
        abs(vx_in * vy_out - vy_in * vx_out),
        vx_in * vx_out + vy_in * vy_out
    ))
    return angulo


def _angulo_acumulado(ruta, i, ventana=2):
    """
    Ángulo de desvío total entre la dirección de entrada al nodo i y la
    dirección resultante 'ventana' nodos más adelante.

    Detecta cambios de sentido distribuidos en varios segmentos cortos
    (p.ej. la intersección en Y de una autopista donde cada nodo gira ~90°
    pero la suma total es ~180°), que _angulo_giro nodo-a-nodo no captura.

    Devuelve [0, 180]: 0° = sin desvío, 180° = inversión completa.
    """
    if i < 1 or i + ventana >= len(ruta):
        return 0.0
    dx_in  = ruta[i][0] - ruta[i-1][0]
    dy_in  = ruta[i][1] - ruta[i-1][1]
    dx_out = ruta[i+ventana][0] - ruta[i][0]
    dy_out = ruta[i+ventana][1] - ruta[i][1]
    mag_in  = sqrt(dx_in**2 + dy_in**2)
    mag_out = sqrt(dx_out**2 + dy_out**2)
    if mag_in < 1e-12 or mag_out < 1e-12:
        return 0.0
    dot = (dx_in*dx_out + dy_in*dy_out) / (mag_in * mag_out)
    dot = max(-1.0, min(1.0, dot))
    return degrees(acos(dot))


def aplicar_restricciones_camion(G):
    """
    Penaliza aristas del grafo por anchura para vehículo pesado.
    La restricción de giros se hace de forma iterativa en calcular_ruta:
    Dijkstra calcula una ruta, se detectan giros > 120°, se bloquean esas
    aristas temporalmente y se recalcula, hasta obtener una ruta válida.
    """
    for u, v, data in list(G.edges(data=True)):
        hw    = data.get('highway', 'unclassified')
        lanes = int(data.get('lanes', 1) or 1)
        if hw in TIPOS_PROHIBIDOS_CAMION:
            G[u][v]['weight'] *= 1e6
            continue
        ancho = ANCHO_CARRIL_POR_TIPO.get(hw, 2.90) * lanes
        if ancho < ANCHO_MINIMO_CAMION:
            G[u][v]['weight'] *= 20.0
        elif ancho < ANCHO_COMODO_CAMION:
            f = 1.0 + (ANCHO_COMODO_CAMION - ancho) / (ANCHO_COMODO_CAMION - ANCHO_MINIMO_CAMION) * 5.0
            G[u][v]['weight'] *= f
    return G


def _parsear_oneway(valor, junction=None):
    """
    Interpreta el atributo oneway de OSM.
    También detecta junction=roundabout, que en OSM implica oneway=yes
    (sentido de la digitización, antihorario en España).

    Devuelve:
      'forward'  → solo dirección de digitización (s→e)
      'backward' → solo dirección inversa        (e→s)
      'both'     → bidireccional
    """
    # Las rotondas siempre son sentido único en la dirección de digitización
    if junction is not None and str(junction).strip().lower() == 'roundabout':
        return 'forward'

    if valor is None:
        return 'both'
    v = str(valor).strip().lower()
    if v in ('yes', 'true', '1', 'roundabout'):
        return 'forward'
    if v in ('-1', 'reverse'):
        return 'backward'
    return 'both'


def _tiempo_curva_minutos(angulo_grados, maxspeed_kmh):
    """
    Tiempo extra (en minutos) por frenado y aceleración en una curva o cambio
    de dirección, estimado a partir del ángulo de giro y la velocidad de la vía.

    Modelo simplificado de cinemática constante:
      - Desaceleración/aceleración promedio: 2 m/s²  (conducción urbana normal)
      - Velocidad de paso por curva: decrece linealmente con el ángulo
          0°  → sin reducción    (recto)
          90° → 50% de la velocidad
          160°→ 15% de la velocidad (casi inversión)
      - Tiempo extra = tiempo de frenado + tiempo de aceleración hasta volver
        a la velocidad de la vía, menos el tiempo que hubiera tardado si no
        hubiera reducido.

    Para ángulos muy pequeños (<5°) el overhead es despreciable; se devuelve 0.
    """
    if angulo_grados < 5:
        return 0.0

    v0_ms   = maxspeed_kmh / 3.6          # velocidad de entrada en m/s
    # Factor de reducción de velocidad en curva: 1.0 → 0.15 a medida que el ángulo crece
    ratio   = max(0.15, 1.0 - angulo_grados / 180.0 * 0.85)
    v_curva = v0_ms * ratio               # velocidad al pasar la curva

    a = 2.0                               # m/s² (desaceleración/aceleración)
    dv = max(0.0, v0_ms - v_curva)        # reducción de velocidad necesaria

    # t_freno y t_acel son iguales si la aceleración y desaceleración coinciden
    t_freno  = dv / a                     # segundos frenando
    t_acel   = dv / a                     # segundos acelerando de vuelta
    t_extra_s = t_freno + t_acel          # overhead total en segundos

    return t_extra_s / 60.0              # convertir a minutos


def crear_grafo(gdf):
    """Construye un grafo NetworkX dirigido (DiGraph) ponderado por tiempo de viaje.
    Respeta el atributo oneway de OSM: las vías de sentido único solo permiten
    circular en la dirección correcta.

    El peso incluye:
      - Tiempo de circulación a velocidad máxima (ajustado por tipo de vía y carriles)
      - Tiempo extra de frenado/aceleración en curvas y cambios de dirección
        (calculado a partir del ángulo entre segmentos consecutivos)
    """
    G = nx.DiGraph()

    for _, row in gdf.iterrows():
        maxspeed = float(row.get('maxspeed', 50) or 50)
        lanes    = int(row.get('lanes', 1) or 1)
        highway  = str(row.get('highway', 'unclassified') or 'unclassified')
        junction = row.get('junction', None)
        oneway   = _parsear_oneway(row.get('oneway'), junction)

        # Las autopistas y sus accesos son siempre sentido único si no se indica lo contrario
        if oneway == 'both' and highway in ('motorway', 'motorway_link'):
            oneway = 'forward'

        # Vías peatonales/ciclistas: excluir completamente del grafo.
        # Ningún vehículo debe circular por ellas; al no añadirlas como aristas
        # Dijkstra nunca las considerará, ni siquiera como atajo de emergencia.
        if highway in TIPOS_PROHIBIDOS_VEHICULOS:
            continue

        factor  = FACTORES_VIA.get(highway, 1.2)
        f_lanes = 0.8 if lanes >= 3 else (0.9 if lanes == 2 else 1.0)

        geom  = row.geometry
        lines = [geom] if geom.geom_type == 'LineString' else list(geom.geoms)

        for line in lines:
            coords = list(line.coords)
            n = len(coords)
            for i in range(n - 1):
                s, e    = coords[i], coords[i+1]
                dist_km = distanciaLatLon((s[1], s[0]), (e[1], e[0])) / 1000
                tiempo  = dist_km / maxspeed * 60   # minutos de circulación

                # ── Tiempo extra por curva/cambio de dirección ──────────────
                # Se calcula el ángulo de giro en el nodo de entrada (s)
                # mirando el segmento anterior (i-1→i) y el actual (i→i+1).
                # En el primer segmento de la línea no hay segmento previo → 0°.
                t_curva = 0.0
                if i > 0:
                    angulo = _angulo_giro(coords[i-1], coords[i], coords[i+1])
                    t_curva = _tiempo_curva_minutos(angulo, maxspeed)

                tiempo_total = tiempo + t_curva
                peso         = tiempo_total * factor * f_lanes

                attrs = dict(weight=peso, distancia_km=dist_km,
                             tiempo_minutos=tiempo_total, peso_base=peso,
                             maxspeed=maxspeed, lanes=lanes, highway=highway)

                if oneway == 'forward':
                    G.add_edge(s, e, **attrs)
                elif oneway == 'backward':
                    G.add_edge(e, s, **attrs)
                else:  # both
                    G.add_edge(s, e, **attrs)
                    G.add_edge(e, s, **attrs)

    sentido_unico = sum(1 for u, v in G.edges() if not G.has_edge(v, u))
    print(f"✅ Grafo dirigido: {G.number_of_nodes()} nodos, {G.number_of_edges()} aristas "
          f"({sentido_unico} en sentido único)")
    return G


def nodo_cercano(grafo, punto):
    """Devuelve el nodo del grafo más cercano al punto (lon, lat)."""
    p = Point(punto)
    return min(grafo.nodes(), key=lambda n: p.distance(Point(n)))


@app.route('/api/calcular-ruta', methods=['POST'])
def calcular_ruta():
    global grafo_vias

    if grafo_vias is None:
        return jsonify({'error': 'No hay red de vías cargada. Carga primero la capa de vías.'}), 404

    # force=True acepta el body aunque el Content-Type no llegue perfectamente;
    # silent=True evita que lance excepción si el JSON está malformado (devuelve None)
    data = request.get_json(force=True, silent=True)

    if data is None:
        return jsonify({'error': 'No se pudo leer el cuerpo JSON de la petición'}), 400

    origen         = data.get('origen')
    destino        = data.get('destino')
    obstaculos     = data.get('obstaculos', [])
    pesos_input    = data.get('pesos', [])
    coef_temporal  = float(data.get('coef_temporal', 1.0))
    # Limitar: coeficiente entre 0.5 y 3.0 por seguridad
    coef_temporal = max(0.5, min(3.0, coef_temporal))
    tipo_vehiculo = data.get('tipo_vehiculo', 'coche')   # 'coche' | 'camion'
    emergencia    = bool(data.get('emergencia', False))   # True → modo emergencia activo

    # Opciones de emergencia (solo relevantes si emergencia=True):
    #   emerg_velocidad: True → respetar veloc. máx. de la vía  / False → +20 km/h
    #   emerg_giros:     True → respetar restricciones de giro  / False → giros libres
    #   emerg_sentido:   True → respetar sentidos de circulación / False → puede ir en contramano
    emerg_velocidad = bool(data.get('emerg_velocidad', True))
    emerg_giros     = bool(data.get('emerg_giros',     True))
    emerg_sentido   = bool(data.get('emerg_sentido',   True))

    if not origen or not destino:
        return jsonify({'error': 'Faltan coordenadas de origen o destino'}), 400
    if 'lat' not in origen or 'lon' not in origen:
        return jsonify({'error': 'El origen debe tener lat y lon'}), 400
    if 'lat' not in destino or 'lon' not in destino:
        return jsonify({'error': 'El destino debe tener lat y lon'}), 400

    try:
        pto_ori = (origen['lon'],  origen['lat'])
        pto_dst = (destino['lon'], destino['lat'])

        print(f"🎯 Ruta: {pto_ori} → {pto_dst} | Obstáculos: {len(obstaculos)}")

        G = grafo_vias.copy()
        event_factors = {}

        # --- Aplicar pesos personalizados enviados desde el frontend ---
        # Esto permite que los factores de eventos, tipo de vía y velocidad
        # configurados en el UI se utilicen en el cálculo de la ruta.
        if isinstance(pesos_input, list) and pesos_input:
            pesos_aplicados = 0
            for p in pesos_input:
                try:
                    inicio = tuple(float(x) for x in (p.get("s") or p.get("inicio") or []))
                    fin    = tuple(float(x) for x in (p.get("e") or p.get("fin")   or []))
                    if len(inicio) != 2 or len(fin) != 2: continue
                    peso = float(p.get('peso', p.get('weight', 0)))
                    fe   = float(p.get('factor_evento', 1.0))
                except (TypeError, ValueError, KeyError):
                    continue

                # Solo aplicar si el peso se aparta del valor base O hay factor de evento
                # (el frontend ahora solo envía segmentos modificados)
                if G.has_edge(inicio, fin):
                    if fe > 1.0:
                        event_factors[(inicio, fin)] = fe
                    if peso > 0:
                        G[inicio][fin]['weight'] = peso
                    pesos_aplicados += 1

                if G.has_edge(fin, inicio):
                    if fe > 1.0:
                        event_factors[(fin, inicio)] = fe
                    if peso > 0:
                        G[fin][inicio]['weight'] = peso
                    pesos_aplicados += 1

            print(f"   ✅ Aplicados {pesos_aplicados} pesos personalizados de {len(pesos_input)} segmentos")

        # --- Penalizar segmentos dentro de obstáculos según % de obstrucción ---
        # El factor refleja la reducción de velocidad real, no un bloqueo forzado.
        # Dijkstra decide libremente si merece la pena pasar o buscar alternativa.
        #
        # Fórmula: factor = 1 / (1 - obstruccion * 0.99)
        #   0%  → factor 1.0   (sin efecto)
        #   50% → factor ~2.0  (la mitad de velocidad → doble de tiempo)
        #   90% → factor ~10.0 (10% de velocidad → diez veces más tiempo)
        #   99% → factor ~100  (casi bloqueado pero Dijkstra aún puede elegir pasar)
        penalizados = {}
        for u, v in G.edges():           # Cada segmento de vía (u=inicio, v=fin)
            for obs in obstaculos:        # Cada obstáculo en el mapa
                obs_ll      = (obs['lat'], obs['lon'])                    # Centro del obstáculo
                radio       = obs.get('radio', 5)                         # Radio en metros (defecto 5m)
                obstruccion = min(float(obs.get('obstruccion', 1.0)), 0.99)  # % de bloqueo (máx 99%)
                for j in range(21):  # Divide el segmento en 20 partes (j=0,1,2,...,20)
                    t  = j / 20      # Valor entre 0.0 y 1.0
                    pt = (u[1] + t*(v[1]-u[1]), u[0] + t*(v[0]-u[0])) # Fórmula de interpolación lineal: pt=u+t(v−u); Calcula pt, un punto intermedio en la línea del segmento
                    if distanciaLatLon(obs_ll, pt) <= radio: # Si el punto intermedio pt está dentro del radio del obstáculo
                        factor = 1.0 / (1.0 - obstruccion * 0.99) # Calcula el factor de penalización basado en el nivel de obstrucción. Cuanto mayor sea la obstrucción, mayor será el factor (más tiempo).
                        prev   = penalizados.get((u, v), 1.0) # Si el segmento ya tiene un factor de penalización por otro obstáculo, se toma el máximo para reflejar el efecto acumulativo
                        penalizados[(u, v)] = max(prev, factor) # Guarda el factor de penalización para el segmento (u, v) en el diccionario penalizados. Si el segmento ya tiene un factor, se actualiza al máximo entre el existente y el nuevo.
                        break

        for (u, v), factor in penalizados.items(): # Aplica el factor de penalización a las aristas afectadas
            if G.has_edge(u, v):
                G[u][v]['weight'] *= factor 

        # --- Momento: penalización temporal por POI/hora (solo si activo) ---
        # Si Momento está activo, se buscan POIs activos en este día/hora y se
        # penalizan individualmente las aristas cercanas a cada uno.
        # El coef_temporal del calendario se aplica siempre como escalar global
        # (no afecta a la elección de ruta pero sí al tiempo estimado mostrado).
        momento_activo = bool(data.get('momento_activo', False))
        momento_dia    = int(data.get('momento_dia',  1))    # 1=Lunes … 7=Domingo
        momento_hora   = float(data.get('momento_hora', 12))  # 0.0–23.99

        PERIODOS_CRITICOS = {
            'colegios': {
                'dias': [1, 2, 3, 4, 5],
                'horarios': [
                    {'inicio': 8,    'fin': 9,    'factor': 1.6},
                    {'inicio': 13.5, 'fin': 14.5, 'factor': 1.3},
                    {'inicio': 17,   'fin': 17.5, 'factor': 1.6},
                ],
                'tipos':  ['colegio', 'school', 'college', 'kindergarten', 'university', 'educaci'],
                'radio':  80,
            },
            'iglesias': {
                'dias': [7],
                'horarios': [{'inicio': 10, 'fin': 13, 'factor': 1.3}],
                'tipos':  ['iglesia', 'church', 'chapel', 'cathedral', 'parroquia'],
                'radio':  100,
            },
            'oficinas': {
                'dias': [1, 2, 3, 4, 5],
                'horarios': [
                    {'inicio': 7.5, 'fin': 9,    'factor': 1.6},
                    {'inicio': 14,  'fin': 15,   'factor': 1.3},
                    {'inicio': 18,  'fin': 19.5, 'factor': 1.6},
                ],
                'tipos':  ['office', 'oficina', 'commercial', 'industrial', 'ayuntamiento'],
                'radio':  150,
            },
            'ocio': {
                'dias': [5, 6, 7],
                'horarios': [
                    {'inicio': 20, 'fin': 24, 'factor': 1.6},
                    {'inicio': 12, 'fin': 15, 'factor': 1.3},
                ],
                'tipos':  ['restaurant', 'bar', 'pub', 'cafe', 'cinema', 'theatre', 'restaurante'],
                'radio':  60,
            },
        }

        COLS_TIPO = ['tipo', 'amenity', 'building', 'denCorta', 'tipo_centr']

        if momento_activo and PuntosDinteres_dic:
            # Recopilar POIs activos con su factor y radio
            pois_activos = []  # lista de (Point_lon_lat, factor, radio_m)
            for _, config in PERIODOS_CRITICOS.items():
                if momento_dia not in config['dias']:
                    continue
                factor_horario = next(
                    (h['factor'] for h in config['horarios']
                     if h['inicio'] <= momento_hora <= h['fin']),
                    None
                )
                if factor_horario is None:
                    continue
                tipos_buscar = [t.lower() for t in config['tipos']]
                for _, gdf in PuntosDinteres_dic.items():
                    for _, row in gdf.iterrows():
                        tipo_poi = ''
                        for col in COLS_TIPO:
                            if col in row.index and row[col] and str(row[col]).strip().lower() not in ('nan', 'none', ''):
                                tipo_poi = str(row[col]).lower()
                                break
                        if any(t in tipo_poi for t in tipos_buscar):
                            geom = row.geometry
                            pois_activos.append((geom.x, geom.y, factor_horario, config['radio']))

            if pois_activos:
                aristas_penalizadas = 0
                for u, v in G.edges():
                    mid_lon = (u[0] + v[0]) / 2
                    mid_lat = (u[1] + v[1]) / 2
                    factor_max = 1.0
                    for (poi_lon, poi_lat, f_poi, radio) in pois_activos:
                        d = distanciaLatLon((mid_lat, mid_lon), (poi_lat, poi_lon))
                        if d <= radio:
                            factor_max = max(factor_max, f_poi)
                    if factor_max > 1.0:
                        G[u][v]['weight'] *= factor_max
                        aristas_penalizadas += 1
                print(f"   ⏱️ Momento: {len(pois_activos)} POIs activos, {aristas_penalizadas} aristas penalizadas")
            else:
                print(f"   ⏱️ Momento activo pero sin POIs activos en este día/hora")

        # Coef. calendario: escalar global (afecta al tiempo mostrado, no a la elección de ruta)
        if coef_temporal != 1.0:
            for u, v in G.edges():
                G[u][v]['weight'] *= coef_temporal

        # --- Modo Emergencia: velocidad máxima +20 km/h en cada arista ---
        # Solo se aplica si el check "Velocidad máx." está DESACTIVADO
        # (emerg_velocidad=False → ignorar límite → circular más rápido).
        if emergencia and not emerg_velocidad:
            print("🚨 Modo emergencia: velocidad +20 km/h en todas las aristas")
            for u, v, d in G.edges(data=True):
                spd = d.get('maxspeed', 50)
                if spd and spd > 0:
                    factor_emg = spd / (spd + 20.0)   # <1 → reduce el tiempo → más rápido
                    G[u][v]['weight']         *= factor_emg
                    G[u][v]['tiempo_minutos'] *= factor_emg
        elif emergencia and emerg_velocidad:
            print("🚨 Modo emergencia: respetando velocidad máxima de la vía")

        # --- Restricciones de vehículo pesado ---
        if tipo_vehiculo == 'camion':
            print("🚛 Modo vehículo pesado: aplicando restricciones de anchura y ángulo de giro")
            G = aplicar_restricciones_camion(G)

        # --- Emergencia: sentido contrario (contramano en urbano) ---
        # Si emerg_sentido=False, se añaden aristas inversas para las vías de
        # sentido único urbanas. Las vías de alta capacidad (motorway/trunk) y
        # las rotondas se excluyen: circular en contramano en ellas es inviable.
        # Las aristas inversas tienen un factor ×3 de penalización para que
        # Dijkstra solo las use si realmente acortan el tiempo.
        TIPOS_CONTRAMANO_EXCLUIDOS = {'motorway', 'motorway_link', 'trunk', 'trunk_link'}
        if emergencia and not emerg_sentido:
            aristas_contramano = []
            for u, v, d in list(G.edges(data=True)):
                if G.has_edge(v, u):
                    continue   # ya es bidireccional
                hw = d.get('highway', '')
                if hw in TIPOS_CONTRAMANO_EXCLUIDOS:
                    continue   # no añadir contramano en autopistas/troncos
                # Añadir dirección inversa con penalización ×3
                attrs_inv = dict(d)
                attrs_inv['weight']         = d.get('weight', 1.0)         * 3.0
                attrs_inv['tiempo_minutos'] = d.get('tiempo_minutos', 0.0) * 3.0
                attrs_inv['contramano']     = True
                aristas_contramano.append((v, u, attrs_inv))
            for v, u, attrs_inv in aristas_contramano:
                G.add_edge(v, u, **attrs_inv)
            print(f"🚨 Emergencia contramano: {len(aristas_contramano)} aristas inversas añadidas")

        # --- Nodos más cercanos ---
        nodo_ori = nodo_cercano(G, pto_ori)
        nodo_dst = nodo_cercano(G, pto_dst)

        # --- Dijkstra (con recálculo iterativo para restricciones de giro) ---
        # Camión:            giros > 120° se evitan siempre
        # Coche (normal):    giros > 140° se evitan — tanto nodo a nodo como
        #                    acumulados en ventana de 2 nodos (captura giros en U
        #                    distribuidos en intersecciones en Y de autopistas)
        # Coche emergencia:  sin restricción de giro
        ANGULO_MAX_CAMION        = 120   # umbral nodo-a-nodo para camión
        ANGULO_MAX_COCHE         = 140   # umbral nodo-a-nodo para turismo
        ANGULO_MAX_COCHE_ACUM    = 140   # umbral acumulado (ventana 2 nodos) para turismo
        VENTANA_ACUMULADO        = 2     # nodos hacia adelante para la comprobación acumulada
        MAX_ITERACIONES          = 15

        if tipo_vehiculo == 'camion':
            angulo_max_activo = ANGULO_MAX_CAMION
            aplicar_restriccion_giro = True
        elif tipo_vehiculo == 'coche' and not emergencia:
            angulo_max_activo = ANGULO_MAX_COCHE
            aplicar_restriccion_giro = True
        elif tipo_vehiculo == 'coche' and emergencia and emerg_giros:
            # Emergencia con check "Giros" activado → respetar restricciones normales de turismo
            angulo_max_activo = ANGULO_MAX_COCHE
            aplicar_restriccion_giro = True
        else:
            # Emergencia con check "Giros" desactivado → giros libres
            angulo_max_activo = 180
            aplicar_restriccion_giro = False

        aristas_bloqueadas_camion = set()

        for iteracion in range(MAX_ITERACIONES):
            try:
                ruta = nx.shortest_path(G, nodo_ori, nodo_dst, weight='weight')
            except (nx.NetworkXNoPath, nx.NodeNotFound):
                for u_b, v_b, attrs_b in aristas_bloqueadas_camion:
                    G.add_edge(u_b, v_b, **attrs_b)
                msg = 'No existe camino entre origen y destino en el sentido de la marcha'
                if tipo_vehiculo == 'camion':
                    msg += ' (no se encontró ruta sin giros imposibles para vehículo pesado)'
                elif tipo_vehiculo == 'coche' and (not emergencia or emerg_giros):
                    msg += ' (no se encontró ruta sin cambios de sentido bruscos para turismo)'
                if obstaculos:
                    msg += '. Los obstáculos activos pueden estar bloqueando rutas alternativas'
                return jsonify({'error': msg}), 400

            if not aplicar_restriccion_giro:
                break

            # Detectar giros prohibidos en la ruta calculada.
            # Se usa doble comprobación para turismos:
            #   1) Nodo a nodo: captura giros bruscos simples (> 140°)
            #   2) Acumulado (ventana=2): captura giros en U distribuidos en
            #      dos segmentos cortos, como la intersección en Y de una
            #      autopista (cada nodo ~90° pero suma ~180°)
            giros_imposibles = []
            ya_anadido = set()

            for i in range(1, len(ruta) - 1):
                # Comprobación 1: ángulo nodo a nodo
                ang_local = _angulo_giro(ruta[i-1], ruta[i], ruta[i+1])
                if ang_local > angulo_max_activo:
                    u_mal, v_mal = ruta[i], ruta[i+1]
                    if G.has_edge(u_mal, v_mal) and (u_mal, v_mal) not in ya_anadido:
                        giros_imposibles.append((u_mal, v_mal))
                        ya_anadido.add((u_mal, v_mal))

                # Comprobación 2: ángulo acumulado (solo para turismo sin giros libres)
                if tipo_vehiculo == 'coche' and (not emergencia or emerg_giros):
                    ang_acum = _angulo_acumulado(ruta, i, ventana=VENTANA_ACUMULADO)
                    if ang_acum > ANGULO_MAX_COCHE_ACUM:
                        # Bloquear la arista de salida del nodo problemático
                        u_mal, v_mal = ruta[i], ruta[i+1]
                        if G.has_edge(u_mal, v_mal) and (u_mal, v_mal) not in ya_anadido:
                            giros_imposibles.append((u_mal, v_mal))
                            ya_anadido.add((u_mal, v_mal))

            if not giros_imposibles:
                break

            etiqueta = 'camión' if tipo_vehiculo == 'camion' else 'turismo'
            print(f"🔄 Iteración {iteracion+1} ({etiqueta}): {len(giros_imposibles)} giro(s) prohibido(s) — recalculando")
            for u_mal, v_mal in giros_imposibles:
                if G.has_edge(u_mal, v_mal) and (u_mal, v_mal) not in {(a, b) for a, b, _ in aristas_bloqueadas_camion}:
                    attrs_guardados = dict(G[u_mal][v_mal])
                    aristas_bloqueadas_camion.add((u_mal, v_mal, frozenset(attrs_guardados.items())))
                    G.remove_edge(u_mal, v_mal)
        else:
            # Se agotaron las iteraciones: restaurar y usar última ruta encontrada
            print(f"⚠️  Se agotaron {MAX_ITERACIONES} iteraciones de restricción de giro, usando mejor ruta disponible")

        # Restaurar todas las aristas bloqueadas temporalmente
        for u_b, v_b, attrs_frozen in aristas_bloqueadas_camion:
            attrs_b = dict(attrs_frozen)
            if not G.has_edge(u_b, v_b):
                G.add_edge(u_b, v_b, **attrs_b)

        # --- Estadísticas ---
        # tiempo_min refleja el tiempo real incluyendo: coef_temporal (Momento),
        # penalización de obstáculos y penalización de Eventos (via pesos del frontend).
        # 'weight' en G ya tiene todos esos factores aplicados;
        # 'tiempo_minutos' es solo el tiempo base sin factores.
        # Ratio: fTotal = weight / (tiempo_minutos * factor_via * f_lanes)
        # -> tiempo_real = tiempo_minutos * fTotal
        # Como guardamos 'peso_base' = tiempo * factor * f_lanes al construir el grafo,
        # podemos reconstruir: tiempo_real = tiempo_minutos * (weight / peso_base)

        dist_km = tiempo_min = 0  
        tiempo_base = tiempo_extra_eventos = tiempo_extra_obstaculos = tiempo_extra_temporal = 0 
        tipos_vias   = {} 
        for i in range(len(ruta) - 1): # Itera por cada segmento de la ruta (u, v)
            u, v = ruta[i], ruta[i+1] # Obtiene los nodos de inicio y fin del segmento
            if G.has_edge(u, v): # Verifica que el segmento exista en el grafo
                d = G[u][v] # Obtiene los atributos del segmento (peso, distancia_km, tiempo_minutos, etc.)
                dist_km   += d.get('distancia_km', 0) # Suma la distancia del segmento a la distancia total
                t_base     = d.get('tiempo_minutos', 0) # Tiempo base
                peso_base  = d.get('peso_base', None) # Peso base sin factores (tiempo * factor_via * f_lanes)
                w_actual   = d.get('weight', t_base) # Peso actual con factores aplicados (tiempo real)
                if peso_base and peso_base > 0: # Si el peso base es válido, calcula el tiempo real y los factores aplicados
                    factor_total = w_actual / peso_base # Factor total aplicado al segmento (incluye eventos, obstáculos y temporal)
                    tiempo_min += t_base * factor_total # Suma el tiempo real del segmento al tiempo total de la ruta
                    tiempo_base += t_base # Suma el tiempo base del segmento al tiempo base total (sin factores)   

                    event_factor = event_factors.get((u, v), 1.0) # Factor de evento aplicado al segmento
                    obst_factor  = penalizados.get((u, v), 1.0) # Factor de obstáculo aplicado al segmento
                    temporal_factor = coef_temporal if coef_temporal != 1.0 else 1.0 # Factor temporal aplicado a todos los segmentos

                    if event_factor > 1.0: 
                        tiempo_extra_eventos += t_base * factor_total * (1.0 - 1.0 / event_factor)
                    if obst_factor > 1.0:
                        tiempo_extra_obstaculos += t_base * factor_total * (1.0 - 1.0 / obst_factor)
                    if temporal_factor != 1.0:
                        tiempo_extra_temporal += t_base * factor_total * (1.0 - 1.0 / temporal_factor)
                else:
                    tiempo_min += t_base
                    tiempo_base += t_base
                hw = d.get('highway', 'unclassified')
                tipos_vias[hw] = tipos_vias.get(hw, 0) + 1

        # ── Overhead fijo de arranque y parada ──────────────────────────────
        # 5 s para iniciar la marcha en el origen + 5 s para frenar en el destino
        OVERHEAD_ARRANQUE_S = 5.0
        OVERHEAD_PARADA_S   = 5.0
        tiempo_min += (OVERHEAD_ARRANQUE_S + OVERHEAD_PARADA_S) / 60.0

        vel            = round(dist_km / (tiempo_base / 60), 2) if tiempo_base > 0 else 0 # Velocidad promedio real en km/h (sin factores de penalización)
        tipo_principal = max(tipos_vias, key=tipos_vias.get) if tipos_vias else 'unclassified' # Tipo de vía más frecuente en la ruta
        usa_obstaculos = any( # Verifica si la ruta atraviesa algún segmento penalizado por obstáculos
            (ruta[i], ruta[i+1]) in penalizados or (ruta[i+1], ruta[i]) in penalizados
            for i in range(len(ruta)-1)
        )
        segs_penalizados = sum( # Cuenta cuántos segmentos de la ruta están penalizados por obstáculos
            1 for i in range(len(ruta)-1)
            if (ruta[i], ruta[i+1]) in penalizados or (ruta[i+1], ruta[i]) in penalizados # Verifica ambos sentidos por si la vía es bidireccional y el obstáculo afecta en una dirección pero no en la otra
        )

        ruta_geojson = { 
            'type': 'Feature',
            'geometry': {
                'type': 'LineString',
                'coordinates': [[lon, lat] for lon, lat in ruta]
            },
            'properties': {
                'distancia_km':                 round(dist_km, 2),
                'tiempo_minutos':               round(tiempo_min, 2),
                'tiempo_minutos_base':          round(tiempo_base, 2),
                'tiempo_extra_eventos':         round(tiempo_extra_eventos, 1),
                'tiempo_extra_obstaculos':      round(tiempo_extra_obstaculos, 1),
                'tiempo_extra_temporal':        round(tiempo_extra_temporal, 1),
                'tiempo_horas':                 round(tiempo_min / 60, 2),
                'velocidad_promedio_km_h':       vel,
                'velocidad_promedio_ponderada':  vel,  # alias para compatibilidad con el JS
                'num_nodos':                     len(ruta),
                'tipo_via_principal':            tipo_principal,
                'tipos_via':                     tipos_vias,
                'usa_obstaculos':                usa_obstaculos,
            }
        }

        # Solo los segmentos penalizados que la ruta realmente atraviesa
        ruta_edges = set()
        for i in range(len(ruta) - 1):
            ruta_edges.add((ruta[i], ruta[i+1]))
            ruta_edges.add((ruta[i+1], ruta[i]))
        segs_coords = [
            {'start': {'lat': u[1], 'lon': u[0]}, 'end': {'lat': v[1], 'lon': v[0]}}
            for u, v in penalizados
            if (u, v) in ruta_edges or (v, u) in ruta_edges
        ]

        # Formatear tiempo de forma legible (h/min/s)
        def _fmt_tiempo_legible(minutos):
            total_seg = round(minutos * 60)
            h = total_seg // 3600
            m = (total_seg % 3600) // 60
            s = total_seg % 60
            if h > 0:
                return f"{h}h {m}min {s}s" if s else f"{h}h {m}min"
            if m > 0:
                return f"{m}min {s}s" if s else f"{m}min"
            return f"{s}s"

        mensaje = f"{round(dist_km, 2)} km · {_fmt_tiempo_legible(tiempo_min)}"
        if obstaculos:
            if usa_obstaculos:
                mensaje += f" ⚠️ atraviesa {segs_penalizados} tramo(s) bloqueado(s)"
            else:
                mensaje += f" (evitando {len(obstaculos)} obstáculo(s))"

        print(f"✅ {mensaje}")

        return jsonify({
            'ruta':                         ruta_geojson,
            'origen_snap':                  {'lon': nodo_ori[0], 'lat': nodo_ori[1]},
            'destino_snap':                 {'lon': nodo_dst[0], 'lat': nodo_dst[1]},
            'segmentos_bloqueados':         segs_coords,
            'usa_obstaculos':               usa_obstaculos,
            'segmentos_penalizados_usados': segs_penalizados,
            'mensaje':                      mensaje,
            'tipo_vehiculo':                tipo_vehiculo,
            'restriccion_giro_activa':      aplicar_restriccion_giro,
            'angulo_max_giro':              angulo_max_activo,
        })

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ==================== OBSTÁCULOS (EXPORTAR / IMPORTAR) ====================

@app.route('/api/exportar-obstaculos', methods=['POST'])
def exportar_obstaculos():
    """
    Recibe la lista de obstáculos desde el frontend, construye un GeoDataFrame
    y lo devuelve como GeoPackage (.gpkg), shapefile comprimido (.zip)
    o CSV según el formato solicitado.
    """
    data     = request.get_json(force=True, silent=True) or {}
    features = data.get('obstaculos', [])
    formato  = data.get('formato', 'gpkg').lower()

    if not features:
        return jsonify({'error': 'No hay obstáculos que exportar'}), 400

    try:
        registros = []
        for obs in features:
            try:
                nivel_val = int(obs.get('nivel', 2))
                nivel_val = max(1, min(4, nivel_val))
            except (ValueError, TypeError):
                nivel_val = 2
            registros.append({
                'geometry':       Point(obs['lon'], obs['lat']),
                'id':             str(obs.get('id', '')),
                'nivel':          nivel_val,
                'vias_afectadas': str(obs.get('vias_afectadas', '')),
                'fecha_creacion': str(obs.get('fecha_creacion', '')),
            })

        gdf = gpd.GeoDataFrame(registros, crs='EPSG:4326')

        if formato == 'shp':
            tmp_dir = tempfile.mkdtemp(prefix='obs_export_shp_')
            shp_path = os.path.join(tmp_dir, 'obstaculos.shp')
            gdf.to_file(shp_path, driver='ESRI Shapefile')

            zip_path = os.path.join(tmp_dir, 'obstaculos_shapefile.zip')
            with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
                for root, _, files in os.walk(tmp_dir):
                    for filename in files:
                        if filename.lower().endswith(('.shp', '.shx', '.dbf', '.prj', '.cpg')):
                            zf.write(os.path.join(root, filename), arcname=filename)

            nombre = f"obstaculos_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
            return send_file(
                zip_path,
                mimetype='application/zip',
                as_attachment=True,
                download_name=nombre
            )

        tmp_dir   = tempfile.mkdtemp(prefix='obs_export_')
        gpkg_path = os.path.join(tmp_dir, 'obstaculos.gpkg')
        gdf.to_file(gpkg_path, driver='GPKG', layer='obstaculos')

        nombre = f"obstaculos_{datetime.now().strftime('%Y%m%d_%H%M%S')}.gpkg"
        return send_file(
            gpkg_path,
            mimetype='application/geopackage+sqlite3',
            as_attachment=True,
            download_name=nombre
        )

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/importar-obstaculos', methods=['POST'])
def importar_obstaculos():
    """
    Recibe un .gpkg con obstáculos exportados previamente,
    lo lee con GeoPandas y devuelve las features como JSON al frontend.
    """
    if 'file' not in request.files:
        return jsonify({'error': 'No se recibió ningún archivo'}), 400

    archivo = request.files['file']
    nombre  = archivo.filename.lower()
    if not (nombre.endswith('.gpkg') or nombre.endswith('.geojson') or nombre.endswith('.zip') or nombre.endswith('.shp')):
        return jsonify({'error': 'Formato no soportado. Usa .gpkg, .geojson, .zip o .shp'}), 400

    tmp_dir = tempfile.mkdtemp(prefix='obs_import_')
    try:
        if nombre.endswith('.zip'):
            zip_path = os.path.join(tmp_dir, archivo.filename)
            archivo.save(zip_path)
            with zipfile.ZipFile(zip_path) as zf:
                zf.extractall(tmp_dir)
            shp_path = next((os.path.join(r, f)
                             for r, _, fs in os.walk(tmp_dir)
                             for f in fs if f.lower().endswith('.shp')), None)
            if not shp_path:
                return jsonify({'error': 'No se encontró .shp dentro del ZIP'}), 400
            ruta_tmp = shp_path
        else:
            ruta_tmp = os.path.join(tmp_dir, archivo.filename)
            archivo.save(ruta_tmp)

        gdf = gpd.read_file(ruta_tmp)
        if gdf.crs is None:
            gdf = gdf.set_crs('EPSG:4326')
        elif gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs('EPSG:4326')

        gdf = gdf[gdf.geometry.geom_type == 'Point'].reset_index(drop=True)
        if gdf.empty:
            return jsonify({'error': 'El archivo no contiene geometrías de punto válidas'}), 400

        def _val(row, col, default):
            return row[col] if col in row and row[col] is not None else default

        features = []
        for _, row in gdf.iterrows():
            if 'nivel' in row and row['nivel'] is not None:
                try:   nivel_val = max(1, min(4, int(row['nivel'])))
                except: nivel_val = 2
            elif 'pct' in row and row['pct'] is not None:   # legacy
                try:
                    pct_raw = int(row['pct'])
                    nivel_val = max(1, min(4, round(pct_raw / 25))) if pct_raw > 0 else 1
                except: nivel_val = 2
            else:
                nivel_val = 2

            features.append({
                'lat':            row.geometry.y,
                'lon':            row.geometry.x,
                'id':             _val(row, 'id',             None),
                'nivel':          nivel_val,
                'vias_afectadas': str(_val(row, 'vias_afectadas', '')),
                'fecha_creacion': str(_val(row, 'fecha_creacion', '')),
            })

        return jsonify({'obstaculos': features, 'total': len(features)})

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


@app.route('/api/exportar-obstaculos-csv', methods=['POST'])
def exportar_obstaculos_csv():
    """
    Recibe la lista de obstáculos desde el frontend y los devuelve como CSV.
    Formato: id, Nombre, coord_lat, coord_lon, Nivel, Cruce, Calles, Portal
    """
    data     = request.get_json(force=True, silent=True) or {}
    features = data.get('obstaculos', [])

    if not features:
        return jsonify({'error': 'No hay obstáculos que exportar'}), 400

    try:
        # Crear el contenido CSV en memoria
        output = io.StringIO()
        writer = csv.writer(output)
        
        # Escribir encabezado en el orden especificado
        writer.writerow(['id', 'Nombre', 'coord_lat', 'coord_lon', 'Nivel', 'Cruce', 'Calles', 'Portal'])
        
        # Escribir datos
        for obs in features:
            try:
                nivel_val = max(1, min(4, int(obs.get('Nivel', obs.get('nivel', 2)))))
            except (ValueError, TypeError):
                nivel_val = 2
            
            # Validar que coord_lat y coord_lon existan
            coord_lat = obs.get('coord_lat')
            coord_lon = obs.get('coord_lon')
            if coord_lat is None or coord_lon is None:
                continue  # Saltar obstáculos sin coordenadas
            
            # id es obligatorio (auto-completado en el frontend)
            obs_id = obs.get('id', '')
            nombre = obs.get('Nombre', obs.get('nombre', str(obs_id))) or str(obs_id)
            cruce = obs.get('Cruce', obs.get('cruce', 'No'))
            calles = obs.get('Calles', obs.get('calles', ''))
            portal = obs.get('Portal', obs.get('portal', ''))
            
            writer.writerow([
                obs_id,
                nombre,
                coord_lat,
                coord_lon,
                nivel_val,
                cruce,
                calles,
                portal
            ])
        
        # Preparar respuesta
        output.seek(0)
        nombre = f"obstaculos_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        
        return Response(
            output.getvalue(),
            mimetype='text/csv; charset=utf-8',
            headers={'Content-Disposition': f'attachment; filename={nombre}'}
        )

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/importar-obstaculos-csv', methods=['POST'])
def importar_obstaculos_csv():
    """
    Recibe un archivo CSV con obstáculos y devuelve las features como JSON al frontend.
    Formato esperado: id, Nombre, coord_lat, coord_lon, Nivel, Cruce, Calles, Portal

    Portal es solo el número de portal (ej. "12").
    La calle se toma de Calles, que debe contener un único elemento (sin ";").
    La búsqueda se realiza combinando Calles + Portal, igual que el widget de búsqueda.
    coord_lat/coord_lon pueden omitirse cuando Portal está presente; si se dan ambos,
    Portal prevalece. Si Cruce=Sí (varios elementos en Calles), Portal se ignora con aviso.
    """
    if 'file' not in request.files:
        return jsonify({'error': 'No se recibió ningún archivo'}), 400

    archivo = request.files['file']
    nombre  = archivo.filename.lower()
    if not nombre.endswith('.csv'):
        return jsonify({'error': 'Formato no soportado. Usa .csv'}), 400

    try:
        contenido = archivo.read().decode('utf-8')
        reader = csv.DictReader(io.StringIO(contenido))

        features       = []
        errores_portal = []

        for fila_num, row in enumerate(reader, start=2):  # fila 1 = cabecera
            try:
                if 'Nivel' in row and row['Nivel'].strip():
                    try:   nivel = max(1, min(4, int(row['Nivel'].strip())))
                    except: nivel = 2
                elif 'Nivel' in row and row['Nivel'].strip():   # legacy
                    try:
                        pct_raw = max(0, min(100, int(row['Nivel'].strip())))
                        nivel = max(1, min(4, round(pct_raw / 25))) if pct_raw > 0 else 1
                    except: nivel = 2
                else:
                    nivel = 2

                obs_id = row.get('id', '').strip()
                if not obs_id:
                    continue

                nombre_obs = row.get('Nombre', '').strip() or obs_id
                cruce      = row.get('Cruce',  'No').strip()
                calles     = row.get('Calles', '').strip()
                portal_raw = row.get('Portal', '').strip()

                coord_lat = None
                coord_lon = None

                # ── Resolver Portal → coordenadas ──────────────────────────
                if portal_raw:
                    # Validar que Portal sea un número
                    if not portal_raw.isdigit():
                        errores_portal.append(
                            f"Fila {fila_num}: Portal debe ser un número (valor='{portal_raw}')")
                    # Validar que Calles tenga un único elemento (sin cruce)
                    elif ';' in calles or cruce.lower() == 'sí' or cruce.lower() == 'si':
                        errores_portal.append(
                            f"Fila {fila_num}: Portal ignorado — Calles tiene varios elementos o Cruce=Sí ('{calles}')")
                    elif not calles:
                        errores_portal.append(
                            f"Fila {fila_num}: Portal='{portal_raw}' pero Calles está vacío — no se puede buscar")
                    elif portales_gdf is None:
                        errores_portal.append(
                            f"Fila {fila_num}: capa de portales no cargada (Portal='{portal_raw}')")
                    else:
                        # Buscar combinando Calles + Portal, igual que el widget
                        nombre_norm = _normalizar_nombre_via(calles)
                        numero_raw  = portal_raw

                        df_p = portales_gdf[
                            portales_gdf['_nombre_norm'].str.contains(
                                nombre_norm, case=False, na=False, regex=False)
                        ]

                        if not df_p.empty:
                            # Coincidencia exacta de número primero
                            mask_num = df_p['_numero_str'] == numero_raw
                            if not mask_num.any():
                                mask_num = df_p['_numero_str'].str.lstrip('0') == numero_raw.lstrip('0')
                            if mask_num.any():
                                df_p = df_p[mask_num]

                        if df_p.empty:
                            errores_portal.append(
                                f"Fila {fila_num}: '{calles} {portal_raw}' no encontrado en portales")
                        else:
                            hit       = df_p.iloc[0]
                            coord_lat = float(hit.geometry.y)
                            coord_lon = float(hit.geometry.x)
                            cruce     = 'No'
                            # Normalizar el nombre de calle con lo encontrado en portales
                            nombre_via_encontrada = (str(hit.get('tipo_vial', '')) + ' ' +
                                                     str(hit.get('nombre_via', ''))).strip()
                            if nombre_via_encontrada:
                                calles = nombre_via_encontrada

                # ── Coordenadas directas (fallback si no hay Portal) ───────
                if coord_lat is None:
                    try:
                        coord_lat = float(row.get('coord_lat', ''))
                        coord_lon = float(row.get('coord_lon', ''))
                    except (ValueError, TypeError):
                        continue  # Sin coordenadas ni portal válido → saltar

                features.append({
                    'lat':    coord_lat,
                    'lon':    coord_lon,
                    'nivel':  nivel,
                    'id':     obs_id,
                    'Nombre': nombre_obs,
                    'Cruce':  cruce,
                    'Calles': calles,
                    'portal': portal_raw,
                })

            except (ValueError, TypeError):
                continue  # Saltar filas inválidas

        if not features:
            msg = 'No se pudieron leer obstáculos válidos del CSV'
            if errores_portal:
                msg += '. Errores: ' + '; '.join(errores_portal[:3])
            return jsonify({'error': msg}), 400

        resp = {'obstaculos': features, 'total': len(features)}
        if errores_portal:
            resp['avisos'] = errores_portal
        return jsonify(resp)

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ==================== EVENTOS (EXPORTAR / IMPORTAR) ====================

@app.route('/api/exportar-eventos', methods=['POST'])
def exportar_eventos():
    """
    Recibe la lista de eventos desde el frontend, construye un GeoDataFrame
    de polígonos y lo devuelve como GeoPackage (.gpkg) o shapefile (.zip).
    Compatible con QGIS y cualquier software GIS.
    """
    data     = request.get_json(force=True, silent=True) or {}
    features = data.get('eventos', [])
    formato  = data.get('formato', 'gpkg').lower()

    if not features:
        return jsonify({'error': 'No hay eventos que exportar'}), 400

    try:
        registros = []
        for ev in features:
            # vertices llegan como [[lon, lat], ...]
            coords = [(v[0], v[1]) for v in ev.get('vertices', [])]
            if len(coords) < 3:
                continue
            registros.append({
                'geometry':     ShapelyPolygon(coords),
                'nombre':       str(ev.get('nombre',       '')),
                'fecha_inicio': str(ev.get('fecha_inicio', '')),
                'fecha_fin':    str(ev.get('fecha_fin',    '')),
                'afluencia':    int(ev.get('afluencia',    50)),
                'duracion':     float(ev.get('duracion',   1)),
            })

        if not registros:
            return jsonify({'error': 'Ningún evento tiene geometría válida'}), 400

        gdf = gpd.GeoDataFrame(registros, crs='EPSG:4326')

        if formato == 'shp':
            tmp_dir = tempfile.mkdtemp(prefix='ev_export_shp_')
            shp_path = os.path.join(tmp_dir, 'eventos.shp')
            gdf.to_file(shp_path, driver='ESRI Shapefile')

            zip_path = os.path.join(tmp_dir, 'eventos_shapefile.zip')
            with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
                for root, _, files in os.walk(tmp_dir):
                    for filename in files:
                        if filename.lower().endswith(('.shp', '.shx', '.dbf', '.prj', '.cpg')):
                            zf.write(os.path.join(root, filename), arcname=filename)

            nombre = f"eventos_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
            return send_file(
                zip_path,
                mimetype='application/zip',
                as_attachment=True,
                download_name=nombre
            )

        tmp_dir   = tempfile.mkdtemp(prefix='ev_export_')
        gpkg_path = os.path.join(tmp_dir, 'eventos.gpkg')
        gdf.to_file(gpkg_path, driver='GPKG', layer='eventos')

        nombre = f"eventos_{datetime.now().strftime('%Y%m%d_%H%M%S')}.gpkg"
        return send_file(
            gpkg_path,
            mimetype='application/geopackage+sqlite3',
            as_attachment=True,
            download_name=nombre
        )

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/importar-eventos', methods=['POST'])
def importar_eventos():
    """
    Recibe un .gpkg, .geojson, .zip (shapefile) o .shp con eventos
    exportados previamente y devuelve las features como JSON al frontend.
    """
    if 'file' not in request.files:
        return jsonify({'error': 'No se recibió ningún archivo'}), 400

    archivo = request.files['file']
    nombre  = archivo.filename.lower()
    if not (nombre.endswith('.gpkg') or nombre.endswith('.geojson') or nombre.endswith('.zip') or nombre.endswith('.shp')):
        return jsonify({'error': 'Formato no soportado. Usa .gpkg, .geojson, .zip o .shp'}), 400

    tmp_dir = tempfile.mkdtemp(prefix='ev_import_')
    try:
        if nombre.endswith('.zip'):
            zip_path = os.path.join(tmp_dir, archivo.filename)
            archivo.save(zip_path)
            with zipfile.ZipFile(zip_path) as zf:
                zf.extractall(tmp_dir)
            shp_path = next((os.path.join(r, f)
                             for r, _, fs in os.walk(tmp_dir)
                             for f in fs if f.lower().endswith('.shp')), None)
            if not shp_path:
                return jsonify({'error': 'No se encontró .shp dentro del ZIP'}), 400
            ruta_lectura = shp_path
        else:
            ruta_lectura = os.path.join(tmp_dir, archivo.filename)
            archivo.save(ruta_lectura)

        gdf = gpd.read_file(ruta_lectura)
        if gdf.crs is None:
            gdf = gdf.set_crs('EPSG:4326')
        elif gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs('EPSG:4326')

        # Filtrar solo polígonos
        gdf = gdf[gdf.geometry.geom_type.isin(['Polygon', 'MultiPolygon'])].reset_index(drop=True)
        if gdf.empty:
            return jsonify({'error': 'El archivo no contiene polígonos válidos'}), 400

        def _val(row, col, default):
            return row[col] if col in row.index and row[col] is not None else default

        features = []
        for _, row in gdf.iterrows():
            geom = row.geometry
            # Para MultiPolygon usar solo el polígono más grande
            if geom.geom_type == 'MultiPolygon':
                geom = max(geom.geoms, key=lambda g: g.area)
            coords = [[lon, lat] for lon, lat in geom.exterior.coords]
            features.append({
                'vertices':     coords,
                'nombre':       str(_val(row, 'nombre',       'Evento importado')),
                'fecha_inicio': str(_val(row, 'fecha_inicio', '')),
                'fecha_fin':    str(_val(row, 'fecha_fin',    '')),
                'afluencia':    int(_val(row, 'afluencia',    50)),
                'duracion':     float(_val(row, 'duracion',   1)),
            })

        return jsonify({'eventos': features, 'total': len(features)})

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


# ==================== CALENDARIO ====================

# calendario.json se busca primero junto al script; si no, en static/data/
_base_dir = os.path.dirname(os.path.abspath(__file__))
_candidates = [
    os.path.join(_base_dir, 'calendario.json'),
    os.path.join(_base_dir, 'static', 'data', 'calendario.json'),
]
CALENDARIO_PATH = next((p for p in _candidates if os.path.exists(p)), _candidates[0])

def _cargar_calendario_disk():
    if os.path.exists(CALENDARIO_PATH):
        try:
            with open(CALENDARIO_PATH, 'r', encoding='utf-8') as f:
                return json.load(f).get('dias', {})
        except Exception:
            pass
    return {}

def _guardar_calendario_disk(dias):
    with open(CALENDARIO_PATH, 'w', encoding='utf-8') as f:
        json.dump({'dias': dias}, f, ensure_ascii=False, indent=2)

@app.route('/api/calendario')
def api_get_calendario():
    return jsonify({'dias': _cargar_calendario_disk()})

def _defecto_para_fecha(fecha_str):
    """Devuelve el array por defecto para 'YYYY-MM-DD'. L-V → lectivo+laborable, S-D → []."""
    try:
        dow = datetime.strptime(fecha_str, '%Y-%m-%d').weekday()  # 0=lun … 6=dom
        return ['lectivo', 'laborable'] if dow < 5 else []
    except ValueError:
        return []

@app.route('/api/calendario', methods=['POST'])
def api_set_calendario():
    data = request.get_json(force=True, silent=True) or {}
    dias = data.get('dias', {})
    tipos_dias = {'lectivo', 'laborable', 'festivo', 'evento'}
    dias_limpios = {}
    for k, v in dias.items():
        # Normalizar a lista de tipos válidos
        if isinstance(v, list):
            arr = [t for t in v if t in tipos_dias]
        elif isinstance(v, str) and v in tipos_dias:
            arr = [v]
        else:
            continue  # entrada inválida → ignorar

        # Solo guardar si se desvía del defecto para ese día
        if arr != _defecto_para_fecha(k):
            dias_limpios[k] = arr

    _guardar_calendario_disk(dias_limpios)
    return jsonify({'ok': True, 'total': len(dias_limpios)})


# ==================== HISTORIAL DE RUTAS ====================

@app.route('/api/historial')
def api_historial_obtener():
    """Devuelve las últimas 50 rutas del usuario en sesión."""
    if not session.get('autenticado') or session.get('rol') == 'invitado':
        return jsonify({'error': 'No autorizado'}), 401

    usuario = session['usuario']
    rutas   = (HistorialRuta.query
               .filter_by(usuario=usuario)
               .order_by(HistorialRuta.fecha.desc())
               .limit(50)
               .all())

    return jsonify({'rutas': [
        {
            'id':            r.id,
            'fecha':         r.fecha.isoformat() if r.fecha else None,
            'origen_label':  r.origen_label,
            'destino_label': r.destino_label,
            'tiempo_min':    r.tiempo_min,
            'distancia_km':  r.distancia_km,
            'vehiculo':      r.vehiculo,
            'origen_coords': [r.origen_lat, r.origen_lng] if r.origen_lat else None,
            'destino_coords':[r.destino_lat, r.destino_lng] if r.destino_lat else None,
            'geojson_ruta':  json.loads(r.geojson_ruta) if r.geojson_ruta else None,
        }
        for r in rutas
    ]})


@app.route('/api/historial/guardar', methods=['POST'])
def api_historial_guardar():
    """Guarda una ruta en el historial del usuario."""
    if not session.get('autenticado') or session.get('rol') == 'invitado':
        return jsonify({'error': 'No autorizado'}), 401

    data    = request.get_json(force=True, silent=True) or {}
    usuario = session['usuario']

    o_coords = data.get('origen_coords')  or [None, None]
    d_coords = data.get('destino_coords') or [None, None]
    geojson  = data.get('geojson_ruta')
    geojson_str = json.dumps(geojson, ensure_ascii=False) if geojson else None

    ruta = HistorialRuta(
        usuario       = usuario,
        origen_label  = data.get('origen_label',  '')[:256],
        destino_label = data.get('destino_label', '')[:256],
        tiempo_min    = data.get('tiempo_min'),
        distancia_km  = data.get('distancia_km'),
        vehiculo      = data.get('vehiculo', 'coche')[:32],
        origen_lat    = o_coords[0] if len(o_coords) > 0 else None,
        origen_lng    = o_coords[1] if len(o_coords) > 1 else None,
        destino_lat   = d_coords[0] if len(d_coords) > 0 else None,
        destino_lng   = d_coords[1] if len(d_coords) > 1 else None,
        geojson_ruta  = geojson_str,
    )
    db.session.add(ruta)
    db.session.commit()
    return jsonify({'ok': True, 'id': ruta.id})


@app.route('/api/historial/<int:ruta_id>', methods=['DELETE'])
def api_historial_eliminar(ruta_id):
    """Elimina una ruta del historial si pertenece al usuario en sesión."""
    if not session.get('autenticado') or session.get('rol') == 'invitado':
        return jsonify({'error': 'No autorizado'}), 401

    usuario = session['usuario']
    ruta    = HistorialRuta.query.filter_by(id=ruta_id, usuario=usuario).first()
    if not ruta:
        return jsonify({'error': 'No encontrado'}), 404

    db.session.delete(ruta)
    db.session.commit()
    return jsonify({'ok': True})


# ==================== PERSISTENCIA DE OBSTÁCULOS ====================

@app.route('/api/sesion/guardar-obstaculos', methods=['POST'])
def api_sesion_guardar():
    """Guarda (o actualiza) la sesión de obstáculos del usuario."""
    if not session.get('autenticado') or session.get('rol') == 'invitado':
        return jsonify({'error': 'No autorizado'}), 401

    try:
        raw  = request.get_data(as_text=True)
        data = json.loads(raw) if raw else {}
    except Exception:
        data = {}

    obstaculos_lista = data.get('obstaculos', [])
    if not isinstance(obstaculos_lista, list):
        return jsonify({'error': 'Formato inválido'}), 400

    usuario  = session['usuario']
    registro = SesionObstaculos.query.filter_by(usuario=usuario).first()
    datos_str = json.dumps(obstaculos_lista, ensure_ascii=False)

    if registro:
        registro.datos_json  = datos_str
        registro.guardado_en = datetime.utcnow()
        registro.confirmado  = False
    else:
        registro = SesionObstaculos(
            usuario    = usuario,
            datos_json = datos_str,
            confirmado = False,
        )
        db.session.add(registro)

    db.session.commit()
    return jsonify({'ok': True, 'total': len(obstaculos_lista)})


@app.route('/api/sesion/recuperar-obstaculos')
def api_sesion_recuperar():
    """Devuelve la sesión guardada si está pendiente de confirmar."""
    if not session.get('autenticado') or session.get('rol') == 'invitado':
        return jsonify({'pendiente': False}), 200

    usuario  = session['usuario']
    registro = SesionObstaculos.query.filter_by(usuario=usuario).first()

    if not registro or registro.confirmado:
        return jsonify({'pendiente': False})

    try:
        obstaculos_lista = json.loads(registro.datos_json)
    except Exception:
        obstaculos_lista = []

    return jsonify({
        'pendiente':   True,
        'obstaculos':  obstaculos_lista,
        'guardado_en': registro.guardado_en.isoformat() if registro.guardado_en else None,
    })


@app.route('/api/sesion/confirmar-recuperado', methods=['POST'])
def api_sesion_confirmar():
    """Marca la sesión guardada como confirmada."""
    if not session.get('autenticado') or session.get('rol') == 'invitado':
        return jsonify({'error': 'No autorizado'}), 401

    usuario  = session['usuario']
    registro = SesionObstaculos.query.filter_by(usuario=usuario).first()
    if registro:
        registro.confirmado = True
        db.session.commit()

    return jsonify({'ok': True})


# ==================== SOCKETIO ====================

def _obs_a_dict(obs):
    # Tabla nivel (1-4) → obstruccion (0-1), igual que NIVELES_OBS en route-manager.js
    _NIVEL_A_OBS = {1: 0.25, 2: 0.50, 3: 0.75, 4: 0.99}
    nivel = max(1, min(4, obs.nivel_val or 2))
    return {
        'id':          obs.id,
        'obs_id':      obs.obs_id,
        'lat':         obs.lat,
        'lng':         obs.lng,
        'nivel':       nivel,
        'obstruccion': _NIVEL_A_OBS[nivel],
        'portal':      obs.portal or '',
        'autor':       obs.autor,
    }


@app.route('/api/obstaculos-compartidos')
def api_obs_compartidos_get():
    if not session.get('autenticado') or session.get('rol') == 'invitado':
        return jsonify({'error': 'No autorizado'}), 401
    todos = ObstaculoCompartido.query.order_by(ObstaculoCompartido.creado_en).all()
    return jsonify({'obstaculos': [_obs_a_dict(o) for o in todos]})


@socketio.on('connect')
def ws_on_connect():
    print(f'[WS] Cliente conectado: {session.get("usuario", "anon")}')


@socketio.on('disconnect')
def ws_on_disconnect():
    print(f'[WS] Cliente desconectado: {session.get("usuario", "anon")}')


@socketio.on('obs_compartido_crear')
def ws_obs_crear(data):
    if not session.get('autenticado') or session.get('rol') == 'invitado':
        return
    obs = ObstaculoCompartido(
        obs_id     = data.get('obs_id') or None,
        lat        = float(data['lat']),
        lng        = float(data['lng']),
        nivel_val  = int(data.get('nivel', 2)),
        portal     = data.get('portal', ''),
        autor      = session.get('usuario'),
    )
    db.session.add(obs)
    db.session.commit()
    socketio.emit('obs_compartido_nuevo', _obs_a_dict(obs))
    print(f'[WS] obs_compartido_crear: #{obs.id} por {session.get("usuario")}')


@socketio.on('obs_compartido_eliminar')
def ws_obs_eliminar(data):
    if not session.get('autenticado') or session.get('rol') == 'invitado':
        return
    obs = ObstaculoCompartido.query.get(int(data.get('id', 0)))
    if not obs:
        return
    obs_id = obs.id
    db.session.delete(obs)
    db.session.commit()
    socketio.emit('obs_compartido_eliminado', {'id': obs_id})
    print(f'[WS] obs_compartido_eliminar: #{obs_id} por {session.get("usuario")}')


@socketio.on('obs_compartido_mover')
def ws_obs_mover(data):
    if not session.get('autenticado') or session.get('rol') == 'invitado':
        return
    obs = ObstaculoCompartido.query.get(int(data.get('id', 0)))
    if not obs:
        return
    if 'lat'        in data: obs.lat        = float(data['lat'])
    if 'lng'        in data: obs.lng        = float(data['lng'])
    if 'nivel'      in data: obs.nivel_val  = int(data['nivel'])
    if 'portal'     in data: obs.portal     = data['portal']
    obs.autor         = session.get('usuario')
    obs.modificado_en = datetime.utcnow()
    db.session.commit()
    socketio.emit('obs_compartido_actualizado', _obs_a_dict(obs))
    print(f'[WS] obs_compartido_mover: #{obs.id} por {session.get("usuario")}')


# ==================== OGC WMS (Web Map Service) ====================
#
# Implementación mínima pero estándar OGC WMS 1.3.0.
# Soporta:
#   GetCapabilities → descripción XML de capas disponibles
#   GetMap          → imagen PNG de la capa en el BBOX solicitado
#   GetFeatureInfo  → atributos del feature bajo el pixel clicado
#
# Capas expuestas:
#   vias       → Red viaria OSM (LineString)
#   puntos     → Puntos de interés
#   obstaculos → Obstáculos activos
#
# Uso desde QGIS: Capa → Añadir capa WMS/WMTS → URL: http://localhost:5000/wms

import io as _io
try:
    matplotlib.use('Agg')
    _MATPLOTLIB_OK = True
except ImportError:
    _MATPLOTLIB_OK = False

# ── Colores por tipo de vía (misma paleta que symbology.js) ──────────────────
_COLOR_VIA = {
    'motorway': '#B66963', 'motorway_link': '#B66963',
    'trunk': '#CE8B4F',    'trunk_link': '#CE8B4F',
    'primary': '#CE8B4F',  'primary_link': '#CE8B4F',
    'secondary': '#E7B92E','secondary_link': '#E7B92E',
    'tertiary': '#BDB58B', 'tertiary_link': '#BDB58B',
    'residential': '#C7C5BD', 'unclassified': '#C7C5BD',
    'service': '#C7C5BD',  'living_street': '#C7C5BD',
    'footway': '#45812B',  'pedestrian': '#45812B',
    'cycleway': '#5B75A7', 'track': '#A8987C',
    'path': '#A8987C',     'default': '#D6D6D6',
}


def _hex_to_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) / 255 for i in (0, 2, 4))


def _wms_capabilities_xml():
    """Genera el XML de GetCapabilities para WMS 1.3.0."""
    layers_xml = ''
    capas = []
    if vias_gdf is not None:
        b = vias_gdf.total_bounds  # [minx, miny, maxx, maxy]
        capas.append(('vias', 'Red de Vías OSM', b))
    if PuntosDinteres_dic:
        # bbox combinado de todos los puntos
        all_pts = gpd.GeoDataFrame(
            pd.concat(PuntosDinteres_dic.values(), ignore_index=True),
            crs='EPSG:4258'
        )
        b = all_pts.total_bounds
        capas.append(('puntos', 'Puntos de Interés', b))
    if not capas:
        # bbox por defecto (municipio de Puerto Lumbreras)
        capas = [
            ('vias', 'Red de Vías OSM', [-1.88, 37.53, -1.75, 37.60]),
            ('puntos', 'Puntos de Interés', [-1.88, 37.53, -1.75, 37.60]),
            ('obstaculos', 'Obstáculos activos', [-1.88, 37.53, -1.75, 37.60]),
        ]

    for name, title, b in capas:
        layers_xml += f"""
        <Layer queryable="1" opaque="0">
          <Name>{name}</Name>
          <Title>{title}</Title>
          <CRS>EPSG:4258</CRS>
          <CRS>CRS:84</CRS>
          <EX_GeographicBoundingBox>
            <westBoundLongitude>{b[0]:.6f}</westBoundLongitude>
            <eastBoundLongitude>{b[2]:.6f}</eastBoundLongitude>
            <southBoundLatitude>{b[1]:.6f}</southBoundLatitude>
            <northBoundLatitude>{b[3]:.6f}</northBoundLatitude>
          </EX_GeographicBoundingBox>
          <BoundingBox CRS="EPSG:4258"
            minx="{b[1]:.6f}" miny="{b[0]:.6f}"
            maxx="{b[3]:.6f}" maxy="{b[2]:.6f}"/>
        </Layer>"""

    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0"
  xmlns="http://www.opengis.net/wms"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.opengis.net/wms
    http://schemas.opengis.net/wms/1.3.0/capabilities_1_3_0.xsd">
  <Service>
    <Name>WMS</Name>
    <Title>GeoRuta WMS — Puerto Lumbreras</Title>
    <Abstract>Servicio WMS del sistema GeoRuta. Expone la red viaria, puntos de interés y obstáculos sísmicos del municipio de Puerto Lumbreras (Murcia).</Abstract>
    <OnlineResource xlink:href="/wms" xmlns:xlink="http://www.w3.org/1999/xlink"/>
    <ContactInformation>
      <ContactOrganization>GeoRuta — ETSIGCT</ContactOrganization>
    </ContactInformation>
    <Fees>none</Fees>
    <AccessConstraints>none</AccessConstraints>
  </Service>
  <Capability>
    <Request>
      <GetCapabilities>
        <Format>text/xml</Format>
        <DCPType><HTTP><Get><OnlineResource xlink:href="/wms" xmlns:xlink="http://www.w3.org/1999/xlink"/></Get></HTTP></DCPType>
      </GetCapabilities>
      <GetMap>
        <Format>image/png</Format>
        <DCPType><HTTP><Get><OnlineResource xlink:href="/wms" xmlns:xlink="http://www.w3.org/1999/xlink"/></Get></HTTP></DCPType>
      </GetMap>
      <GetFeatureInfo>
        <Format>text/plain</Format>
        <Format>application/json</Format>
        <DCPType><HTTP><Get><OnlineResource xlink:href="/wms" xmlns:xlink="http://www.w3.org/1999/xlink"/></Get></HTTP></DCPType>
      </GetFeatureInfo>
    </Request>
    <Exception><Format>XML</Format></Exception>
    <Layer>
      <Title>GeoRuta — Capas disponibles</Title>
      <CRS>EPSG:4258</CRS>
      <CRS>CRS:84</CRS>
      {layers_xml}
    </Layer>
  </Capability>
</WMS_Capabilities>"""
    return xml


def _wms_get_map(layer_name, bbox, width, height, styles=''):
    """
    Renderiza la capa indicada en el BBOX solicitado y devuelve bytes PNG.
    bbox = (miny, minx, maxy, maxx) en EPSG:4258 (lat/lon).
    """
    if not _MATPLOTLIB_OK:
        raise RuntimeError('matplotlib no disponible')

    miny, minx, maxy, maxx = bbox   # EPSG:4258: BBOX = miny,minx,maxy,maxx
    fig, ax = plt.subplots(figsize=(width / 96, height / 96), dpi=96)
    ax.set_facecolor('#f0f0f0')
    ax.set_xlim(minx, maxx)
    ax.set_ylim(miny, maxy)
    ax.axis('off')
    fig.subplots_adjust(left=0, right=1, top=1, bottom=0)

    if layer_name == 'vias' and vias_gdf is not None:
        for _, row in vias_gdf.iterrows():
            hw = str(row.get('highway', 'default') or 'default').lower()
            color = _hex_to_rgb(_COLOR_VIA.get(hw, _COLOR_VIA['default']))
            geom = row.geometry
            lines = [geom] if geom.geom_type == 'LineString' else list(geom.geoms)
            for line in lines:
                xs, ys = zip(*line.coords)
                ax.plot(xs, ys, color=color, linewidth=0.8, solid_capstyle='round')

    elif layer_name == 'puntos' and PuntosDinteres_dic:
        colores = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
                   '#1abc9c', '#e67e22', '#34495e']
        for i, (nombre, gdf) in enumerate(PuntosDinteres_dic.items()):
            color = colores[i % len(colores)]
            pts = gdf[gdf.geometry.intersects(
                ShapelyPolygon([(minx,miny),(maxx,miny),(maxx,maxy),(minx,maxy)])
            )]
            if not pts.empty:
                ax.scatter(pts.geometry.x, pts.geometry.y,
                           c=color, s=10, zorder=5, linewidths=0)

    elif layer_name == 'obstaculos':
        # obstaculos es lista global de route-manager equivalente
        # En el servidor Python no hay "obstaculos" de JS, solo los que
        # el cliente envía → devolvemos capa vacía con mensaje
        ax.text((minx+maxx)/2, (miny+maxy)/2,
                'Sin obstáculos activos\n(gestión en cliente)',
                ha='center', va='center', fontsize=8, color='#555')

    buf = _io.BytesIO()
    fig.savefig(buf, format='png', bbox_inches='tight', pad_inches=0)
    plt.close(fig)
    buf.seek(0)
    return buf.read()


def _wms_get_feature_info(layer_name, bbox, x, y, width, height):
    """
    Devuelve los atributos del feature más cercano al píxel (x,y).
    bbox = (miny, minx, maxy, maxx).
    """
    miny, minx, maxy, maxx = bbox
    # Convertir píxel → coordenada geográfica
    lon = minx + (x / width)  * (maxx - minx)
    lat = maxy - (y / height) * (maxy - miny)
    punto = Point(lon, lat)
    radio = max((maxx - minx) / width * 5, 0.0002)  # ~5 píxeles

    resultados = []
    if layer_name == 'vias' and vias_gdf is not None:
        cerca = vias_gdf[vias_gdf.distance(punto) <= radio]
        for _, row in cerca.head(3).iterrows():
            props = {k: str(v) for k, v in row.items() if k != 'geometry'}
            resultados.append(props)

    elif layer_name == 'puntos' and PuntosDinteres_dic:
        for nombre, gdf in PuntosDinteres_dic.items():
            cerca = gdf[gdf.distance(punto) <= radio]
            for _, row in cerca.head(2).iterrows():
                props = {k: str(v) for k, v in row.items() if k != 'geometry'}
                props['_capa'] = nombre
                resultados.append(props)

    return resultados


@app.route('/wms')
def wms_endpoint():
    """
    Endpoint OGC WMS 1.3.0.
    Parámetros estándar: SERVICE, REQUEST, VERSION, LAYERS, BBOX, WIDTH, HEIGHT,
                         CRS/SRS, FORMAT, QUERY_LAYERS, I, J.
    """
    service  = request.args.get('SERVICE', 'WMS').upper()
    req_type = request.args.get('REQUEST', 'GetCapabilities').strip()

    if service != 'WMS':
        return Response(
            '<ServiceExceptionReport><ServiceException>SERVICE debe ser WMS</ServiceException></ServiceExceptionReport>',
            mimetype='application/xml', status=400)

    # ── GetCapabilities ──────────────────────────────────────────────────────
    if req_type == 'GetCapabilities':
        return Response(_wms_capabilities_xml(), mimetype='text/xml; charset=utf-8')

    # ── GetMap ───────────────────────────────────────────────────────────────
    if req_type == 'GetMap':
        if not _MATPLOTLIB_OK:
            return Response(
                '<ServiceExceptionReport><ServiceException>matplotlib no instalado</ServiceException></ServiceExceptionReport>',
                mimetype='application/xml', status=500)
        try:
            layer  = request.args.get('LAYERS', 'vias').split(',')[0].strip().lower()
            bbox_s = request.args.get('BBOX', '')
            width  = int(request.args.get('WIDTH',  256))
            height = int(request.args.get('HEIGHT', 256))
            width  = min(max(width,  64), 2048)
            height = min(max(height, 64), 2048)

            if not bbox_s:
                raise ValueError('BBOX requerido')
            parts = [float(v) for v in bbox_s.split(',')]
            if len(parts) != 4:
                raise ValueError('BBOX debe tener 4 valores')

            png = _wms_get_map(layer, parts, width, height)
            return Response(png, mimetype='image/png')

        except Exception as e:
            import traceback; traceback.print_exc()
            xml_err = f'<ServiceExceptionReport><ServiceException>{e}</ServiceException></ServiceExceptionReport>'
            return Response(xml_err, mimetype='application/xml', status=400)

    # ── GetFeatureInfo ───────────────────────────────────────────────────────
    if req_type == 'GetFeatureInfo':
        try:
            layer  = request.args.get('QUERY_LAYERS', request.args.get('LAYERS', 'vias')).split(',')[0].strip().lower()
            bbox_s = request.args.get('BBOX', '')
            width  = int(request.args.get('WIDTH',  256))
            height = int(request.args.get('HEIGHT', 256))
            i      = int(request.args.get('I', request.args.get('X', 0)))
            j      = int(request.args.get('J', request.args.get('Y', 0)))
            fmt    = request.args.get('INFO_FORMAT', 'application/json').lower()

            parts = [float(v) for v in bbox_s.split(',')]
            resultados = _wms_get_feature_info(layer, parts, i, j, width, height)

            if 'json' in fmt:
                return jsonify({'features': resultados, 'layer': layer})
            else:
                lines = [f'Layer: {layer}', f'Features: {len(resultados)}']
                for r in resultados:
                    lines.append('---')
                    for k, v in r.items():
                        lines.append(f'{k}: {v}')
                return Response('\n'.join(lines), mimetype='text/plain; charset=utf-8')

        except Exception as e:
            return Response(str(e), mimetype='text/plain', status=400)

    return Response(
        f'<ServiceExceptionReport><ServiceException>REQUEST no soportado: {req_type}</ServiceException></ServiceExceptionReport>',
        mimetype='application/xml', status=400)


# ==================== OGC WFS (Web Feature Service) ====================
#
# Implementación estándar OGC WFS 2.0.0.
# Soporta:
#   GetCapabilities → descripción XML de feature types
#   DescribeFeatureType → esquema de atributos de la capa
#   GetFeature → features en GeoJSON (outputFormat=application/json)
#                o GML 3.2 (outputFormat por defecto)
#
# Filtros soportados (parámetros URL):
#   TYPENAME         → nombre de la capa (vias / puntos / obstaculos_sesion)
#   COUNT / MAXFEATURES → límite de features
#   BBOX             → filtro espacial (minx,miny,maxx,maxy,EPSG:4258)
#   PROPERTYNAME     → lista de atributos a incluir
#   outputFormat     → application/json | text/xml
#
# Uso desde QGIS: Capa → Añadir capa WFS → URL: http://localhost:5000/wfs


def _wfs_capabilities_xml():
    """Genera el XML de GetCapabilities para WFS 2.0.0."""
    feature_types = ''
    tipos = []
    if vias_gdf is not None:
        b = vias_gdf.total_bounds
        tipos.append(('georuta:vias', 'Red de Vías OSM',
                       f'{b[1]:.6f} {b[0]:.6f}', f'{b[3]:.6f} {b[2]:.6f}'))
    if PuntosDinteres_dic:
        all_pts = gpd.GeoDataFrame(
            pd.concat(PuntosDinteres_dic.values(), ignore_index=True), crs='EPSG:4258')
        b = all_pts.total_bounds
        tipos.append(('georuta:puntos', 'Puntos de Interés',
                       f'{b[1]:.6f} {b[0]:.6f}', f'{b[3]:.6f} {b[2]:.6f}'))
    if portales_gdf is not None:
        b = portales_gdf.total_bounds
        tipos.append(('georuta:portales', 'Numeración Postal',
                       f'{b[1]:.6f} {b[0]:.6f}', f'{b[3]:.6f} {b[2]:.6f}'))
    if not tipos:
        tipos = [('georuta:vias', 'Red de Vías OSM', '37.53 -1.88', '37.60 -1.75')]

    for ft_name, ft_title, ll, ur in tipos:
        feature_types += f"""
    <FeatureType>
      <Name>{ft_name}</Name>
      <Title>{ft_title}</Title>
      <DefaultCRS>urn:ogc:def:crs:EPSG::4258</DefaultCRS>
      <OtherCRS>urn:ogc:def:crs:EPSG::4326</OtherCRS>
      <ows:WGS84BoundingBox>
        <ows:LowerCorner>{ll}</ows:LowerCorner>
        <ows:UpperCorner>{ur}</ows:UpperCorner>
      </ows:WGS84BoundingBox>
      <OutputFormats>
        <Format>application/json</Format>
        <Format>text/xml; subtype=gml/3.2</Format>
      </OutputFormats>
    </FeatureType>"""

    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<wfs:WFS_Capabilities version="2.0.0"
  xmlns:wfs="http://www.opengis.net/wfs/2.0"
  xmlns:ows="http://www.opengis.net/ows/1.1"
  xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:gml="http://www.opengis.net/gml/3.2"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.opengis.net/wfs/2.0
    http://schemas.opengis.net/wfs/2.0/wfs.xsd">
  <ows:ServiceIdentification>
    <ows:Title>GeoRuta WFS — Puerto Lumbreras</ows:Title>
    <ows:Abstract>Servicio WFS del sistema GeoRuta. Expone la red viaria, puntos de interés y numeración postal del municipio de Puerto Lumbreras (Murcia).</ows:Abstract>
    <ows:ServiceType>WFS</ows:ServiceType>
    <ows:ServiceTypeVersion>2.0.0</ows:ServiceTypeVersion>
    <ows:Fees>none</ows:Fees>
    <ows:AccessConstraints>none</ows:AccessConstraints>
  </ows:ServiceIdentification>
  <ows:ServiceProvider>
    <ows:ProviderName>GeoRuta — ETSIGCT</ows:ProviderName>
  </ows:ServiceProvider>
  <ows:OperationsMetadata>
    <ows:Operation name="GetCapabilities">
      <ows:DCP><ows:HTTP><ows:Get xlink:href="/wfs"/></ows:HTTP></ows:DCP>
    </ows:Operation>
    <ows:Operation name="DescribeFeatureType">
      <ows:DCP><ows:HTTP><ows:Get xlink:href="/wfs"/></ows:HTTP></ows:DCP>
    </ows:Operation>
    <ows:Operation name="GetFeature">
      <ows:DCP><ows:HTTP><ows:Get xlink:href="/wfs"/></ows:HTTP></ows:DCP>
      <ows:Parameter name="outputFormat">
        <ows:AllowedValues>
          <ows:Value>application/json</ows:Value>
          <ows:Value>text/xml; subtype=gml/3.2</ows:Value>
        </ows:AllowedValues>
      </ows:Parameter>
    </ows:Operation>
  </ows:OperationsMetadata>
  <FeatureTypeList>
    {feature_types}
  </FeatureTypeList>
</wfs:WFS_Capabilities>"""
    return xml


def _wfs_describe_feature_type(typename):
    """Genera el esquema XSD de atributos para el FeatureType indicado."""
    tn = typename.split(':')[-1].lower() if typename else 'vias'
    gdf = None
    geom_type = 'gml:LineStringPropertyType'
    if tn == 'vias' and vias_gdf is not None:
        gdf = vias_gdf
        geom_type = 'gml:LineStringPropertyType'
    elif tn == 'puntos' and PuntosDinteres_dic:
        gdf = pd.concat(PuntosDinteres_dic.values(), ignore_index=True)
        gdf = gpd.GeoDataFrame(gdf, crs='EPSG:4258')
        geom_type = 'gml:PointPropertyType'
    elif tn == 'portales' and portales_gdf is not None:
        gdf = portales_gdf
        geom_type = 'gml:PointPropertyType'

    elements = f'<xs:element name="geometry" type="{geom_type}" minOccurs="0"/>\n'
    if gdf is not None:
        for col in gdf.columns:
            if col == 'geometry': continue
            dtype = str(gdf[col].dtype)
            xs_type = 'xs:integer' if 'int' in dtype else \
                      'xs:decimal' if 'float' in dtype else 'xs:string'
            elements += f'        <xs:element name="{col}" type="{xs_type}" minOccurs="0" nillable="true"/>\n'

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<xs:schema
  targetNamespace="http://georuta.local"
  xmlns:georuta="http://georuta.local"
  xmlns:gml="http://www.opengis.net/gml/3.2"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  elementFormDefault="qualified" version="1.0">
  <xs:import namespace="http://www.opengis.net/gml/3.2"
    schemaLocation="http://schemas.opengis.net/gml/3.2.1/gml.xsd"/>
  <xs:element name="{tn}" type="georuta:{tn}Type" substitutionGroup="gml:AbstractFeature"/>
  <xs:complexType name="{tn}Type">
    <xs:complexContent>
      <xs:extension base="gml:AbstractFeatureType">
        <xs:sequence>
        {elements}
        </xs:sequence>
      </xs:extension>
    </xs:complexContent>
  </xs:complexType>
</xs:schema>"""


def _wfs_get_feature_geojson(typename, bbox_str=None, count=None, property_names=None):
    """
    Devuelve un FeatureCollection GeoJSON con los features de la capa indicada,
    opcionalmente filtrados por BBOX y limitados por COUNT.
    """
    tn = typename.split(':')[-1].lower() if typename else 'vias'

    if tn == 'vias':
        gdf = vias_gdf
    elif tn == 'puntos':
        if not PuntosDinteres_dic:
            gdf = None
        else:
            gdf = gpd.GeoDataFrame(
                pd.concat(PuntosDinteres_dic.values(), ignore_index=True),
                crs='EPSG:4258')
    elif tn == 'portales':
        gdf = portales_gdf
    else:
        gdf = None

    if gdf is None:
        return {'type': 'FeatureCollection', 'features': [],
                'totalFeatures': 0, 'numberMatched': 0, 'numberReturned': 0}

    gdf = gdf.copy()

    # Filtro BBOX (minx,miny,maxx,maxy,CRS — CRS ignorado, asumimos 4258)
    if bbox_str:
        try:
            parts = bbox_str.split(',')
            minx, miny, maxx, maxy = float(parts[0]), float(parts[1]), float(parts[2]), float(parts[3])
            from shapely.geometry import box as shp_box
            bbox_geom = shp_box(minx, miny, maxx, maxy)
            gdf = gdf[gdf.intersects(bbox_geom)].copy()
        except Exception:
            pass

    total = len(gdf)
    if count:
        try:
            gdf = gdf.head(int(count))
        except Exception:
            pass

    # Filtro de propiedades
    if property_names:
        cols = [p.strip() for p in property_names.split(',') if p.strip() in gdf.columns]
        cols.append('geometry')
        gdf = gdf[cols]

    # Serializar
    for col in gdf.columns:
        if col != 'geometry':
            try:
                gdf[col] = gdf[col].astype(str)
            except Exception:
                pass

    data = json.loads(gdf.to_json())
    data['totalFeatures']  = total
    data['numberMatched']  = total
    data['numberReturned'] = len(gdf)
    data['timeStamp']      = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    data['crs'] = {'type': 'name', 'properties': {'name': 'EPSG:4258'}}
    return data


def _wfs_get_feature_gml(typename, bbox_str=None, count=None):
    """Genera una respuesta GML 3.2 mínima para el FeatureType."""
    data = _wfs_get_feature_geojson(typename, bbox_str, count)
    tn = typename.split(':')[-1].lower() if typename else 'vias'
    members = ''
    for feat in data.get('features', [])[:50]:  # max 50 en GML por rendimiento
        props = feat.get('properties', {})
        geom  = feat.get('geometry', {})
        prop_xml = ''.join(
            f'<georuta:{k}>{v}</georuta:{k}>'
            for k, v in (props or {}).items()
            if v and v != 'None'
        )
        # Geometría simplificada (solo punto/línea)
        geom_xml = ''
        if geom.get('type') == 'Point':
            c = geom['coordinates']
            geom_xml = f'<gml:Point srsName="EPSG:4258"><gml:pos>{c[1]} {c[0]}</gml:pos></gml:Point>'
        elif geom.get('type') == 'LineString':
            coords = ' '.join(f'{c[1]} {c[0]}' for c in geom['coordinates'])
            geom_xml = f'<gml:LineString srsName="EPSG:4258"><gml:posList>{coords}</gml:posList></gml:LineString>'

        members += f"""
  <wfs:member>
    <georuta:{tn} gml:id="{tn}.{feat.get('id','0')}">
      {geom_xml}
      {prop_xml}
    </georuta:{tn}>
  </wfs:member>"""

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<wfs:FeatureCollection
  xmlns:wfs="http://www.opengis.net/wfs/2.0"
  xmlns:gml="http://www.opengis.net/gml/3.2"
  xmlns:georuta="http://georuta.local"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  numberMatched="{data['numberMatched']}"
  numberReturned="{data['numberReturned']}"
  timeStamp="{data.get('timeStamp','')}">
  {members}
</wfs:FeatureCollection>"""


@app.route('/wfs')
def wfs_endpoint():
    """
    Endpoint OGC WFS 2.0.0.
    Parámetros: SERVICE, REQUEST, VERSION, TYPENAME/TYPENAMES,
                BBOX, COUNT/MAXFEATURES, PROPERTYNAME, outputFormat.
    """
    service  = request.args.get('SERVICE', 'WFS').upper()
    req_type = request.args.get('REQUEST', 'GetCapabilities').strip()

    if service != 'WFS':
        return Response(
            '<ows:ExceptionReport><ows:Exception exceptionCode="InvalidParameterValue">'
            '<ows:ExceptionText>SERVICE debe ser WFS</ows:ExceptionText>'
            '</ows:Exception></ows:ExceptionReport>',
            mimetype='application/xml', status=400)

    # ── GetCapabilities ──────────────────────────────────────────────────────
    if req_type == 'GetCapabilities':
        return Response(_wfs_capabilities_xml(),
                        mimetype='text/xml; charset=utf-8')

    # ── DescribeFeatureType ──────────────────────────────────────────────────
    if req_type == 'DescribeFeatureType':
        typename = request.args.get('TYPENAME',
                   request.args.get('TYPENAMES', 'georuta:vias'))
        return Response(_wfs_describe_feature_type(typename),
                        mimetype='text/xml; charset=utf-8')

    # ── GetFeature ───────────────────────────────────────────────────────────
    if req_type == 'GetFeature':
        typename = request.args.get('TYPENAME',
                   request.args.get('TYPENAMES', 'georuta:vias'))
        bbox_str  = request.args.get('BBOX')
        count     = request.args.get('COUNT',
                    request.args.get('MAXFEATURES'))
        prop_names = request.args.get('PROPERTYNAME')
        out_fmt   = request.args.get('outputFormat',
                    request.args.get('OUTPUTFORMAT', 'application/json')).lower()

        try:
            if 'json' in out_fmt:
                data = _wfs_get_feature_geojson(typename, bbox_str, count, prop_names)
                return Response(
                    json.dumps(data, ensure_ascii=False),
                    mimetype='application/json; charset=utf-8')
            else:
                gml = _wfs_get_feature_gml(typename, bbox_str, count)
                return Response(gml,
                    mimetype='text/xml; subtype=gml/3.2; charset=utf-8')

        except Exception as e:
            import traceback; traceback.print_exc()
            return Response(
                f'<ows:ExceptionReport><ows:Exception><ows:ExceptionText>{e}</ows:ExceptionText></ows:Exception></ows:ExceptionReport>',
                mimetype='application/xml', status=500)

    return Response(
        f'<ows:ExceptionReport><ows:Exception exceptionCode="OperationNotSupported">'
        f'<ows:ExceptionText>REQUEST no soportado: {req_type}</ows:ExceptionText>'
        f'</ows:Exception></ows:ExceptionReport>',
        mimetype='application/xml', status=400)


# ==================== ERRORES ====================

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Recurso no encontrado'}), 404

@app.errorhandler(500)
def server_error(e):
    return jsonify({'error': 'Error interno del servidor'}), 500


# Conectar MongoDB al importar el módulo
_conectar_mongo()


# ==================== ARRANQUE ====================

if __name__ == '__main__':
    local_ip = 'localhost'
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(('8.8.8.8', 80))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        pass

    print("🗺️  Servidor GIS - Puerto Lumbreras  →  http://localhost:5000")
    print(f"📶 También accesible en la red local: http://{local_ip}:5000")

    # Copiar Num_portal.geojson a static/data si todavía no está ahí
    _src_portal = os.path.join(os.path.dirname(__file__), 'Num_portal.geojson')
    _dst_portal = os.path.join('static', 'data', 'Num_portal.geojson')
    if os.path.exists(_src_portal) and not os.path.exists(_dst_portal):
        shutil.copy2(_src_portal, _dst_portal)
        print("📋 Num_portal.geojson copiado a static/data/")

    capasDarranque()
    _conectar_mongo()
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)