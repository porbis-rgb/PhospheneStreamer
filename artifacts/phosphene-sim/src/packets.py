from dataclasses import dataclass
import json

@dataclass
class StimCommand:
    electrode_id: int
    amplitude: int
    duration_us: int

def parse_packet(packet: dict | str) -> StimCommand:
    if isinstance(packet, str):
        packet = json.loads(packet)
    return StimCommand(
        electrode_id=int(packet["electrode_id"]),
        amplitude=int(packet["amplitude"]),
        duration_us=int(packet["duration_us"]),
    )
