import time

GRID = 8
MAX_SAFE_AMPLITUDE = 200
THERMAL_MIN_INTERVAL = 0.05  # seconds

_array = {i: {"amplitude": 0, "last_t": 0.0} for i in range(GRID * GRID)}

def get_array():
    return _array

def reset_array():
    for v in _array.values():
        v["amplitude"] = 0
        v["last_t"] = 0.0
