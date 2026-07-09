import hashlib
import json
import logging
import requests
from pathlib import Path

log = logging.getLogger('cache')

PLAYLIST_FILE = Path.home() / 'signage/playlist.json'

def ensure_dir(cache_dir: Path):
    cache_dir.mkdir(parents=True, exist_ok=True)

def checksum(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()

def download_file(url: str, dest: Path, expected_checksum: str | None = None) -> bool:
    """Download url to dest. Skip if already present with matching checksum."""
    if dest.exists() and expected_checksum:
        if checksum(dest) == expected_checksum:
            log.info(f'Cache hit: {dest.name}')
            return True

    log.info(f'Downloading: {url} → {dest.name}')
    try:
        with requests.get(url, stream=True, timeout=60) as r:
            r.raise_for_status()
            dest.parent.mkdir(parents=True, exist_ok=True)
            with open(dest, 'wb') as f:
                for chunk in r.iter_content(65536):
                    f.write(chunk)
        return True
    except Exception as e:
        log.error(f'Download failed {url}: {e}')
        return False

def sync_playlist(playlist: dict, cache_dir: Path) -> dict:
    """
    Download all local-file content items in the playlist.
    Returns an updated playlist dict with local file paths substituted in.
    """
    updated = json.loads(json.dumps(playlist))  # deep copy

    for item in updated.get('items', []):
        content = item['content']
        if content.get('fileUrl'):
            filename = content['id'] + '_' + content['fileUrl'].split('/')[-1]
            dest = cache_dir / filename
            ok = download_file(content['fileUrl'], dest, content.get('checksum'))
            if ok:
                content['localPath'] = str(dest)

    # Persist to disk so we can restore on reboot
    PLAYLIST_FILE.parent.mkdir(parents=True, exist_ok=True)
    PLAYLIST_FILE.write_text(json.dumps(updated, indent=2))
    
    # Clean up stale files from local cache
    prune_cache(updated, cache_dir)
    
    log.info(f'Playlist cached: {playlist["name"]} ({len(updated["items"])} items)')
    return updated

def prune_cache(playlist: dict, cache_dir: Path) -> None:
    """
    Remove any files in cache_dir that are NOT referenced in the active playlist.
    This keeps the disk usage under control.
    """
    try:
        referenced_files = set()
        for item in playlist.get('items', []):
            content = item['content']
            if content.get('fileUrl'):
                filename = content['id'] + '_' + content['fileUrl'].split('/')[-1]
                referenced_files.add(filename)
        
        # Scan cache directory and delete unused files
        if cache_dir.exists():
            for p in cache_dir.iterdir():
                if p.is_file() and p.name not in referenced_files:
                    log.info(f'Pruning stale cache file: {p.name}')
                    p.unlink(missing_ok=True)
    except Exception as e:
        log.error(f'Error pruning cache: {e}')

def load_cached_playlist() -> dict | None:
    """Load last-known playlist from disk (used on boot or server disconnect)."""
    if PLAYLIST_FILE.exists():
        try:
            return json.loads(PLAYLIST_FILE.read_text())
        except Exception:
            pass
    return None

def sync_splash(splash_url: str | None) -> bool:
    """
    Download the custom splash image if splash_url is provided.
    If splash_url is None or empty, delete the custom-splash.png.
    Returns True if the splash screen was updated (downloaded or removed).
    """
    SPLASH_FILE = Path.home() / 'signage/custom-splash.png'
    if not splash_url:
        if SPLASH_FILE.exists():
            log.info('Removing custom splash image')
            SPLASH_FILE.unlink(missing_ok=True)
            return True
        return False

    # Download to temporary location first, then compare hash
    temp_file = SPLASH_FILE.parent / 'custom-splash.tmp'
    if temp_file.exists():
        temp_file.unlink(missing_ok=True)

    log.info(f'Checking/downloading splash from {splash_url}')
    try:
        with requests.get(splash_url, stream=True, timeout=60) as r:
            r.raise_for_status()
            SPLASH_FILE.parent.mkdir(parents=True, exist_ok=True)
            with open(temp_file, 'wb') as f:
                for chunk in r.iter_content(65536):
                    f.write(chunk)

        # Compare checksums of temp and current
        if SPLASH_FILE.exists():
            if checksum(temp_file) == checksum(SPLASH_FILE):
                log.info('Splash screen image hash matches. Skipping update.')
                temp_file.unlink(missing_ok=True)
                return False

        # If different, rename temp to dest
        temp_file.replace(SPLASH_FILE)
        log.info(f'New splash screen downloaded to {SPLASH_FILE}')
        return True
    except Exception as e:
        log.error(f'Failed to sync splash from {splash_url}: {e}')
        if temp_file.exists():
            temp_file.unlink(missing_ok=True)

    return False
