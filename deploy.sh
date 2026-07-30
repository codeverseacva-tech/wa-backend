#!/bin/bash
# ================================================================
# Zaplink — Production Deploy Script
# Run by GitHub Actions on the VPS directly
# ================================================================
set -e

VPS_DIR="/opt/zaplink/backend"
SLACK_WEBHOOK="${SLACK_WEBHOOK_URL:-}"
GIT_BRANCH="main"
GIT_SHA=${1:-$(git rev-parse --short HEAD)}

START_TIME=$(date +%s)

echo "==================================================="
echo "  Zaplink Production Deploy"
echo "  Branch: $GIT_BRANCH | SHA: $GIT_SHA"
echo "==================================================="

send_slack() {
  local level=$1
  local message=$2
  if [ -n "$SLACK_WEBHOOK" ]; then
    curl -s -X POST "$SLACK_WEBHOOK" \
      -H 'Content-type: application/json' \
      --data "{\"text\":\"$level Zaplink Deploy: $message (sha: $GIT_SHA)\"}" \
      > /dev/null
  fi
}

send_slack "🚀" "Starting deploy from branch $GIT_BRANCH"

cd $VPS_DIR

echo "→ Backing up session state before deploy..."
docker compose exec -T api node dist/scripts/backup-session-state.js > /tmp/backup_output.txt 2>&1 || {
  cat /tmp/backup_output.txt
  echo "✗ Backup failed, aborting deploy."
  exit 1
}
cat /tmp/backup_output.txt
BACKUP_FILE=$(grep -oE 'backup-[a-zA-Z0-9_-]+\.json' /tmp/backup_output.txt | head -n 1 || true)
if [ -n "$BACKUP_FILE" ]; then
  send_slack "💾" "Backed up to $BACKUP_FILE"
fi

echo "→ Pulling latest code..."
git fetch origin $GIT_BRANCH
git reset --hard origin/$GIT_BRANCH

echo "→ Building new images..."
docker compose build --no-cache api worker

echo "→ Deploying api and worker (redis and bullboard kept running)..."
docker compose up -d --no-deps api worker

echo "→ Waiting for API to be healthy..."
MAX_RETRIES=30
COUNT=0
until docker compose exec -T api node -e \
  "require('http').get('http://localhost:3000/health/live', r => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))" \
  2>/dev/null; do
  COUNT=$((COUNT + 1))
  if [ $COUNT -ge $MAX_RETRIES ]; then
    echo "✗ Health check failed after $MAX_RETRIES attempts"
    docker compose logs api --tail=50
    exit 1
  fi
  echo "  Waiting... ($COUNT/$MAX_RETRIES)"
  sleep 2
done

echo "✓ API is healthy"

echo "→ Cleaning up old Docker images..."
docker image prune -f

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo "==================================================="
echo "  ✓ Deploy complete in ${DURATION}s"
echo "  SHA: $GIT_SHA"
echo "==================================================="

send_slack "✅" "Deploy complete in ${DURATION}s"
