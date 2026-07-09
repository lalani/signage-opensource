import os
import json
from pathlib import Path

CONFIG_PATH = Path('/etc/signage/config.json')
CACHE_DIR   = Path.home() / 'signage/cache'
LOG_PATH    = Path.home() / 'signage/agent.log'

def load() -> dict:
    """Load config from /etc/signage/config.json, then override with env vars."""
    cfg = {}
    if CONFIG_PATH.exists():
        cfg = json.loads(CONFIG_PATH.read_text())

    return {
        'server_url':       os.getenv('SIGNAGE_SERVER', cfg.get('server_url', '')),
        'registration_key': os.getenv('SIGNAGE_KEY',    cfg.get('registration_key', '')),
        'agent_version':    '1.2.0',
        'cache_dir':        CACHE_DIR,
        'log_path':         LOG_PATH,
    }
