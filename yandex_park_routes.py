"""Universal Yandex Maps URLs: no API key and no app-specific URI scheme.

Routes use coordinates in latitude,longitude order; search uses the park name/address.
All stored coordinates are treated as *waypoints*, not necessarily confirmed entrances.
"""
import math
from urllib.parse import quote


def yandex_route_url(lat, lon):
    """Driving route from the visitor's current location to a coordinate waypoint."""
    if lat is None or lon is None:
        return ''
    try:
        y, x = float(lat), float(lon)
    except (TypeError, ValueError):
        return ''
    if not math.isfinite(y) or not math.isfinite(x) or not (-90 <= y <= 90 and -180 <= x <= 180):
        return ''
    # Yandex route URL uses latitude, longitude (unlike marker URLs).
    coords = f'{y:.7f},{x:.7f}'
    return 'https://yandex.ru/maps/?rtext=~' + quote(coords, safe='') + '&rtt=auto'


def yandex_search_url(name, address):
    """Universal cross-platform fallback for unknown/approximate entry coordinates."""
    text = ', '.join(part for part in (str(name or '').strip(), str(address or '').strip()) if part)
    return 'https://yandex.ru/maps/?text=' + quote(text, safe='')


def precise_entrance(accuracy):
    """Only an explicitly verified entrance is reliable for blind navigation."""
    normalized = ' '.join(str(accuracy or '').lower().replace('ё', 'е').split())
    return normalized in (
        'точка въезда подтверждена',
        'подтвержденные координаты въезда',
        'проверенные координаты въезда',
    )


def park_yandex_links(park):
    """Park can be sqlite3.Row or dict; values must not be persisted in public JS."""
    return {
        'route_url': yandex_route_url(park['lat'], park['lon']),
        'search_url': yandex_search_url(park['name'], park['address']),
        'entrance_confirmed': precise_entrance(park['accuracy']),
    }
