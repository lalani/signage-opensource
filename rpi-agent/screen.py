import subprocess
import re

def get_resolution() -> tuple[int, int]:
    """Return (width, height) of the primary display via xrandr."""
    try:
        out = subprocess.check_output(['xrandr', '--current'], stderr=subprocess.DEVNULL).decode()
        for line in out.splitlines():
            if ' connected' in line:
                m = re.search(r'(\d+)x(\d+)\+', line)
                if m:
                    return int(m.group(1)), int(m.group(2))
    except Exception:
        pass
    return 1920, 1080  # Safe fallback
