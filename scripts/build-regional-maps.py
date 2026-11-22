"""Build the regional map asset from Natural Earth Admin 1 (5.1.1).

Use pyshp and shapely>=2.1, then run this script with the Natural Earth zip path.
Source: https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

import shapefile
from shapely import coverage_simplify, make_valid, simplify, union_all
from shapely.errors import GEOSException
from shapely.geometry import MultiPolygon, shape


def polygons(geometry):
    if geometry.geom_type == 'Polygon':
        yield geometry
    elif hasattr(geometry, 'geoms'):
        for part in geometry.geoms:
            yield from polygons(part)


def number(value):
    return f'{value:.3f}'.rstrip('0').rstrip('.')


def ring_path(ring):
    return 'M' + 'L'.join(f'{number(x)},{number(-y)}' for x, y in list(ring.coords)[:-1]) + 'Z'


def boundary_id(record):
    return record['iso_3166_2'] if record['iso_3166_2'] != '-99' else record['adm1_code']


def country_shapes(records):
    by_code = defaultdict(list)
    for record, geometry in records:
        by_code[boundary_id(record)].append((record, geometry))
    records = [
        parts[0] if len(parts) == 1 else (parts[0][0], union_all([geom for _, geom in parts]))
        for parts in by_code.values()
    ]
    # Simplify shared borders together so adjacent provinces have matching edges.
    geometries = [geom for _, geom in records]
    width = max(geom.bounds[2] for geom in geometries) - min(geom.bounds[0] for geom in geometries)
    height = max(geom.bounds[3] for geom in geometries) - min(geom.bounds[1] for geom in geometries)
    tolerance = max(0.006, min(0.25, max(width, height) / 140))
    try:
        simplified = coverage_simplify(geometries, tolerance)
    except GEOSException:
        simplified = simplify(geometries, tolerance / 2, preserve_topology=True)

    for (record, original), geometry in zip(records, simplified):
        parts = list(polygons(geometry)) or list(polygons(original))
        largest = max(part.area for part in parts)
        parts = [part for part in parts if part.area >= largest * 0.001]
        bounds = [
            min(part.bounds[0] for part in parts),
            -max(part.bounds[3] for part in parts),
            max(part.bounds[2] for part in parts),
            -min(part.bounds[1] for part in parts),
        ]
        yield {
            'id': boundary_id(record),
            'name': record['name_en'] or record['name'],
            'localName': record['name_zh'],
            'bounds': [round(value, 3) for value in bounds],
            'path': ''.join(ring_path(ring) for part in parts for ring in [part.exterior, *part.interiors]),
        }


def main():
    countries = defaultdict(list)
    with shapefile.Reader(sys.argv[1]) as source:
        for feature in source.iterShapeRecords():
            record = feature.record.as_dict()
            code = record['iso_a2']
            if len(code) != 2 or not code.isalpha():
                continue
            geometry = shape(feature.shape.__geo_interface__)
            geometry = geometry if geometry.is_valid else make_valid(geometry)
            parts = list(polygons(geometry))
            if parts:
                countries[code].append((record, parts[0] if len(parts) == 1 else MultiPolygon(parts)))

    target = Path(__file__).resolve().parents[1] / 'src/assets/regional-maps'
    target.mkdir(exist_ok=True)
    packs = defaultdict(list)
    expandable = []
    for code, records in sorted(countries.items()):
        shapes = list(country_shapes(records))
        if len(shapes) > 1:
            expandable.append(code)
        rows = json.dumps(shapes, ensure_ascii=False, separators=(',', ':'))
        packs[code[0].lower()].append(f'  "{code}":{rows}')
    for prefix, rows in packs.items():
        (target / f'{prefix}.json').write_text('{\n' + ',\n'.join(rows) + '\n}\n', encoding='utf-8')
    (target.parent / 'regional-map-countries.json').write_text(json.dumps(expandable) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
