# PLAN.md — Pulse Chat

Source of truth for where the project stands. Check off completed features, mark WIP, adjust remaining items as scope changes. Update in the same commit as the work it describes.

## Implemented

### API (`apps/api` — Fastify 5 on Bun)
- [x] Better-Auth email/password (cookie + Bearer passthrough), drizzle adapter
- [x] Workspaces: list/create/get/members/add-member/invites/accept-invite
- [x] Channels: list/create/join/members/read-receipt
- [x] Messages: cursor pagination (`before`/`after` ULID), send (nonce idempotency), edit, delete, reactions, thread replies
- [x] Mentions: `mention` table populated on send (workspace-member name/email match); worker consumes records
- [x] DMs: `POST /workspaces/:id/dm` find-or-create (sha1 pair-named `dm-*`, both members auto-added)
- [x] Attachments: presigned PUT (25 MB cap) + presigned GET; send accepts `attachments:[{key,filename,mime,size}]` (persisted for previews)
- [x] Users: me / search; Notifications: list/mark-read/mark-all-read; Search
- [x] Socket.IO + Redis adapter: rooms `channel:<id>` / `user:<id>`, typing, presence, read receipts
- [x] Redis sliding-window rate limiting (global per-IP + per-user route limits)
- [x] BullMQ notifications worker (mention > thread > dm > channel), Mailpit email

### Web (`apps/web` — Next.js 15)
- [x] Landing + chat shell, login/signup
- [x] Workspace rail, channel sidebar, create-channel, invite/add-member panel
- [x] Channel view: infinite scroll, optimistic send, typing, reply/threads, reactions, edit/delete, attachments
- [x] Markdown rendering (react-markdown + GFM) with @mention chip highlighting (mine vs member vs unknown)
- [x] Composer @autocomplete over workspace members (Enter/Tab/click insert)
- [x] DM UI: DIRECT MESSAGES member list w/ presence dots → find-or-create + open; peer-titled sidebar/header
- [x] Inline previews: images rendered (`NEXT_PUBLIC_MINIO_URL`), non-images as filename+size cards
- [x] Notifications dropdown w/ unread badge, presence dots, message search
- [x] Petrol & mint redesign

### Infra
- [x] docker-compose (postgres, redis, minio + bucket creator, mailpit)
- [x] Drizzle migrations (`packages/db/drizzle/`) + idempotent seed

## In progress

### Mobile client (`apps/mobile` — Expo SDK 57, React Native 0.86)
Full chat parity with web; bearer-token auth; push notifications deferred to phase 2.

- [x] Slice 0 — Expo scaffold: expo-router, monorepo Metro config, petrol/mint theme tokens, turbo wiring
- [ ] Slice 1 — Auth flow: login/signup, session token in SecureStore, route guard
- [ ] Slice 2 — API client, typed endpoint helpers, socket singleton (auth via token), zustand store
- [ ] Slice 3 — Workspace switcher + channel list (presence, unread badges)
- [ ] Slice 4 — Channel view: FlashList infinite messages, optimistic send, typing, live socket cache updates
- [ ] Slice 5 — Reactions, edit, delete, thread view
- [ ] Slice 6 — Attachments: pick → presign → PUT → send; viewer via signed URLs
- [ ] Slice 7 — Notifications activity tab (live badge)
- [ ] Slice 8 — Search tab
- [ ] Slice 9 — Docs: AGENTS.md mobile commands/gotchas, DESIGN.md mobile section

## Remaining / next up

- [ ] Push notifications (phase 2): device token registry migration, `POST /api/push/register`, expo-server-sdk delivery in notifications worker, deep links
- [ ] Read-receipt rendering (endpoint + WS event exist, no UI yet)
- [ ] Invite acceptance screen (`/invite/[token]` missing on web; API exists)
- [ ] Search v2 (`tsvector` GIN), OpenSearch, `@ai` bot (Ollama RAG)

## Notes

- Another agent owns `apps/web` changes — keep commits scoped to `apps/mobile` (+ root wiring only when necessary).
- `apps/api` attachment schema refactor landed: send payload is now `attachments:[{key,filename,mime,size}]` (old `attachmentKeys` strings gone). Mobile slice 6 should presign → PUT → send this shape; response message includes full attachment rows for previews.
