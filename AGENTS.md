# AGENTS.md — AI Assistant Guide

This repo is a Turborepo + Bun monorepo. Read before editing.

## Stack

- **PM:** Bun (`bun install`, `bun run`, `bunx`). Do not use npm/yarn/pnpm.
- **Web:** `apps/web` — Next.js 15 App Router, Tailwind v4, shadcn-like UI, TanStack Query, Zustand, socket.io-client.
- **Mobile:** `apps/mobile` — Expo SDK 57 (React Native 0.86), expo-router, TanStack Query, Zustand, socket.io-client, expo-secure-store. Bearer-token auth (`Authorization: Bearer <session token>` + socket `auth:{token}`).
- **API:** `apps/api` — Fastify 5 on Bun, Better-Auth, Drizzle + postgres-js, ioredis, Socket.IO + Redis Adapter, @aws-sdk/client-s3 (MinIO).
- **DB:** `packages/db` — Drizzle ORM, `postgres:16-alpine`, `drizzle-kit push`.
- **Shared:** `packages/shared` — zod schemas, ULID helpers, utils.
- **Infra:** `docker-compose.yml` (postgres, redis, minio + mc bucket creator, mailpit).

## Commands

```bash
bun install
bun run dev              # turbo dev (web+api)
bun run dev:web          # web only :3000
bun run dev:api          # api only :3001 (needs docker up)
bun run dev:mobile       # expo dev server (apps/mobile; needs api running)
docker compose up -d
bun run db:push --filter=db
bun run db:seed          # idempotent demo data (alice/bob/carol @pulse.dev, ws 'acme')
bun run build
bun run typecheck        # mobile included via its own tsc task
```

## Migrations

- Dev: `drizzle-kit push` is fine.
- Schema changes MUST also generate SQL: `bunx drizzle-kit generate` in `packages/db` → commit the file in `packages/db/drizzle/`.
- Prod/fresh envs: `bun run db:migrate` applies `packages/db/drizzle/*.sql` in order.

## Env

Root `.env` is source; `apps/web/.env.local` and `apps/api/.env` are copies. Required: `DATABASE_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET` (32+ chars), `S3_ENDPOINT`, etc. See `.env.example`.

## Conventions

- Use `ulid` for IDs (time-ordered, cursor pagination `before=<ulid>`).
- Validate with `zod` from `@chat/shared/schemas`.
- Auth: `app.getSessionUser(req)` → Better-Auth via `auth.api.getSession({ headers })`. Web `api.ts` uses `credentials: "include"`.
- Realtime: Socket.IO rooms `channel:<id>`, events via `redis.publish("chat:events", JSON.stringify({type, ...}))`, `socket.ts` subscribes.
- S3: presigned PUT (`presignPut`) → client PUT to MinIO → `attachmentKeys` in message.
- Cursor pagination: `GET /api/channels/:id/messages?before=<cursor>&limit=50` → `WHERE id < before ORDER BY id DESC LIMIT 51`.
- Typecheck: `apps/api` has no `rootDir` restriction; `skipLibCheck:true`. Fix drizzle `inArray` casts with `as string[]`.

## Commits (required)

Agents MUST commit regularly — after every completed unit of work. Do not leave many features uncommitted.

- **Format:** Conventional Commits — `type(scope): summary`. Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `perf`, `test`. Scopes: `api`, `web`, `db`, `shared`, `infra`, `agents`.
  - Examples: `feat(api): bullmq notification worker`, `fix(web): sign-out empty body 400`, `chore(infra): add mailpit to compose`.
- **Cadence:** one commit per logical unit (feature, bugfix, migration batch, doc change). Never mix a feature + unrelated reformat in one commit.
- **Verify first:** `bun run typecheck && bun run build` must pass before committing.
- **Stage deliberately:** `git add <paths>`; never blanket `git add .` when unrelated dirty files exist.
- **Secrets:** never commit `.env*`, keys, tokens. They are gitignored — keep it that way.
- **Migrations:** schema changes get their own `feat(db):` or `chore(db):` commit including generated SQL in `packages/db/drizzle/`.

## Gotchas

- AI dev testing: LM Studio via `lms server start` (:1234, OpenAI-compatible `/v1`). Seed users alice/bob/carol @pulse.dev / password123. Empty-body POST/DELETE need `{}` body (Fastify `FST_ERR_CTP_EMPTY_JSON_BODY`) — same as sign-out fix.

- Better-Auth drizzle schema requires `account.issuer` (nullable text). Added.
- Next.js `useSearchParams` must be in `Suspense` (login page).
- `apps/web/.git` must not exist (embedded repo breaks turbo root). Root `.git` is source.
- Bun loads `.env` from cwd; `apps/api` needs its own `.env` copy.
- Redis adapter needs `maxRetriesPerRequest: null` and `.duplicate()` for sub.
- UI uses petrol/mint tokens from `globals.css :root` (see DESIGN.md); sidebar `--sidebar`/`--sidebar-muted`; accent scale `--accent-50..700`.
- Notifications: BullMQ queue `notifications` (`lib/queue.ts`, worker in `workers/notifications.ts`). Enqueue on message create; priority mention > thread > dm > channel; email via Mailpit SMTP :1025. Socket room `user:<id>` gets `notification:new`.

### Mobile gotchas

- Metro needs the monorepo: `apps/mobile/metro.config.js` sets `watchFolders` to repo root + `nodeModulesPaths`; `unstable_enablePackageExports` resolves `@chat/shared/schemas` TS sources. Don't delete it.
- Bun isolated installs: never import transitive deps (e.g. `@expo/vector-icons`, `ulid`) without adding them to `apps/mobile/package.json`.
- Auth is bearer-token, no cookies: token from sign-in/up response body → `expo-secure-store` → `Authorization` header + socket `auth:{token}`. After sign-in/out call `resetSocket()` before reconnecting.
- Env vars must be prefixed `EXPO_PUBLIC_`; Android emulator reaches host as `10.0.2.2`, not `localhost`.
- Attachments upload raw bytes (blob PUT) — S3 presigned PUT signatures break with FormData multipart.
- Optimistic sends use temp ids `temp-<ulid>` and a `nonce`; cache upserts dedupe by id OR nonce (socket echo arrives too).
- Verify mobile changes with `bun run typecheck --filter=mobile` and a bundle smoke test: `bunx expo export --platform web` in `apps/mobile` (run it from that directory).

## Next work

- AI integration (see PLAN.md): personal LLM connections via OpenAI-compatible API (LM Studio first) + external agents over ACP (OpenCode). Connect-only — no hosted models/sandboxes. Replace the old `@ai bot (Ollama RAG)` idea.
- Search v2 (`tsvector` GIN), OpenSearch.
