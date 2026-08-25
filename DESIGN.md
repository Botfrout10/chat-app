# DESIGN.md — Pulse UI/UX

## 1. Vision
Pulse is a calm, focused team chat. The look: **Petrol & Mint** — deep teal surfaces, cool mist backgrounds, mint primary. Reads like a modern dev tool (Linear/Raycast energy), comfortable for long sessions, and clearly not Slack-blue or Discord-blurple.

Goal: every surface uses this system, controllable from a single `:root` in `apps/web/src/app/globals.css`. Changing a hex in `:root` repaints the whole app.

## 2. Palette — Petrol & Mint

### Light (default)
Cool mist base with deep petrol ink and teal primary.

| Token | Hex | Usage |
|---|---|---|
| `--background` | `#f6f8f8` | App canvas, page bg |
| `--foreground` | `#0c1a19` | Primary text (petrol ink) |
| `--card` | `#ffffff` | Cards, composer, message hover |
| `--card-foreground` | `#0c1a19` | Card text |
| `--muted` | `#edf2f2` | Subtle section bg, list hover |
| `--muted-foreground` | `#5b6f6d` | Secondary text |
| `--border` | `#dde6e5` | Dividers, inputs |
| `--input` | `#ffffff` | Input bg |
| `--input-border` | `#cddad9` | Input border |
| `--ring` | `#14b8a6` | Focus ring (teal) |
| `--primary` | `#0f766e` | Primary CTA, send, active channel — AA on white/mist |
| `--primary-hover` | `#115e59` | Hover for primary |
| `--primary-foreground` | `#f0fdfa` | Text on primary |
| `--secondary` | `#0c1a19` | Secondary button bg |
| `--secondary-foreground` | `#f6f8f8` | Text on secondary |
| `--accent` | `#06b6d4` | Cyan accent chip, links in sidebar |
| `--accent-foreground` | `#08252b` | Text on accent |
| `--destructive` | `#be123c` | Delete / error states |
| `--sidebar` | `#081413` | Workspace rail (deep petrol) |
| `--sidebar-foreground` | `#e6f2ef` | Rail text |
| `--sidebar-muted` | `#0f201e` | Channel list bg |
| `--sidebar-border` | `#16302d` | Sidebar divider |
| `--success` | `#10b981` | Online dot |
| `--warning` | `#d97706` | Typing |

### Dark
Same temperature, inverted value. Near-black petrol surfaces.

| Token | Dark hex |
|---|---|
| `--background` | `#07100f` |
| `--foreground` | `#e6f2ef` |
| `--card` | `#0d1a18` |
| `--muted` | `#11201e` |
| `--border` | `#1c2f2c` |
| `--input` | `#0d1a18` |
| `--input-border` | `#24403c` |
| `--ring` | `#2dd4bf` |
| `--primary` | `#2dd4bf` |
| `--primary-hover` | `#5eead4` |
| `--primary-foreground` | `#04201c` |
| `--accent` | `#22d3ee` |
| `--sidebar` | `#050d0c` |
| `--sidebar-muted` | `#0a1716` |
| `--sidebar-border` | `#142623` |

> All tokens live in `:root` and `.dark` (or `prefers-color-scheme: dark`). See `apps/web/src/app/globals.css:1`.

### Accent scale
For washes, badges, reaction pills, own-message tint.
```
--accent-50  #effcfa   ← mint wash (own messages, reply banner)
--accent-100 #d3f5ee   ← badge/chip bg
--accent-300 #5eead4   ← borders, dark-mode badge text
--accent-500 #14b8a6
--accent-600 #0f766e   ← primary (light)
--accent-700 #115e59   ← badge text on light
```

## 3. :root Interface — Single Source of Truth

`globals.css` exposes:

```css
:root {
  --background: #f6f8f8;
  --foreground: #0c1a19;
  --card: #ffffff;
  --muted: #edf2f2;
  --muted-foreground: #5b6f6d;
  --border: #dde6e5;
  --input: #ffffff;
  --input-border: #cddad9;
  --ring: #14b8a6;
  --primary: #0f766e;
  --primary-hover: #115e59;
  --primary-foreground: #f0fdfa;
  --accent: #06b6d4;
  --sidebar: #081413;
  --sidebar-muted: #0f201e;
  --radius: 1rem;
  --shadow-soft: 0 4px 24px rgba(6,26,24,.08);
  --shadow-card: 0 8px 32px rgba(6,26,24,.14);
}
.dark {
  --background: #07100f;
  --foreground: #e6f2ef;
  --card: #0d1a18;
  --primary: #2dd4bf;
  /* ... */
}
@theme inline { /* Tailwind v4 mapping */
  --color-background: var(--background);
  --color-primary: var(--primary);
  /* ... */
}
```

Change any hex → entire app updates. No hard-coded colors in components; use mapped Tailwind tokens (`bg-primary`, `bg-sidebar`) or arbitrary values (`bg-[var(--primary)]`).

## 4. Typography & Shape

- **Fonts:** Geist Sans (body), Geist Mono (code). 14px base, 13px secondary, line-height 1.6 for messages.
- **Radius:** 16px (`--radius`) for cards/composer, 12px for inputs/pills, full for avatars.
- **Shadow:** soft, cool petrol tint — never blue-gray.
- **Motion:** 150ms ease for hover, 200ms for presence.

## 5. Layout

```
Header (56px, bg-card, border-b) — hidden actions when authed: shows user avatar + sign out
└─ Body (flex, min-h 0)
   ├─ Workspace Rail (64px, bg-sidebar, hidden <sm, hidden when not authed? shown always but empty state)
   ├─ Channel Sidebar (260px, bg-sidebar-muted, hidden <md; collapsible)
   └─ ChannelView (flex-1, bg-background)
      ├─ Header (56px, sticky)
      ├─ Message list (flex-1, overflow-y)
      └─ Composer (sticky bottom, bg-card, border-t)
```

**Hero rule (bug 1 fix):** Marketing hero `Where teams actually talk.` only on `lg` and **only when unauthenticated**. When `GET /api/users/me` succeeds, hide hero and render `AppShell` full-width.

## 6. Components

### Button
- `default`: `bg-primary text-primary-foreground hover:bg-primary-hover`, h-9, rounded-[var(--radius-sm)], shadow-soft.
- `ghost`: `hover:bg-muted text-foreground`
- `outline`: `border border-border hover:bg-muted`
- `secondary`: `bg-secondary text-secondary-foreground`

### Input / Textarea (bug 4 fix)
- `bg-input text-foreground border-input-border placeholder:text-muted-foreground/60`
- `focus:ring-[var(--ring)] focus:border-primary`
- **Must** set `text-foreground` explicitly — fixes black-on-black in dark mode.
- `dark` inputs are `#1f160f` with `#f5efe6` text.

### Card
- `bg-card border-border rounded-[var(--radius)] shadow-soft`

### MessageItem
- Avatar: `bg-gradient-to-br from-[var(--primary)] to-[var(--accent)]` (teal-to-cyan), 32px, initials.
- Hover: `bg-muted/60`
- Own: `bg-[var(--accent-50)] dark:bg-[var(--sidebar-muted)]` subtle mint wash + `--accent-300` left border.
- Actions pill: `bg-card border-border shadow-card`
- Reactions: `border-border bg-card hover:bg-muted` pill, `text-muted-foreground` count.
- Deleted: italic `text-muted-foreground`.

### AppShell
- Rail active ws: `bg-primary text-primary-foreground`
- Channel active: `bg-primary text-primary-foreground`
- Unread badge: `bg-primary`

### Login
- Centered `max-w-sm` card, `bg-card`, border, teal header gradient.

## 7. States & Accessibility

- **Contrast:** Primary `#0f766e` on `#f6f8f8` = 5.6:1, on `#ffffff` = 5.9:1 (AA). On dark, `#2dd4bf` on `#07100f` = 11.4:1.
- **Focus:** 2px ring `var(--ring)` + `ring-offset` 2px `var(--background)`.
- **Empty:** Dashed border `border-border` with muted icon.
- **Error:** `bg-red-50 text-red-800 border-red-200` (keep semantic red, not teal).

## 8. Bug Fixes in This Redesign

1. **Bug 1 — Auth UI:** Header and hero now subscribe to `GET /api/users/me` (TanStack). When `me` exists, hide `Sign in / Create account` and hero `lg` panel; show avatar + email + `Sign out`. Hero grid switches to single column.
2. **Bug 2 — Sign out 400:** `api.ts:8` no longer forces `Content-Type: application/json` on empty body. `authSignOut` now sends `{}`. Fastify `FST_ERR_CTP_EMPTY_JSON_BODY` resolved.
3. **Bug 3 — Create blocked:** Validates channel name as `slugify(lowercase, [a-z0-9-_])`, shows inline error, normalizes on submit. Workspace/channel handlers now surface `error.flatten()` messages instead of silent fail. Backend already supports `POST /api/workspaces` and `POST /api/workspaces/:id/channels`.
4. **Bug 4 — Invisible text:** All `Input`/`Textarea` now use `bg-input text-foreground` with `placeholder:text-muted-foreground`. Login fields become readable in both themes. Applied globally via `button.tsx` shared components.

## 9. Files Touched

- `apps/web/src/app/globals.css` — new :root
- `apps/web/src/components/ui/button.tsx` — Input/Textarea/Badge/Card use vars
- `apps/web/src/app/layout.tsx` — no change, inherits vars
- `apps/web/src/app/page.tsx` — auth-aware, hero conditional
- `apps/web/src/app/login/page.tsx` — petrol card, fixed inputs
- `apps/web/src/components/chat/AppShell.tsx` — sidebar vars, inline errors, slugify
- `apps/web/src/components/chat/ChannelView.tsx` — composer/card vars
- `apps/web/src/components/chat/MessageItem.tsx` — teal avatar, muted hover
- `apps/web/src/lib/api.ts` — signout fix

## 10. How to Tune

Change palette: edit 2 blocks in `globals.css:1`. No other file needs edits:

```css
:root { --primary: #0f766e; --background: #f6f8f8; ... }
.dark { --primary: #2dd4bf; --background: #07100f; ... }
```

Tailwind mapping via `@theme inline` auto-propagates to `bg-primary`, `text-foreground`, etc.

## 11. Mobile (`apps/mobile`)

The Expo client reuses the same visual language, ported 1:1 into `src/theme/tokens.ts` (`light`/`dark` palettes + `radius`/`spacing`). Keep web and mobile tokens in sync when tuning.

**UX direction**

- Bottom tabs: Chats · Search · Activity · Settings. Channels/DMs push full-screen (`slide_from_right`).
- Chat view: inverted list, own messages right-aligned in `--primary` bubbles with `--primary-foreground` text; others left on `--card` with sender name in `--accent-600`. Message grouping collapses consecutive same-sender messages within 5 min.
- Long-press a message → bottom sheet (custom, cross-platform): quick reactions row (👍 ❤️ 😂 🎉 👀) + thread/reply/edit/delete.
- Login: dark `--sidebar` hero with wordmark + light card form; matches the landing mood.
- Presence dots (`--success`/`--border`) on DM avatars; unread badges in `--destructive`.

**Trade-offs**

- Custom message UI over `react-native-gifted-chat`: full token control, lighter bundle.
- FlashList inverted list over FlatList: long channels stay at 60fps; cursor pages map directly onto the inverted order.
- Bearer-token auth instead of cookies: RN cookie handling is fragile; API already accepts it.
