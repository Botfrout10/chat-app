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
- [x] Read receipts: seen-by avatar stack on messages + unread dot on channels (mark-on-view, `read:receipt` WS fan-out)
- [x] Invite acceptance page (`/invite/[token]`) — expired/used/already-member/unauth branches + login redirect carry-through
- [x] **UI redesign (2026-08)**: real shadcn/ui foundation (radix-nova) mapped onto petrol/mint tokens; all emoji glyphs → lucide icons (reactions stay emoji content); workspace rail removed → sidebar-header workspace dropdown; sectioned sidebar (Channels only / Direct Messages / AI Models); creation UX moved to modals (workspace, channel w/ privacy switch, invite w/ clipboard link, new-DM member picker); `LlmManager` on Dialog + AlertDialog primitives; Ctrl/Cmd+P (and ⌘K) command palette — navigate channels/DMs/models, message search, creation actions, switch workspace, sign out; presence consolidated into Zustand store (`usePresenceSync`)
- [x] AI Elements chat: Conversation stick-to-bottom scroll + jump button, MessageResponse streaming markdown for assistant messages, Reasoning for thinking streams, Shimmer thinking indicator, PromptInput composer with attach tool; hover actions via MessageAction tooltips
- [x] **Polish round 2 (2026-08)**: preset PromptInput composition (attachments header → textarea → footer w/ attach menu + submit, menu opens upward); native AI Elements attachments (data-URL → presigned PUT on submit); own messages right-aligned via Message preset (`bg-primary` bubbles; reactions/mention chips flip to light variants inside own bubbles); image previews capped (`max-w-[320px]`, lightbox for full size); reaction pills toggle (by-me → `api.unreact`) with active styling; light-mode sidebar tokens (white/mist, dark petrol reserved for dark mode); collapsible sidebar rail (Ctrl/Cmd+B, persisted) + collapsible CHANNELS/DMs/AI sections; LLM streams persisted in Zustand keyed by channel (switching channels mid-generation keeps the stream live; global `llm:*` listeners in AppShell); AI Elements Context hover card in model-chat headers (estimated tokens, ~4 chars/token)

### Infra
- [x] docker-compose (postgres, redis, minio + bucket creator, mailpit)
- [x] Drizzle migrations (`packages/db/drizzle/`) + idempotent seed

## In progress

### Mobile client (`apps/mobile` — Expo SDK 57, React Native 0.86)
Full chat parity with web; bearer-token auth; push notifications deferred to phase 2.

- [x] Slice 0 — Expo scaffold: expo-router, monorepo Metro config, petrol/mint theme tokens, turbo wiring
- [x] Slice 1 — Auth flow: login/signup, session token in SecureStore, route guard
- [x] Slice 2 — API client, typed endpoint helpers, socket singleton (auth via token), zustand store
- [x] Slice 3 — Workspace switcher + channel list (presence, unread badges), DM picker via find-or-create
- [x] Slice 4 — Channel view: inverted message list, optimistic send, typing, live socket cache updates, mark-read
- [x] Slice 5 — Reactions, edit, delete, thread view
- [x] Slice 6 — Attachments: pick → presign → PUT → send; viewer via signed URLs
- [x] Slice 7 — Notifications activity tab (live badge)
- [x] Slice 8 — Search tab
- [x] Slice 9 — Docs: AGENTS.md mobile commands/gotchas, DESIGN.md mobile section
- [x] Auth hardening: global 401 handler tears down stale sessions → gate redirects to login; session blockers moved below all hooks (Rules of Hooks) in channel/thread views; notification polling gated on token; login redirects signed-in users to chats

**Deferred within mobile:** read-receipt rendering. Create-channel / invite UI / LLM model manager landed (`3c797404`).

**Theme parity (mobile ↔ web):**
- [x] Chrome emoji glyphs (`✦`/`🔒`/`🌐`/`🧠`) replaced with Ionicons to honor DESIGN.md "no emoji glyphs in UI chrome" rule (A1)
- [x] Mention-chip highlighting in messages (web `RichText` has it; mobile `MessageMarkdown` plain) — A5
- [x] Manual light/dark/system theme toggle (web has it; mobile follows system only) — A2
- [x] Read receipts (seen-by stack) — A4
- [x] **Web → mobile parity:** web Thread view added (right panel in AppShell) — B1. API gained `GET /api/messages/:id` + serialized replies.

## Remaining / next up

- [x] Web polish: palette jump-to-message highlight — `CommandPalette` now calls `goToMessage(channelId, messageId)` → `store/chat.ts:highlightedMessageId` → `ChannelView` scrolls `msg-<id>` into view with `ring` highlight (2.5s auto-clear) + fetches around-window (`?before`/`?after`) if not in current pages; `MessageItem` has `id=msg-<id>` + highlight ring
- [x] Web polish: PromptInput native attachment hardening — `ChannelView.tsx:ChatComposer` now `maxFiles={10} maxFileSize={25*1024*1024} onError→toast`, `uploadAttachmentPart` checks size + `PUT` status and throws; `prompt-input.tsx` `maxFiles`/`maxFileSize` validation already wired (pre-existing)
- [x] Web polish: dark-mode audit — `dialog.tsx`/`alert-dialog.tsx` overlay `dark:bg-black/40` (was `bg-black/10` invisible on dark), verified `Dialog`/`AlertDialog`/`CommandDialog`/`Input`/`Popover` all use `bg-popover`/`bg-input`/`var(--border)` tokens, scrollbar thumb `dark` variant present; no hard `bg-white` leaks except intentional hero glass
- [x] Push notifications (phase 2): device token registry migration (`push_token` table, `0008_sweet_gorgon`), `POST /api/push/register` + `DELETE /api/push/token` (Expo-only, `expo-server-sdk` chunked, `DeviceNotRegistered` cleanup), worker now sends push for mention/dm/thread alongside in-app + email, mobile `usePushRegistration` (expo-notifications + permissions, Android channel) in `app/_layout.tsx`
- [x] Search v2 (`tsvector` GIN): `message.search_vector tsvector` + trigger + GIN index in `0008_sweet_gorgon`, `modules/search.ts` now `plainto_tsquery` + `ts_rank` with ilike fallback for stopwords, filtered to user's channels

## AI integration (roadmap)

Chat with LLMs; delegate real work to external agents. **Connect-only**: the app never hosts models or agent sandboxes — users bring their own endpoints (localhost or VPS) and we orchestrate.

### Decisions

- LLM access via **OpenAI-compatible API** so one client covers LM Studio, Ollama, vLLM, and most cloud providers; Anthropic gets a thin adapter later.
- First LLM target: **LM Studio** (its `/v1/models` endpoint gives us existence checks + capability discovery for free).
- Agents connect over **ACP** (Agent Client Protocol); first agent target: **OpenCode** (beta OK). The client is **agent-agnostic** — any ACP-compliant agent connects; nothing OpenCode-specific in the schema (endpoint, auth secret, handshake-reported name/version/capabilities only). Standardize on the **networked transport** (HTTP/WS, e.g. `opencode serve`); stdio-only agents need a tiny local shim — document it, don't build it initially.
- Connected LLMs are **personal**: visible and mentionable only by the user who connected them (no cost/quota sharing problems).
- Agent execution happens on the **user's machine/VPS**; the app holds an authenticated control channel (same relay pattern as the LLM proxy, one level up). Hosted sandboxes deliberately out of scope — revisit only if there is demand; schema will keep room for a "hosted provider" type.
- AI conversations live **inside workspaces**, reusing DM find-or-create.
- No settings surface yet — each connection gets a simple **status page** (health, models/capabilities, last heartbeat, session state).
- Voice out of scope. Tools + vision supported at the protocol level where the provider exposes them.

### Phase A — LLMs (chatting)

- [x] DB: `llm_connection` table — owner user, label, base URL, model id, verified capabilities (tools/vision/context), status
- [x] API: register/update/delete connection → validate by fetching provider `/v1/models` and matching the model name; store discovered capabilities (`POST /api/llm/connections`, `PATCH`/`DELETE /api/llm/connections/:id`, `POST .../:id/verify`, `GET .../:id/status`; baseUrl normalized to versioned `/v1`, model existence checked with "Available: …" error)
- [x] API: completion proxy with **streaming relay** into Socket.IO room `channel:<id>` (`lib/llm.ts`: SSE parse of OpenAI-compatible `/chat/completions`, 120s timeout, deltas via `llm:delta`/`llm:typing`/`llm:error` events; one generation at a time per connection)
- [x] Per-connection DM chat (`POST /api/llm/connections/:id/dm` find-or-create; each connection gets a synthetic bot user `llm+<id>@llm.local`, so replies are normal `message` rows with sender joins working)
- [x] Mention-triggered replies — DM peer auto-reply + `@mentionName`/`@label` match against the sender's own connections (hooked into message-send, fire-and-forget)
  - [x] Extend the existing member-mention matching with a second pass over the **sender's own** `llm_connection` rows (mentionName/label, lowercased) — single pipeline, no fork; `mention` rows now carry `type: user | llm` discriminator (`llm` rows use `botUserId` as `mentionedUserId`) — migration `0006_quick_moon_knight`
  - [x] `llm` mentions trigger a streaming completion job instead of a notification; notifications worker skips `type=llm` rows and bot targets (no email/activity for bot mentions)
  - [x] Edge cases: multiple models mentioned → one reply each, serialized per connection (`generating` set) · abort on message delete/edit mid-generation (multi-model `activeByPrompt` map, `abortLlmGenerationForMessage` now cancels all) · generation timeout (120s `AbortSignal.timeout`) · typing indicator while streaming (`llm:typing`/`llm:delta`/`llm:thinking`/`llm:error`) · per-user completion rate limit (20/min sliding window via Redis `slm:llm-complete:<userId>`, `llm:error` on exceed)
- [x] Guardrails: per-user rate limits on completions, max context/messages sent upstream, typing indicator during generation
- [x] Web: connect-model flow (URL + model name + live validation), model status page, streaming message rendering
  - Sidebar **AI MODELS** section (status dot per connection, click → open model DM); `LlmManager` modal (connect form + expandable status detail with provider reachability & model list, re-check/remove); streaming bubble (`llm:typing` → `llm:delta` accumulation → cleared on final `message:new` carrying `llmConnectionId`); connected models merged into @autocomplete
  - Remaining (deferred): tool-call/vision request UI hooks (needs provider-side tools first)
- [x] Mobile: read + send in AI chats (parity with web)
  - Chats tab **AI MODELS** section (status dot per connection, tap → open/refresh model DM); ChannelView renders an LLM streaming indicator (thinking → writing with live delta text) from `llm:typing`/`llm:delta`, cleared on final `message:new` carrying `llmConnectionId` (handled in `useChatEvents`)

### Phase B — Agents (real work)

- [x] DB: `agent_registration` — owner, workspace link, transport (network/stdio), endpoint/host info, auth secret, status, machine metadata, capabilities, heartbeat (`fea9fc4`)
- [x] Local setup path: documented one-command flow (`opencode serve` + paste URL/token); remote VPS same shape (`docs/agents.md`)
- [x] shared: `agentRegistrationSchema` (create + update zod), `AgentStatus` enum (`f180ce8`)
- [x] API: CRUD + `POST /api/agents/:id/verify` + `GET /api/agents/:id/status` + `POST /api/agents/preview` + `POST /api/agents/:id/prompt` + `GET /api/agents/:id/channels` (`f180ce8` + follow-up — `apps/api/src/modules/agents.ts`, rate-limited `agent-verify` 10/min + `agent-prompt` 20/min, `sanitize` strips `authSecret` → `hasAuthSecret`, verify probes `GET <endpoint>` then `POST <endpoint>/initialize` with 5s timeout, stores `status`/`capabilities`/`machineMetadata`/`lastHeartbeatAt`) · ACP client — `apps/api/src/lib/agent.ts` (`ensureAgentBotUser` `agent+<id>@agent.local`, `streamAgent` SSE/NDJSON + OpenAI fallback, `triggerAgentReply` one-at-a-time per agent, `agent:typing`/`agent:delta`/`agent:thinking`/`agent:tool`/`agent:error` via `redis.publish("chat:events")` → `socket.ts` fans to `channel:<id>` + `workspace:<id>`, abort on edit/delete via `abortAgentGenerationForMessage`)
- [x] Each agent gets its own **workspace** in the app bound to the user-managed machine; task threads map to ACP sessions (workspaceId FK enforced, `POST /api/agents/:id/prompt` requires channel in agent workspace, channel list via `GET /api/agents/:id/channels`)
- [x] Web: agents sidebar section + status page (`cf92b7f` — `AppSidebar` `AGENTS` + `CommandPalette` agents group + `AgentManager` dialog) · rich rendering of ACP events (`store/chat.ts` `agentStreams`/`agentTyping`, `AppShell` global `agent:*` listeners, `ChannelView` agent stream placeholder with thinking + tool calls + `MessageResponse`, workspace agent picker → `POST /api/agents/:id/prompt` with streaming fanout)
- [x] Mobile: minimal — read agent output (`e8f5533` — `apps/mobile/src/api/client.ts` `agents`/`promptAgent`/`agentStatus`/`agentPreview`; agent replies are normal `message` rows via `agent+<id>@agent.local` so existing `ChannelView` renders them, streaming indicator + approve/deny prompts deferred)

### Phase C — Later

- [x] Cloud providers (OpenAI, Groq, OpenRouter…) + encrypted-at-rest API key storage — `llm_connection.apiKeyEncrypted` (AES-GCM via `lib/crypto.ts`) + `agent_registration.authSecretEncrypted` (`0008_sweet_gorgon`, `modules/agents.ts` + `lib/agent.ts` decrypt fallback), provider enum `openai-compatible | anthropic` in `shared/schemas.ts` + `schema.ts`
- [x] Anthropic Messages-API adapter behind the same connection interface — `lib/llm.ts: streamAnthropic` (system top-level, `x-api-key` + `anthropic-version`, SSE `content_block_delta` → `llm:delta`), `modules/llm.ts` verify/preview/status branch for `provider=anthropic` (no `/models` listing)
- [ ] Tool/function-calling round-trips for LLMs (provider-side tools)
- [ ] Hosted sandbox agent provider (optional, only if demand appears)
- [x] Web confirm/alert → Dialog: `MessageItem.tsx:89` now `AlertDialog` (petrol tokens) + `ChannelView.tsx:446,459` `alert()` → `toast.error` (sonner)

## Notes

- Another agent owns `apps/web` changes — keep commits scoped to `apps/mobile` (+ root wiring only when necessary).
- `apps/api` attachment schema refactor landed: send payload is now `attachments:[{key,filename,mime,size}]` (old `attachmentKeys` strings gone). Mobile slice 6 should presign → PUT → send this shape; response message includes full attachment rows for previews.
