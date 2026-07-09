#!/bin/bash
# Open Source Signage — Automated Backup Script
# Backs up the PostgreSQL database and the media files Docker volume.

set -e

# Configuration
BACKUP_DIR="/home/ubuntu/signage_backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/signage_backup_$TIMESTAMP.tar.gz"
TEMP_DIR="/tmp/signage_backup_$TIMESTAMP"

echo "=== Starting Open Source Signage Backup ==="
echo "Timestamp: $TIMESTAMP"

# Create directories
mkdir -p "$BACKUP_DIR"
mkdir -p "$TEMP_DIR"

# Navigate to the compose directory
cd "/home/ubuntu/signage/signage"

# 1. Backup PostgreSQL Database
echo "[1/4] Dumping PostgreSQL database..."
docker compose exec -T postgres pg_dump -U signage -d signage > "$TEMP_DIR/db_dump.sql"

# 2. Backup Media files using a helper container (bulletproof volume backup)
echo "[2/4] Archiving media files volume..."
docker run --rm --volumes-from signage-server-1 -v "$TEMP_DIR:/backup" alpine tar -czf /backup/media.tar.gz -C / media

# 3. Compress everything into the final backup archive
echo "[3/4] Creating final compressed archive..."
tar -czf "$BACKUP_FILE" -C "$TEMP_DIR" db_dump.sql media.tar.gz

# 4. Clean up temporary files
echo "[4/4] Cleaning up temporary files..."
rm -rf "$TEMP_DIR"

# 5. Prune old backups (keep last 7 days)
echo "Pruning backups older than 7 days..."
find "$BACKUP_DIR" -name "signage_backup_*.tar.gz" -mtime +7 -delete

echo "=== Backup Completed Successfully ==="
echo "Backup file: $BACKUP_FILE"
echo "====================================="
