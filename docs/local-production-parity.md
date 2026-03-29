# Local-Production Parity

This document outlines the differences between the local Docker testing environment and the production environment on the Contabo VPS.

| Concern | Local | Production |
|---------|-------|------------|
| TLS | Caddy local CA (self-signed, *.localhost) | Caddy Let's Encrypt (api.zaplink.co.ke) |
| Database | `supabase/postgres:15.1.0.117` Docker image | Supabase Cloud (Managed) |
| Frontend | Next.js dev server in Docker (port 3001) | Vercel (Cloud) |
| Secrets | `.env.local` file (gitignored) | Docker secrets / VPS Environment variables |
| M-Pesa | Tuma Sandbox / Mock | Tuma Production |
| Slack Alerts | Test Webhook URL | Real Production Webhook URL |
| Log Output | Pretty-printed (pino-pretty) | Structured JSON (Pino) |
| OTLP Traces | Disabled (no collector container) | Enabled (sending to Honeycomb/Grafana) |
| Hot Reload | Enabled (src volume mount) | Disabled (Built dist files) |
| Seed Data | Automatically seeded (migrations) | Manual seeding or production data |

## Flagged Parity Gaps

- **Postgres Version**: ⚠ Ensure the `supabase/postgres` image version matches the Supabase Cloud version as closely as possible to avoid SQL syntax issues.
- **Frontend Environment**: ⚠ Vercel's edge runtime and middleware may behave differently than the Next.js dev server in Docker. Integration tests primarily target the API.
- **Worker Isolation**: ⚠ Locally, the worker runs in the same bridge network as the API. In production, ensure no networking conflicts if they are on different hosts or networks.
