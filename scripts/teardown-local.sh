#!/bin/bash
echo "=== Tearing down local environment ==="
docker compose -f docker-compose.local.yml down -v
echo "=== Volumes removed ==="
echo "=== Local environment clean ==="
