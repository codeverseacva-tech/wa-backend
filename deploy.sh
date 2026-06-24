#!/bin/bash
# ================================================================
# Zaplink — Production Deploy Script
# Run from your LOCAL machine: bash deploy.sh
# Prerequisites: SSH key configured for VPS access
# ================================================================

set -e

# ── Config — edit these ─────────────────────────────────────────
VPS_USER="root"
VPS_HOST="185.185.80.178"
VPS_DIR="/opt/zaplink/backend"
SLACK_WEBHOOK="${SLACK_WEBHOOK_URL:-}"
GIT_BRANCH="main"
# ────────────────────────────────────────────────────────────────

START_TIME=$(date +%s)
GIT_SHA=$(git rev-parse --short HEAD)

echo "==================================================="
echo "  Zaplink Production Deploy"
echo "  Branch: $GIT_BRANCH | SHA: $GIT_SHA"
echo "==================================================="

# Send Slack deploy start notification
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

echo ""
echo "→ Connecting to VPS and deploying..."
ssh "$VPS_USER@$VPS_HOST" bash << EOF
  set -e
  cd $VPS_DIR

  echo "→ Pulling latest code..."
  git fetch origin $GIT_BRANCH
  git reset --hard origin/$GIT_BRANCH

  echo "→ Building new image..."
  docker compose build --no-cache api worker

  echo "→ Stopping old containers..."
  docker compose down --remove-orphans

  echo "→ Starting new containers..."
  docker compose up -d

  echo "→ Waiting for API to be healthy..."
  MAX_RETRIES=30
  COUNT=0
  until docker compose exec -T api node -e \
    "require('http').get('http://localhost:3000/health/live', r => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))" \
    2>/dev/null; do
    COUNT=\$((COUNT + 1))
    if [ \$COUNT -ge \$MAX_RETRIES ]; then
      echo "✗ Health check failed after \$MAX_RETRIES attempts"
      docker compose logs api --tail=50
      exit 1
    fi
    echo "  Waiting... (\$COUNT/\$MAX_RETRIES)"
    sleep 2
  done

  echo "✓ API is healthy"

  echo "→ Cleaning up old Docker images..."
  docker image prune -f
EOF

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo "==================================================="
echo "  ✓ Deploy complete in ${DURATION}s"
echo "  SHA: $GIT_SHA"
echo "==================================================="

send_slack "✅" "Deploy complete in ${DURATION}s — api.yourdomain.com"