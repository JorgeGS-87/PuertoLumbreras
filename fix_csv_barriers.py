#!/usr/bin/env python3
"""
Script para corregir el CSV de obstáculos de LORCA.
Las coordenadas están en notación científica malformada y necesitan ser extraídas.
Ejemplo: 3,76765E+15 -> 37.6765, -1,70076E+16 -> -1.70076
"""
import csv
import re

def extract_coords_from_broken_scientific(lat_str, lon_str):
    """
    Extrae coordenadas reales de notación científica malformada.
    
    Para Lorca, España:
    - Latitud: 3,76765E+15 -> 37.67650 (necesita insertar el 7)
    - Longitud: -1,70076E+16 -> -1.70076 (solo punto decimal)
    """
    try:
        # Intentar conversión directa primero
        lat = float(lat_str.replace(',', '.'))
        lon = float(lon_str.replace(',', '.'))
        if -90 <= lat <= 90 and -180 <= lon <= 180:
            return lat, lon
    except:
        pass
    
    # Extraer patrón: dígito,dígitos E signo dígitos
    lat_match = re.match(r'^([+-]?)(\d)[,.](\d+)E([+-])(\d+)$', lat_str.strip())
    lon_match = re.match(r'^([+-]?)(\d)[,.](\d+)E([+-])(\d+)$', lon_str.strip())
    
    if not (lat_match and lon_match):
        return None, None
    
    # ──── LATITUD (rango 0-90): insertar primer decimal como dígito extra ────
    lat_sign, lat_first, lat_decimals, lat_exp_sign, lat_exp = lat_match.groups()
    if len(lat_decimals) >= 4:
        # 3,76765 -> 3[7].6765 = 37.6765
        lat = float(f"{lat_first}{lat_decimals[0]}.{lat_decimals[1:]}")
    else:
        lat = float(f"{lat_first}.{lat_decimals}")
    
    if lat_sign == '-' or lat_exp_sign == '-':
        lat = -lat
    
    # ──── LONGITUD (rango -180 a 180): NO insertar, solo punto decimal ────
    lon_sign, lon_first, lon_decimals, lon_exp_sign, lon_exp = lon_match.groups()
    # -1,70076 -> -1.70076 (sin insertar el 7 en la parte entera)
    lon = float(f"{lon_first}.{lon_decimals}")
    
    if lon_sign == '-':
        lon = -lon
    if lon_exp_sign == '-':
        lon = -lon
    
    # Validar rangos
    if -90 <= lat <= 90 and -180 <= lon <= 180:
        return lat, lon
    
    return None, None

def fix_csv(input_file, output_file):
    """Lee CSV malformado y genera uno correcto."""
    rows_fixed = []
    errors = []
    
    with open(input_file, 'r', encoding='utf-8') as f:
        # Detectar separador
        first_line = f.readline()
        separator = ';' if ';' in first_line else ','
        f.seek(0)
        
        reader = csv.DictReader(f, delimiter=separator)
        
        print(f"📋 Encabezados: {reader.fieldnames}")
        print(f"🔍 Separador detectado: '{separator}'\n")
        
        for row_num, row in enumerate(reader, start=2):
            try:
                obstacle_id = row.get('id', '').strip()
                if not obstacle_id:
                    continue
                
                lat_str = row.get('lat', '').strip()
                lon_str = row.get('lng', '').strip()
                barrier_level = row.get('barrier_level', '1').strip()
                
                # Extraer coordenadas
                lat, lon = extract_coords_from_broken_scientific(lat_str, lon_str)
                
                if lat is None or lon is None:
                    errors.append(f"Fila {row_num}: No se pudo parsear ({lat_str}, {lon_str})")
                    continue
                
                # Crear registro corregido
                rows_fixed.append({
                    'id': obstacle_id,
                    'Nombre': f"Barrera {obstacle_id}",
                    'coord_lat': f"{lat:.5f}",
                    'coord_lon': f"{lon:.5f}",
                    'Nivel': barrier_level,
                    'Cruce': 'No',
                    'Calles': '',
                    'Portal': ''
                })
                
                if row_num <= 5:  # Mostrar primeros registros
                    print(f"✅ Fila {row_num}: {obstacle_id:3s} -> lat={lat:.5f}, lon={lon:.5f}")
                    
            except Exception as e:
                errors.append(f"Fila {row_num}: {str(e)}")
    
    # Guardar CSV corregido
    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(
            f, 
            fieldnames=['id', 'Nombre', 'coord_lat', 'coord_lon', 'Nivel', 'Cruce', 'Calles', 'Portal'],
            delimiter=','  # Usar coma como separador estándar
        )
        writer.writeheader()
        writer.writerows(rows_fixed)
    
    print(f"\n✅ CSV corregido guardado: {output_file}")
    print(f"📊 Obstáculos procesados: {len(rows_fixed)}")
    
    if errors:
        print(f"\n⚠️  {len(errors)} errores:")
        for err in errors[:5]:
            print(f"   {err}")
        if len(errors) > 5:
            print(f"   ... y {len(errors) - 5} más")

if __name__ == '__main__':
    input_file = 'barriers_LORCA2.csv'
    output_file = 'barriers_LORCA2_FIXED.csv'
    
    print("=" * 60)
    print("🔧 REPARADOR DE CSV DE BARRERAS/OBSTÁCULOS")
    print("=" * 60)
    print(f"📥 Entrada:  {input_file}")
    print(f"📤 Salida:   {output_file}\n")
    
    fix_csv(input_file, output_file)
