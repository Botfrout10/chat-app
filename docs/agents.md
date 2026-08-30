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
   - Endpoint: `http://localhost:4096`
   - Auth secret: paste the token if `opencode serve` printed one (leave blank otherwise)
   - Click **Connect** → we probe `GET {endpoint}` then `POST {endpoint}/initialize` with `Authorization: Bearer <secret>` and store `status`/`capabilities`/`machineMetadata`.

4. Use it: open a channel in that workspace and use **Agent prompt** (`POST /api/agents/:id/prompt` with `channelId` + `content`). The app streams `agent:delta` / `agent:tool` / `agent:thinking` via Socket.IO `channel:<id>` and persists the final reply as a normal message (authored by `agent+<id>@agent.local`) so search/threads work.

## Remote VPS

Same shape:

```sh
opencode serve --port 4096 --host 0.0.0.0
# put it behind a TLS proxy if exposed to the internet
```

Paste `https://your-host:4096` as endpoint. Auth secret recommended for remote.

## Stdio

Choose `stdio` transport if your agent only exposes stdin/stdout. No endpoint is stored; the status shows `online (stdio)`. You need a tiny local shim that bridges stdio to HTTP — not built yet, document your shim's URL as `network` instead.

## How it maps

- **One agent → one workspace** (`agent_registration.workspaceId`) — matches the machine the agent runs on.
- **Task threads → ACP sessions** — each channel in that workspace is a session; prompts in that channel become ACP session prompts.
- Events fanned to `channel:<id>` (and `workspace:<workspaceId>`) via Redis `chat:events` → Socket.IO: `agent:typing` / `agent:delta` / `agent:thinking` / `agent:tool` / `agent:tool_result` / `agent:plan` / `agent:permission` / `agent:error`.

## Troubleshooting

- `401 Missing or invalid auth secret` → add the token printed by `opencode serve`.
- `unreachable` → ensure `opencode serve` is still running and the URL is reachable from the API (Docker: use `http://host.docker.internal:4096` instead of `localhost` when API runs in Docker).
- `model not in provider` style errors are LLM-only; for agents they surface as `agent:error` toasts.
