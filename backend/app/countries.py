"""Country lookup for detection points (Natural Earth 110m, public domain), with a bounding-box prefilter."""
import json

from app import config

_index: list = []


def _bbox(coords) -> list:
    """West, south, east, north of nested GeoJSON coordinates."""
    box = [180.0, 90.0, -180.0, -90.0]
    stack = [coords]
    while stack:
        item = stack.pop()
        if isinstance(item[0], (int, float)):
            box[0] = min(box[0], item[0])
            box[1] = min(box[1], item[1])
            box[2] = max(box[2], item[0])
            box[3] = max(box[3], item[1])
        else:
            stack.extend(item)
    return box


def _load() -> list:
    """Read countries.json once and keep (bbox, polygons, name, iso3) per country."""
    if _index:
        return _index
    with open(config.STATIC_DIR / "countries.json", encoding="utf-8") as handle:
        features = json.load(handle)["data"]["features"]
    for feature in features:
        geometry = feature.get("geometry") or {}
        polygons = []
        if geometry.get("type") == "Polygon":
            polygons = [geometry["coordinates"]]
        elif geometry.get("type") == "MultiPolygon":
            polygons = geometry["coordinates"]
        if polygons:
            _index.append((_bbox(polygons), polygons, feature["properties"].get("name"), feature["properties"].get("iso3")))
    return _index


def _ring_contains(ring: list, lon: float, lat: float) -> bool:
    """Ray casting: is (lon, lat) inside the ring?"""
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def country_of(lat: float, lon: float):
    """Return (name, iso3) of the country containing the point, or (None, None) at sea / outside polygons."""
    for box, polygons, name, iso3 in _load():
        if lon < box[0] or lon > box[2] or lat < box[1] or lat > box[3]:
            continue
        for rings in polygons:
            if _ring_contains(rings[0], lon, lat) and not any(_ring_contains(hole, lon, lat) for hole in rings[1:]):
                return name, iso3
    return None, None


def assign_countries(points: list) -> None:
    """Fill point['country'] and point['iso3'] in place."""
    for point in points:
        name, iso3 = country_of(point["lat"], point["lon"])
        point["country"] = name
        point["iso3"] = iso3
