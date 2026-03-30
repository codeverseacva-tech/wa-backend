# Zaplink Internal Roadmap & Gaps (v2 Backlog)

This document outlines the known architectural and functional gaps identified in the Zaplink v1 codebase. These should be prioritized for the upcoming v2 release.

---

## 1. Missing Resource Endpoints

The current API lacks several standard CRUD operations that are essential for deep integrations and full transparency of resources.

| Gap | Missing Endpoint | Why It Matters | Status |
| :--- | :--- | :--- | :--- |
| **Session Metadata** | `GET /v1/sessions/:id` | Users currently cannot fetch details of a specific session without listing all. | ✅ **Resolved** |
| **Webhook Inspection** | `GET /v1/webhooks/:id` | No way to inspect a single webhook configuration. | ✅ **Resolved** |
| **API Key Inspection** | `GET /v1/api-keys/:id` | No way to inspect a single API key properties. | 🚧 **Pending** |
| **Session Status Pulse** | `GET /v1/sessions/:id/status` | Polling for status is more common for webhooks/scripts than using SSE. | ✅ **Resolved** |

---

## 2. Webhook Testing Scope Issue

The `POST /v1/webhooks/:id/test` endpoint currently dispatches a test event to **every active webhook** owned by the user, rather than targeting only the specified ID.

*   **Impact:** Confusing for users with multiple endpoints as they see test events everywhere.
*   **Fix:** ✅ **Resolved** — `POST /v1/webhooks/:id/test` now uses `webhookService.dispatchToWebhook` to target only the specified webhook.

---

## 3. Authentication & User Context Gaps

*   **API Key Context:** The `apiKeyMiddleware` does not populate the `email` field in `req.user`. This causes failures in downstream routes (like billing or audit logging) that expect `req.user.email`.
    *   **Fix:** Update `apiKeyMiddleware.ts` to join with the `profiles` or `users` table to fetch and set the email address.
*   **IP Whitelist Validation:** While `apiKeyMiddleware` enforces whitelists, the `POST /v1/api-keys` endpoint does not validate if the provided strings are valid CIDR blocks or IPs.
    *   **Fix:** Add specialized Zod validation to `apiKeySchema` using `ipaddr.js` logic.

---

## 4. Messaging Payload Gaps

*   **Normalised Sender ID:** The `from` field in the message payload frequently uses the WhatsApp **LID** format (e.g., `12345@lid`). While technically correct, most developers expect a standard phone number JID.
    *   **Impact:** Difficult for developers to map incoming messages to their existing CRM/User records.
    *   **Fix:** ✅ **Resolved** — `sessionManager.ts` now uses `resolveFromJid` to promote `remoteJidAlt` to the top-level `from` field. `fromLid` is provided as a secondary field.

---

## 5. Missing Core Features

*   **Pagination:** Neither the sessions list (`GET /sessions`) nor the API keys list supports pagination. As users scale, these lists will become bulky and slow.
    *   **Fix:** ✅ **Resolved** — Integrated `.range()` into `GET /sessions`, `GET /api-keys`, and `GET /webhooks/logs`.
*   **Granular Webhook Filtering:** Webhooks are currently filtered by the client service, but the fan-out logic is basic. There's no per-endpoint filtering logic for specific groups or conditions.
*   **API Key Expiry Enforcement:** ✅ **Resolved** — `expires_at` added to `apiKeySchema` and persisted in the database.
*   **API Key Rate Limiting:** Although `req.user.rateLimit` is populated, the `rateLimitMiddleware` uses global defaults for many cases. Ensure the DB-provided `rate_limit` field is always prioritized and correctly enforced in Redis.

---

## 6. Operational & Observability Gaps

*   **DLQ Inspection:** Webhook deliveries can fail permanently, but there's no endpoint to inspect the BullMQ Dead Letter Queue (failed jobs) specifically for a user's webhooks.
    *   **Fix:** Add `GET /v1/webhooks/logs/failed` with options to view stack traces from the worker.
*   **Retry-on-Demand:** Once a webhook fails 5 times, it is marked as dead. There is no automated or manual way to "Retry Now" for a specific log entry.
    *   **Fix:** Implement `POST /webhooks/logs/:logId/retry` to re-enqueue the job.
*   **Slack Alert Verification:** ✅ **Resolved** — `src/tests/unit/slack.test.ts` now covers all 17 alert scenarios across every call site. Run with `npm run test:unit`.

---

## 7. Unsupported Message Types

While the core messaging engine is functional, several capabilities supported by the underlying Baileys library are not yet exposed via the REST API.

| Missing Capability | Why It Matters | Suggested Implementation |
| :--- | :--- | :--- |
| **Replies (Quoted Messages)** | Users cannot contextually reply to a specific previous message. | Update `SendMessagePayload` to include `quoted_id`. In `MessageService`, fetch the message context and pass it as `quoted: msg` to `socket.sendMessage`. |
| **Multi-Contact Cards** | Only single contacts can be sent; multiple contacts or contact lists are unsupported. | Update `type: 'contact'` to support an array of contact objects and use the `contacts` key in Baileys. |
| **Interactive Buttons / Lists** | WhatsApp interactive messages (buttons, lists) are missing. | Define structured schemas for buttons and list rows; map them to `buttonsMessage` or `listMessage` in Baileys. |
| **Newsletter Admin** | No API for creating or managing WhatsApp Newsletters. | Implement specialized endpoints for Newsletter management (if supported by currently used Baileys version). |
| **Message Editing** | No endpoint to edit a previously sent message. | Use `socket.sendMessage(jid, { edit: key, text: 'new text' })` in a new PATCH route. |
| **Message Deletion (Revoke)** | No endpoint to delete/revoke a message for everyone. | Use `socket.sendMessage(jid, { delete: key })` in a new DELETE route. |
