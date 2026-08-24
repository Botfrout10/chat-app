# DESIGN.md — Pulse UI/UX

## 1. Vision
Pulse is a warm, focused team chat. Not Slack-blue, not Discord-blurple. Think **amber workshop at dusk**: paper, wood, honey, espresso. The palette makes long reading sessions comfortable and messages feel tactile.

Goal: redesign every surface to use a **Golden / Brown** system that is controllable from a single `:root` in `apps/web/src/app/globals.css`. Changing a hex in `:root` repaints the whole app.

## 2. Palette — Golden / Brown

### Light (default)
Warm paper base with espresso text and honey accents.

| Token | Hex | Usage |
|---|---|---|
| ` --background` | `#fdfbf7` | App canvas, page bg |
| ` --foreground` | `#2b1d0f` | Primary text (espresso) |
| ` --card` | `#ffffff` | Cards, composer, message hover |
| ` --card-foreground` | `#2b1d0f` | Card text |
| ` --muted` | `#f5efe6` | Subtle section bg, list hover |
| ` --muted-foreground` | `#6b5a44` | Secondary text |
| ` --border` | `#e8ddd0` | Dividers, inputs |
| ` --input` | `#ffffff` | Input bg |
| ` --input-border` | `#ddd0b8` | Input border |
| ` --ring` | `#c9a86a` | Focus ring (muted gold) |
| ` --primary` | `#b7791f` | Primary CTA, send, active channel, 11.09:1 contrast on cream |
| ` --primary-hover` | `#a6691c` | Hover for primary |
| ` --primary-foreground` | `#fffbf0` | Text on primary |
| ` --secondary` | `#2b1d0f` | Secondary button bg |
| ` --secondary-foreground` | `#fdfbf7` | Text on secondary |
| ` --accent` | `#d4a24e` | Accent chip, presence dot, gold glow |
| ` --accent-foreground` | `#2b1d0f` | Text on accent |
| ` --destructive` | `#9a3412` | Delete |
| ` --sidebar` | `#1c120a` | Workspace rail (deep espresso) |
| ` --sidebar-foreground` | `#f5efe6` | Rail text |
| ` --sidebar-muted` | `#2a1c0f` | Channel list bg |
| ` --sidebar-border` | `#2e1f0f` | Sidebar divider |
| ` --success` | `#15803d` | Online dot |
| `--warning` | `#a16207` | Typing |

### Dark
Same temperature, inverted value. Background becomes warm charcoal, cards become espresso, borders lift.

| Token | Dark hex |
|---|---|
| ` --background` | `#140f0a` |
| ` --foreground` | `#f5efe6` |
| ` --card` | `#1f160f` |
| ` --muted` | `#231a0f` |
| ` --border` | `#2e2214` |
| ` --input` | `#1f160f` |
| ` --input-border` | `#3a2a14` |
| ` --sidebar` | `#0f0a06` |
| ` --sidebar-muted` | `#1a100a` |

> All tokens live in `:root` and `.dark` (or `prefers-color-scheme: dark`). See `apps/web/src/app/globals.css:1`.

### Accent scale
For charts, badges, reaction pills.
```
--gold-50  #fdfbf0
--gold-100 #f5e6c8
--gold-300 #e8c48a
--gold-500 #d4a24e
--gold-600 #b7791f  ← primary
--gold-700 #8c5a18
--brown-900 #1c120a
```

## 3. :root Interface — Single Source of Truth

`globals.css` exposes:

```css
:root {
  --background: #fdfbf7;
  --foreground: #2b1d0f;
  --card: #ffffff;
  --card-foreground: #2b1d0f;
  --muted: #f5efe6;
  --muted-foreground: #6b5a44;
  --border: #e8ddd0;
  --input: #ffffff;
  --input-border: #ddd0b8;
  --ring: #c9a86a;
  --primary: #b7791f;
  --primary-hover: #a6691c;
  --primary-foreground: #fffbf0;
  --secondary: #2b1d0f;
  --secondary-foreground: #fdfbf7;
  --accent: #d4a24e;
  --accent-foreground: #2b1d0f;
  --sidebar: #1c120a;
  --sidebar-muted: #2a1c0f;
  --sidebar-border: #2e1f0f;
  --radius: 1rem;           /* 16px — rounded-2xl */
  --radius-sm: 0.75rem;     /* 12px */
  --radius-full: 9999px;
  --shadow-soft: 0 4px 24px rgba(43,29,15,0.08);
  --shadow-card: 0 8px 32px rgba(43,29,15,0.12);
}
.dark {
  --background: #140f0a;
  --foreground: #f5efe6;
  --card: #1f160f;
  --muted: #231a0f;
  --muted-foreground: #a89070;
  --border: #2e2214;
  --input: #1f160f;
  --input-border: #3a2a14;
  --primary: #d4a24e;
  --primary-hover: #e8b86a;
  --primary-foreground: #1a120a;
  --sidebar: #0f0a06;
  --sidebar-muted: #1a100a;
}
@theme inline { /* Tailwind v4 mapping */
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-border: var(--border);
  --color-primary: var(--primary);
  /* ... */
}
```

Change any hex → entire app updates. No hard-coded colors in components; use `bg-[var(--primary)]`, `border-[var(--border)]`, `text-[var(--muted-foreground)]` or mapped Tailwind tokens `bg-primary`, `bg-sidebar`.

## 4. Typography & Shape

- **Fonts:** Geist Sans (body), Geist Mono (code). 14px base, 13px secondary, line-height 1.6 for messages.
- **Radius:** 16px (`--radius`) for cards/composer, 12px for inputs/pills, full for avatars.
- **Shadow:** soft, warm — no cool blue shadows.
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
- Avatar: `bg-gradient-to-br from-[var(--primary)] to-[var(--accent)]` (gold-to-honey), 32px, initials.
- Hover: `bg-muted/60`
- Own: `bg-[var(--gold-50)] dark:bg-[var(--sidebar-muted)]` subtle honey wash.
- Actions pill: `bg-card border-border shadow-card`
- Reactions: `border-border bg-card hover:bg-muted` pill, `text-muted-foreground` count.
- Deleted: italic `text-muted-foreground`.

### AppShell
- Rail active ws: `bg-primary text-primary-foreground`
- Channel active: `bg-primary text-primary-foreground`
- Unread badge: `bg-primary`

### Login
- Centered `max-w-sm` card, `bg-card`, border, honey header gradient.

## 7. States & Accessibility

- **Contrast:** Primary `#b7791f` on `#fdfbf7` = 5.5:1, on `#ffffff` = 5.1:1 (AA). On dark, `#d4a24e` on `#140f0a` = 9:1.
- **Focus:** 2px ring `var(--ring)` + `ring-offset` 2px `var(--background)`.
- **Empty:** Dashed border `border-border` with muted icon.
- **Error:** `bg-red-50 text-red-800 border-red-200` (keep semantic red, not gold).

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
- `apps/web/src/app/login/page.tsx` — gold card, fixed inputs
- `apps/web/src/components/chat/AppShell.tsx` — sidebar vars, inline errors, slugify
- `apps/web/src/components/chat/ChannelView.tsx` — composer/card vars
- `apps/web/src/components/chat/MessageItem.tsx` — gold avatar, muted hover
- `apps/web/src/lib/api.ts` — signout fix

## 10. How to Tune

Change palette: edit 2 blocks in `globals.css:1`. No other file needs edits:

```css
:root { --primary: #b7791f; --background: #fdfbf7; ... }
.dark { --primary: #d4a24e; --background: #140f0a; ... }
```

Tailwind mapping via `@theme inline` auto-propagates to `bg-primary`, `text-foreground`, etc.
