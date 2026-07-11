from .electrodes import reset_array
from .firmware_sim import simulate_from_streamer, ascii_grid

SAMPLES = [
    {"electrode_id": 0,  "amplitude": 120, "duration_us": 400},
    {"electrode_id": 9,  "amplitude": 180, "duration_us": 400},
    {"electrode_id": 18, "amplitude": 250, "duration_us": 400},  # over limit
    {"electrode_id": 27, "amplitude": 90,  "duration_us": 400},
    {"electrode_id": 63, "amplitude": 60,  "duration_us": 200},
]

if __name__ == "__main__":
    reset_array()
    for pkt in SAMPLES:
        result = simulate_from_streamer(pkt)
        for line in result["log"]:
            print(line)
    print("\nElectrode grid (0=off, 9=max):")
    print(ascii_grid())
