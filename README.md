# Zaplink Backend API

This repository contains the Node.js/TypeScript backend for the Zaplink WhatsApp automation platform.

## Architecture
- **Language**: TypeScript
- **Runtime**: Node.js v20+
- **Database**: Supabase (PostgreSQL)
- **Message Queues**: BullMQ with Redis
- **WhatsApp Engine**: Baileys
- **Observability**: OpenTelemetry + Prometheus + Pino Logging

## Development
```bash
npm install
npm run dev
```

## Connecting the frontend
The frontend (separate repo, deployed on Vercel) connects to this API via:
`NEXT_PUBLIC_API_URL=https://api.yourdomain.com/v1`

To generate TypeScript types from the API spec:
```bash
npx openapi-typescript https://api.yourdomain.com/docs/spec -o types/api.d.ts
```

The frontend never runs inside Docker. Vercel handles its own build and deploy.
CORS is pre-configured to allow requests from `FRONTEND_URL` env var.

## CI/CD
GitHub Actions are configured in `.github/workflows/deploy.yml` for automated testing, Docker builds, and deployment to the VPS.
Required secrets:
- `VPS_SSH_KEY`
- `SLACK_WEBHOOK_URL`
- `GHCR_TOKEN`
- `VPS_HOST`
- `VPS_USER`

## Local development

### Prerequisites
- Docker Desktop running
- Cloud Supabase dev project credentials in .env.local
- Daraja sandbox credentials in .env.local

### Start the stack
```bash
docker compose -f docker-compose.local.yml up -d --build
```

### Services
- **API**: [http://localhost:3000/v1](http://localhost:3000/v1)
- **API Docs**: [http://localhost:3000/docs](http://localhost:3000/docs)
- **BullBoard**: [http://localhost:3002](http://localhost:3002)
- **Redis**: localhost:6380 (Host access), redis:6379 (Internal)

### Run integration tests
```bash
docker compose -f docker-compose.local.yml exec api \
  npm run test:integration
```

### Stop and clean up
```bash
docker compose -f docker-compose.local.yml down -v
```

### Reset test data in Supabase dev project
```sql
-- Run in Supabase dashboard SQL editor
TRUNCATE public.whatsapp_sessions CASCADE;
TRUNCATE public.messages CASCADE;
TRUNCATE public.api_keys CASCADE;
TRUNCATE public.invoices CASCADE;
TRUNCATE public.bulk_campaigns CASCADE;
TRUNCATE public.scheduled_messages CASCADE;
-- Do NOT truncate: profiles, plans (seed data)
```

### Environment variables
Copy `.env.local.example` to `.env.local` and fill in values.
Never commit `.env.local` to git.
Never use production credentials in `.env.local`.
