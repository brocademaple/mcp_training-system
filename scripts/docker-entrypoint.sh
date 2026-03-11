#!/bin/sh
# Wait for PostgreSQL to be ready (for docker-compose up)
if [ -n "$DB_HOST" ]; then
  echo "Waiting for PostgreSQL at $DB_HOST:${DB_PORT:-5432}..."
  python3 -c "
import os, socket, time
host, port = os.environ.get('DB_HOST'), int(os.environ.get('DB_PORT', '5432'))
while True:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(2)
        s.connect((host, port))
        s.close()
        break
    except Exception:
        time.sleep(1)
"
  echo "PostgreSQL is up."
fi
exec "$@"
