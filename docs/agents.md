# Agents — Setup Guide (Phase B)

Agents connect over the **Agent Client Protocol (ACP)** via a networked transport. The app never hosts your agent — you run it on your machine or VPS and paste its URL.

## One-command local flow (OpenCode example)

1. Install OpenCode (or any ACP agent):
   ```sh
   npm i -g opencode  # or: bunx opencode
   ```
2. Start the networked ACP server from a project:
   ```sh
   opencode serve --port 4096
   # prints: listening on http://localhost:4096
   # if it prints a token, copy it
   ```
3. In Pulse: **Agents** → **Connect an agent**
   - Workspace: pick the workspace this agent is bound to (its tasks map to ACP sessions in that workspace)
   - Name: e.g. `opencode on macbook`
   - Transport: `network`
   - Endpoint: `http://localhost:4096` (**not** `http://localhost:4096/` UI, not `opencode acp` stdio — see below)
   - Auth secret: if you set `OPENCODE_SERVER_PASSWORD`, paste that password (username is `opencode`; we send `Basic opencode:<password>`; also accepts `Bearer` for generic agents)
   - Click **Connect** → we probe `GET {endpoint}/global/health` → `GET {endpoint}/session` → `GET {endpoint}` with Basic/Bearer fallback and store `status`/`capabilities`/`machineMetadata`. Open the agent row to see `reachable` and `500x` error details.

4. Use it: open a channel in that workspace and use **Agent prompt** (`POST /api/agents/:id/prompt` with `channelId` + `content`). The app streams `agent:delta` / `agent:tool` / `agent:thinking` via Socket.IO `channel:<id>` and persists the final reply as a normal message (authored by `agent+<id>@agent.local`) so search/threads work.

## Remote VPS

Same shape:

```sh
opencode serve --port 4096 --host 0.0.0.0
# put it behind a TLS proxy if exposed to the internet
```

Paste `https://your-host:4096` as endpoint. Auth secret recommended for remote.

## `opencode acp` vs `opencode serve`

- `opencode acp` = **stdio** JSON-RPC for Zed/JetBrains (no HTTP). Do **not** put `http://localhost:4096` for this — choose `stdio` transport in Pulse, or wrap it with a shim.
- `opencode serve` = **HTTP** (`http://localhost:4096`, spec at `/doc`). This is what Pulse’s `network` transport expects. Use it for the chat app.

## Stdio

Choose `stdio` transport if your agent only exposes stdin/stdout. No endpoint is stored; the status shows `online (stdio)`. You need a tiny local shim that bridges stdio to HTTP — not built yet, document your shim's URL as `network` instead.

## How it maps

- **One agent → one workspace** (`agent_registration.workspaceId`) — matches the machine the agent runs on.
- **Task threads → ACP sessions** — each channel in that workspace is a session; prompts in that channel become ACP session prompts.
- Events fanned to `channel:<id>` (and `workspace:<workspaceId>`) via Redis `chat:events` → Socket.IO: `agent:typing` / `agent:delta` / `agent:thinking` / `agent:tool` / `agent:tool_result` / `agent:plan` / `agent:permission` / `agent:error`.

## Logs

The API logs every agent step to the Fastify logger (stdout):

- `bun run dev:api` prints `[agent:<name>] creating OpenCode session…`, `POST /session…`, `[agent:<name>] reply …` and `agent generation failed: …`
- Docker: `docker compose logs -f api` or `docker logs <api>` 
- Increase verbosity: `LOG_LEVEL=debug bun run dev:api` (or set `level: "debug"` in `apps/api/src/index.ts` Fastify init)

Frontend also toasts `agent:error` with the exact message (e.g. endpoint returned HTML). Check DevTools → Network → `POST /api/agents/:id/prompt` → response for full error.

## Troubleshooting

- **Got HTML (`<!doctype html>… OpenCode`)** → endpoint is the web UI, not the API. You used `opencode acp` (stdio) or hit `/` without `/global/health`. Fix: run `opencode serve --port 4096` and set endpoint to `http://localhost:4096`. Verify: `curl -s http://localhost:4096/global/health` should return `{"healthy":true}` and `curl -s http://localhost:4096/doc | head` should be JSON, not HTML.
- `401` → set `OPENCODE_SERVER_PASSWORD=your-secret opencode serve` and paste `your-secret` as auth secret in Pulse (we send `Basic opencode:<secret>`, also try `Bearer`).
- `unreachable` / `ECONNREFUSED` → ensure `opencode serve` is still running and the URL is reachable from the API container (Docker: use `http://host.docker.internal:4096` instead of `localhost` when API runs in Docker).
- `model not in provider` style errors are LLM-only; for agents they surface as `agent:error` toasts.
- **No console logs?** You likely ran `opencode acp` without `--print-logs` — that command is stdio-only and logs to the editor, not your terminal. For Pulse, always use `opencode serve` and watch the **API** terminal (`bun run dev:api`), not the `opencode` terminal.
