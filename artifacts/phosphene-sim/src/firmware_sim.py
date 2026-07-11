import time
from .electrodes import _array, MAX_SAFE_AMPLITUDE, THERMAL_MIN_INTERVAL, GRID
from .packets import StimCommand, parse_packet

def apply_command(cmd: StimCommand) -> dict:
    log = []
    eid = cmd.electrode_id

    if not (0 <= eid < GRID * GRID):
        return {"ok": False, "log": [f"REJECT: electrode_id {eid} out of range"]}

    if cmd.amplitude > MAX_SAFE_AMPLITUDE:
        return {"ok": False, "log": [f"REJECT: amplitude {cmd.amplitude} > MAX {MAX_SAFE_AMPLITUDE}"]}

    now = time.monotonic()
    elapsed = now - _array[eid]["last_t"]
    if _array[eid]["last_t"] > 0 and elapsed < THERMAL_MIN_INTERVAL:
        log.append(f"WARN: thermal — electrode {eid} stimulated too frequently ({elapsed*1000:.1f} ms ago)")

    _array[eid]["amplitude"] = cmd.amplitude
    _array[eid]["last_t"] = now
    log.append(f"CHARGE_BALANCE: electrode {eid} cathodic pulse {cmd.amplitude} µA / {cmd.duration_us} µs → anodic return")
    return {"ok": True, "log": log}

def ascii_grid() -> str:
    rows = []
    for r in range(GRID):
        row = ""
        for c in range(GRID):
            v = _array[r * GRID + c]["amplitude"]
            row += str(min(9, v // 23)) if v > 0 else "."
        rows.append(row)
    return "\n".join(rows)

def simulate_from_streamer(packet: dict) -> dict:
    cmd = parse_packet(packet)
    result = apply_command(cmd)
    result["grid"] = ascii_grid()
    return result

def process_stim_packet(packet: dict) -> dict:
    return simulate_from_streamer(packet)
