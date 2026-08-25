# PLAN.md — Pulse roadmap status

Source of truth for where the project stands. Update in the same commit as the work it describes.

## Scope

Team chat platform ("Slack + Discord, smaller"): Next.js web + Fastify-on-Bun API, Postgres/Drizzle, Redis pub/sub, Socket.IO fanout, MinIO attachments, BullMQ workers, notifications, search, AI bot.

## Done

- [x] **Phase 1 — Foundation**: monorepo (Turbo+Bun), Better-Auth (email/password), workspaces/roles, channels (public/private/dm/group), messages CRUD, ULID cursor pagination, MinIO presigned uploads, docker compose infra (postgres/redis/minio/mailpit), drizzle migrations (`packages/db/drizzle/*.sql`) + idempotent seed (`bun run db:seed` → alice/bob/carol @pulse.dev, ws `acme`).
- [x] **Phase 2 — Realtime**: Socket.IO + Redis adapter, room join/leave (reconnect-safe), typing indicators, presence, read receipts.
- [x] **Phase 3 — Serious messaging**: threads (`parentId`), reactions, edit/delete (soft tombstone), mentions parsing (worker-side), attachments flow, search (ilike MVP).
- [x] **Phase 4a — Notifications**: BullMQ queue `notifications`, worker (concurrency 5, retries/backoff), priority mention > thread > dm > channel, prefs `all|mentions|nothing`, Mailpit email, in-app bell UI + `notification:new` socket relay.
- [x] **UI redesign**: petrol & mint palette, all styling via `globals.css :root` tokens (see DESIGN.md); auth-aware hero/header; input contrast fixes.
- [x] **Bugfixes**: instant message display (optimistic append + dedupe), add-member-by-name/email endpoint + panel, sign-out empty body 400.

## In progress

(none)

## Just shipped

- [x] **Phase 4b — Rate limiting**: Redis sliding-window (Lua ZSET) `lib/rateLimit.ts`; global per-IP 600/min on `/api/*` (auth excluded); per-user: msg-send 10/10s, react 30/min, presign 20/min, search 60/min; 429 + `X-RateLimit-*`/`Retry-After` headers. Verified on isolated instance (`200,200,200,429…`). **Note: restart the running dev API to load it** (`bun run dev` — bun watch may not pick up new files on Windows).

## Remaining

- [ ] **Search v2**: Postgres `tsvector` GIN index + trigger (or OpenSearch container later).
- [ ] **Phase 5 — Scale**: 3× api replicas behind Nginx (`ip_hash`), k6 load tests (1k msg/s, 10k sockets), chaos drills (kill redis/pg/api, reconnect sync, duplicates/out-of-order).
- [ ] **Phase 6 — AI bot**: `@ai` workspace member, RAG over messages, Ollama backend, thread summarize.
- [ ] DM/group channel UI (backend types ready).
- [ ] Read-receipt UI polish + unread badges from `last_read_message_id`.

## Verify before commit

```bash
bun run typecheck && bun run build
docker compose up -d        # infra needed by api
```
