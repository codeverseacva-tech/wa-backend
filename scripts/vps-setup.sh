#!/bin/bash
# ================================================================
# Zaplink — VPS First-Time Setup
# Run ONCE on the Contabo VPS as root
# ssh root@your.vps.ip
# bash vps-setup.sh
# ================================================================

set -e

DEPLOY_DIR="/opt/zaplink/backend"
REPO_URL="https://github.com/yourorg/wa-backend.git"

echo "==================================================="
echo "  Zaplink VPS First-Time Setup"
echo "==================================================="

# 1. Install Docker
echo "→ Installing Docker..."
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
echo "✓ Docker installed: $(docker --version)"

# 2. Configure Docker daemon
echo "→ Configuring Docker daemon..."
cat > /etc/docker/daemon.json << 'DOCKEREOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "5"
  }
}
DOCKEREOF
systemctl restart docker
echo "✓ Docker daemon configured"

# 3. Create deploy directory
echo "→ Creating deploy directory..."
mkdir -p $DEPLOY_DIR
cd $DEPLOY_DIR

# 4. Clone the repo
echo "→ Cloning repository..."
git clone $REPO_URL .
echo "✓ Repository cloned"

# 5. Create .env from example
echo "→ Creating .env..."
cp .env.production.example .env
echo ""
echo "⚠  IMPORTANT: Edit .env now with your real values:"
echo "   nano $DEPLOY_DIR/.env"
echo ""
echo "   Required values to fill in:"
echo "   - SUPABASE_URL"
echo "   - SUPABASE_SERVICE_ROLE_KEY"
echo "   - SUPABASE_ANON_KEY"
echo "   - DATABASE_URL"
echo "   - JWT_SECRET (generate: openssl rand -hex 32)"
echo "   - TUMA_API_KEY"
echo "   - SLACK_WEBHOOK_URL"
echo "   - CORS_ALLOWED_ORIGINS (your Vercel frontend URL)"
echo "   - API_BASE_URL (your domain)"
echo "   - FRONTEND_URL (your Vercel URL)"

# 6. UFW firewall
echo "→ Configuring firewall..."
apt-get install -y -qq ufw
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   # SSH
ufw allow 80/tcp   # HTTP  (Caddy)
ufw allow 443/tcp  # HTTPS (Caddy)
ufw --force enable
echo "✓ Firewall configured"

# 7. Add swap (prevents OOM during builds)
echo "→ Adding 2GB swap..."
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "✓ Swap added"
else
  echo "✓ Swap already exists"
fi

# 8. Weekly Docker cleanup cron
echo "→ Adding Docker cleanup cron..."
echo "0 3 * * 0 root docker system prune -f >> /var/log/docker-cleanup.log 2>&1" \
  > /etc/cron.d/docker-cleanup
echo "✓ Cron configured"

echo ""
echo "==================================================="
echo "  ✓ VPS setup complete"
echo ""
echo "  Next steps:"
echo "  1. Edit .env: nano $DEPLOY_DIR/.env"
echo "  2. Add Caddy config: nano /etc/caddy/Caddyfile"
echo "     (append contents of Caddyfile.zaplink)"
echo "  3. Reload Caddy: systemctl reload caddy"
echo "  4. Start the stack: cd $DEPLOY_DIR && docker compose up -d"
echo "  5. Check health: curl https://api.yourdomain.com/health/live"
echo "==================================================="