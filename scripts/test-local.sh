#!/bin/bash
set -e

echo "=== Starting local Docker environment ==="
docker compose -f docker-compose.local.yml up -d --build

echo "=== Waiting for all services to be healthy ==="
services=("api" "worker" "redis" "supabase-local" "frontend")
for service in "${services[@]}"; do
  echo -n "Waiting for $service..."
  until docker compose -f docker-compose.local.yml ps $service | grep -q "healthy"; do
    sleep 2
    echo -n "."
  done
  echo " ready"
done

echo "=== Running health checks ==="
curl -sf https://api.localhost/health/live   && echo "API live: OK"
curl -sf https://api.localhost/health/ready  && echo "API ready: OK"
curl -sf https://app.localhost               && echo "Frontend: OK"

echo "=== Running integration tests ==="
docker compose -f docker-compose.local.yml exec api npm run test:integration

echo "=== All checks passed ==="
echo ""
echo "Services running at:"
echo "  Frontend:   https://app.localhost"
echo "  API:        https://api.localhost/v1"
echo "  API Docs:   https://api.localhost/docs"
echo "  BullBoard:  http://localhost:3002"
echo ""
echo "To stop: docker compose -f docker-compose.local.yml down"
