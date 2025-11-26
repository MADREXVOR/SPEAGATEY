
import math

def haversine_miles(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Return distance in miles between two lat/lon points."""
    # convert decimal degrees to radians
    lon1, lat1, lon2, lat2 = map(math.radians, [lon1, lat1, lon2, lat2])
    # haversine formula
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    c = 2 * math.asin(math.sqrt(a))
    r = 3958.8  # Radius of earth in miles
    return c * r
