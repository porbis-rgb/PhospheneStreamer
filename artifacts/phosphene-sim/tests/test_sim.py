import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from src.electrodes import _array, reset_array, MAX_SAFE_AMPLITUDE
from src.packets import parse_packet, StimCommand
from src.firmware_sim import apply_command

def test_reject_unsafe_amplitude():
    reset_array()
    cmd = StimCommand(electrode_id=0, amplitude=MAX_SAFE_AMPLITUDE + 1, duration_us=400)
    result = apply_command(cmd)
    assert result["ok"] is False
    assert any("REJECT" in l for l in result["log"])

def test_packet_parsing():
    pkt = {"electrode_id": 5, "amplitude": 100, "duration_us": 300}
    cmd = parse_packet(pkt)
    assert isinstance(cmd, StimCommand)
    assert cmd.electrode_id == 5
    assert cmd.amplitude == 100
    assert cmd.duration_us == 300

def test_electrode_state_updates():
    reset_array()
    cmd = StimCommand(electrode_id=3, amplitude=80, duration_us=400)
    result = apply_command(cmd)
    assert result["ok"] is True
    assert _array[3]["amplitude"] == 80
    assert _array[3]["last_t"] > 0
