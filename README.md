# Pulse — Team Chat Platform

Slack + Discord inspired team chat, built as a medium-scale distributed systems project.

**Stack:** Next.js 15 (App Router) + Fastify (Bun) + PostgreSQL + Redis + MinIO (S3) + Socket.IO + Drizzle + Better-Auth + TanStack Query + Zustand + Turbo + Bun.

## Architecture

```
Browser (Next.js) ── HTTP + WebSocket ──► Fastify API (Bun) ──┬──► Postgres (Drizzle)
                                                              ├──► Redis (Pub/Sub, Presence, Rate-limit)
                                                              └──► MinIO (presigned S3)
                                         ▲
                                    Socket.IO + Redis Adapter (3-server fanout)
```

- **Split apps:** `apps/web` (Next.js) and `apps/api` (Fastify on Bun) — independent scaling, per your pick B split.
- **Monorepo:** `bun workspaces` + `turbo` (`turbo.json`).
- **IDs:** ULIDs (time-ordered, lex. sortable, cursor pagination via `before=<ulid>`).
- **Realtime:** Socket.IO rooms `channel:<id>` + Redis Pub/Sub `chat:events` → any server can broadcast to users on another server.
- **Storage:** MinIO S3-compatible, presigned PUT/GET (`@aws-sdk/client-s3`).

## Quick start

```bash
# 1. infra
docker compose up -d          # postgres:5432, redis:6379, minio:9000/9001, mailpit:8025

# 2. install
bun install

# 3. db
bun run db:push --filter=db   # or: bunx drizzle-kit push --config=packages/db/drizzle.config.ts

# 4. dev (both)
bun run dev                   # turbo runs web:3000 + api:3001
# or separately:
bun run dev:web
bun run dev:api
```

Open http://localhost:3000 → create account at `/login` → create workspace → channels `general`/`random` auto-created → send messages → open second browser to see realtime sync.

MinIO console: http://localhost:9001 (minioadmin / minioadmin123), bucket `chat-attachments` auto-created.

## Env

See `.env.example`. Key vars:

- `DATABASE_URL=postgresql://chat:chat@localhost:5432/chat`
- `REDIS_URL=redis://localhost:6379`
- `S3_ENDPOINT=http://localhost:9000`, `S3_BUCKET=chat-attachments`
- `BETTER_AUTH_SECRET` (≥32 chars), `BETTER_AUTH_URL=http://localhost:3001`
- `NEXT_PUBLIC_API_URL=http://localhost:3001`, `NEXT_PUBLIC_WS_URL=http://localhost:3001`

`apps/web/.env.local` and `apps/api/.env` are copies of root `.env`.

## API (Fastify :3001)

- `POST /api/auth/*` — Better-Auth (sign-up, sign-in, sign-out, session)
- `GET /api/users/me`, `GET /api/users/search?q=`
- `GET/POST /api/workspaces`, `GET /api/workspaces/:id/members`, `POST /api/workspaces/:id/invites`, `POST /api/invites/:token/accept`
- `GET /api/workspaces/:wsId/channels`, `POST /api/workspaces/:wsId/channels`, `POST /api/channels/:id/join`, `GET /api/channels/:id/members`
- `GET /api/channels/:id/messages?before=&after=&limit=50` (cursor), `POST /api/channels/:id/messages`, `PATCH/DELETE /api/messages/:id`, `GET /api/messages/:id/replies`, `POST/DELETE /api/messages/:id/reactions`
- `POST /api/attachments/presign` → `{url, key}` (PUT directly to MinIO), `GET /api/attachments/:key/signed`
- `GET /api/search?q=&channelId=`
- `GET /health`, `WS /socket.io` (events: `message:new`, `message:updated/deleted`, `typing:update`, `presence:update`, `reaction:update`, `read:receipt`)

## DB schema (Drizzle, `packages/db/src/schema.ts`)

`user`, `session`, `account` (issuer added for better-auth compat), `verification`, `workspace`, `workspaceMember`, `channel`, `channelMember`, `message` (ULID PK, `parentId` for threads, `nonce` idempotency), `attachment`, `reaction`, `invite`.

Push with `drizzle-kit push` (no migrate files checked in for speed; add `drizzle-kit generate` for migrations).

## Web UI (`apps/web`)

- Landing with live preview + `AppShell` (workspace rail, channel sidebar, `ChannelView`).
- Auth at `/login` (email/password via Better-Auth, Suspense-wrapped `useSearchParams`).
- Channels: public/private/dm/group, auto-join on send for public.
- Messages: ULID cursor pagination (reverse infinite), edit/delete own, reactions, threads via `parentId`, attachments via MinIO presign, typing indicators (Socket.IO + Redis TTL), presence.
- Design: Tailwind v4, dark sidebar (#0f0f12 / #1a1a1e), violet accent, rounded-2xl, Linear/Slack taste.

## Phases (per spec)

1. **Foundation** ✓ — Auth, workspaces, channels, messages, Drizzle, UI.
2. **Realtime** ✓ — Socket.IO + Redis adapter, typing, presence, read receipts.
3. **Serious messaging** ✓ — Threads, reactions, edit/delete, nonce, cursor pagination, search (ilike MVP, tsvector ready).
4. **Backend arch** ✓ — Redis Pub/Sub, BullMQ-ready (queue slot), rate-limit hook, retry via nonce.
5. **Scale** — Run 3× api behind Nginx `ip_hash`, test 1k msg/s, reconnect, duplicate, out-of-order (ULID solves).
6. **AI bot** — Placeholder: add `is_bot` user, `@ai` → RAG over messages → Ollama.

## Testing ideas

- `curl /api/channels/:id/messages?before=<ulid>&limit=50` → check `nextCursor`.
- Two browsers → type → see typing, send → instant fanout via Redis.
- Kill one api replica, messages still arrive via other replica's Redis sub.
- Upload file → presign → PUT to MinIO:9000 → message attachment.

## Scripts

```bash
bun run build          # turbo build web+api
bun run typecheck
bun run lint
```

See `DESIGN.md` and `AGENTS.md` for deeper notes.
