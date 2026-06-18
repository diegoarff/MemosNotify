<p align="center">
  <img src="assets/icon-256.png" width="128" alt="MemoNudge logo">
</p>

<h1 align="center">MemoNudge</h1>

> Self-hosted reminder bot for [Memos](https://usememos.com). Tag a memo and get a
> reminder with one-tap **snooze / clear / mute** actions, plus recurring reminders and
> daily digests. Triggers, timing, actions, notifiers, and storage are all config-driven.

**Default keyword:** `#remind` · **Notifiers:** Telegram · **Storage:** SQLite (Postgres-ready)

---

## Why

You jot something into Memos (_"renew passport #remind(3w)"_) and forget about it.
MemoNudge watches for created memos, schedules a reminder, and delivers it to Telegram
with buttons to snooze, clear, ignore, or complete it. No public ingress required:
Telegram runs over long polling (outbound only) and the Memos → MemoNudge webhook hop
stays on your internal Docker network.

## Features

- **Tag-driven triggers:** react to memos tagged `#remind` (configurable), in `opt-in`
  or `all` mode.
- **Inline timing:** `#remind(3d)`, `#remind(every 1w)`, `#remind(2026-12-01 09:00)`.
- **Interactive actions:** snooze, snooze-until a clock time, clear, ignore, open the
  memo, fire a webhook, or complete (tag + archive via the Memos API). Rendered as inline
  Telegram buttons.
- **Recurring reminders & re-nudge:** repeat on a cadence, or nag until you act.
- **Quiet hours & daily digest:** defer delivery overnight; optionally batch everything
  into one message at a set time. DST-correct via `croner`.
- **Pluggable storage:** SQLite out of the box, behind a `Storage` interface so Postgres
  can slot in.
- **Config as the source of truth:** one validated `config.yaml`; secrets via `${ENV}` or
  the `${ENV}_FILE` convention for Docker/k8s secret mounts.

## How it works

```
Memos ──(webhook: memo created)──▶ Webhook receiver ──▶ Storage (due in <delay>)
                                                              │
                              Scheduler (cron) ───────────────┘
                                      │ due? quiet hours? digest?
                                      ▼
                                  Notifier.notify(...)  ── Telegram (long polling)
                                      ▲
                 tap a button ────────┘  ── Telegram relays ──▶ onAction ──▶ Core ──▶ Storage
```

Core owns all the semantics (scheduling, recurrence, action execution). Notifiers are
"dumb": they render reminders and report taps as `(reminderId, actionId)`.

---

## Quick start (Docker Compose)

MemoNudge runs as a single container alongside your **existing** Memos instance. It talks
to Memos two ways: it calls the Memos API (`memos.baseUrl`, for complete/archive and deep
links), and Memos calls MemoNudge's webhook. The only requirement is that the two can
reach each other on the network.

1. **Get a Telegram bot token** from [@BotFather](https://t.me/BotFather) and your chat id
   from [@userinfobot](https://t.me/userinfobot).

2. **Create `.env`** (see [`.env.example`](./.env.example)):

   ```dotenv
   TELEGRAM_BOT_TOKEN=123456:ABC...
   TELEGRAM_CHAT_ID=123456789
   MEMOS_BASE_URL=http://<host-ip>:5230   # your Memos, reachable from the container
   MEMOS_TOKEN=                           # Memos → Settings → Access Tokens (for archive/complete/links)
   ```

3. **Create `config.yaml`** by copying [`config.example.yaml`](./config.example.yaml) and
   adjusting triggers/actions to taste.

4. **Start it:**

   ```bash
   docker compose up -d
   ```

5. **Point Memos at the webhook.** In Memos → _Settings → Webhooks_, add a URL that reaches
   the MemoNudge container, ending in `/memos-webhook`, e.g.
   `http://<host-ip>:3000/memos-webhook`. The [`docker-compose.yml`](./docker-compose.yml)
   documents the two reachability options (publish the port, or join your Memos' Docker
   network) inline.

   > **Memos ≥ 0.26.2** blocks webhook URLs that resolve to a private/reserved IP
   > (SSRF protection), and a host/internal address is one. Run your Memos (**≥ v0.27.0**)
   > with `MEMOS_ALLOW_PRIVATE_WEBHOOKS=true`, or expose MemoNudge through a public tunnel
   > and use that URL instead.

6. **Verify** by messaging your bot `/test`; it replies with the chat id it sees. Then
   create a memo containing `#remind(1m)` and wait a minute.

> The compose file pulls `ghcr.io/diegoarff/memonudge:latest`. To build from local source
> instead, uncomment `build: .` under the `memonudge` service.

### Deploy on Coolify

MemoNudge loads its settings from a `config.yaml` **file**, but the secrets inside it come
from the environment (`${VAR}` interpolation). On [Coolify](https://coolify.io) you provide
those two halves separately.

1. **New Resource → Docker Image**, pointing at the published image
   (`ghcr.io/diegoarff/memonudge:latest`).

2. **Environment Variables:** add the secrets the config references:

   ```dotenv
   TELEGRAM_BOT_TOKEN=123456:ABC...
   TELEGRAM_CHAT_ID=123456789
   MEMOS_BASE_URL=http://memos:5230   # your Memos' internal address on this server
   MEMOS_TOKEN=...                     # mark as secret
   ```

3. **The config file (Storages → Add File Mount).** Set the destination to
   `/app/config.yaml` (the default path the app reads) and paste your config, keeping
   secrets as `${VAR}` placeholders so they resolve from step 2:

   ```yaml
   notifier:
     type: telegram
     telegram:
       botToken: ${TELEGRAM_BOT_TOKEN}
       defaultChatId: ${TELEGRAM_CHAT_ID}
   triggers:
     defaultDelay: 7d
   schedule:
     checkInterval: "*/15 * * * *"
     deleteHandledAfter: 1d
   actions:
     - { id: done, label: "✅ Done", type: clear }
     - { id: mute, label: "🔕 Ignore", type: ignore }
   memos:
     baseUrl: ${MEMOS_BASE_URL}
     token: ${MEMOS_TOKEN}
   storage:
     driver: sqlite
     url: file:/app/data/memonudge.db
   ```

   Edit it in the UI and redeploy to change config. (Prefer file-based secrets? Coolify can
   mount a secret as a file and you point `MEMOS_TOKEN_FILE=/run/secrets/...` instead; the
   loader supports the `_FILE` convention.)

4. **Persist the database (Storages → Add Volume),** mount path `/app/data`. Without it,
   each redeploy wipes pending reminders and the deletion queue (SQLite lives in the
   container).

5. **Keep the webhook internal.** The `/memos-webhook` endpoint is **unauthenticated**, so
   don't give MemoNudge a public domain or expose port `3000`. Put it on the **same network
   as your Memos** (same Coolify project, or attach to Memos' network) so they resolve each
   other by name, then in Memos → _Settings → Webhooks_ add
   `http://memonudge:3000/memos-webhook` and set `MEMOS_ALLOW_PRIVATE_WEBHOOKS=true` on the
   Memos service (≥ v0.27.0).

   > If your Memos lives on a **different** host, the webhook can't stay purely internal.
   > Don't expose it bare; front it with a reverse proxy or tunnel that checks a secret, or
   > the endpoint will accept spoofed reminders from anyone.

---

## Configuration

A single `config.yaml` (the loader also accepts `.json`, chosen by file extension).
Override the path with `MEMONUDGE_CONFIG`. Secrets are interpolated from the environment
as `${VAR}` **before** validation; `${VAR}` also resolves from a file when `VAR_FILE` is
set (the autobrr `_FILE` convention).

See [`config.example.yaml`](./config.example.yaml) for a fully-commented example. The main
sections:

### `triggers`

| Key            | Default      | Notes                                                       |
| -------------- | ------------ | ----------------------------------------------------------- |
| `mode`         | `opt-in`     | `opt-in` (only tagged memos) or `all` (every created memo). |
| `tags`         | `[remind]`   | Whole-tag match: `#remind` matches, `#reminder` does not.   |
| `inlineTiming` | `true`       | Parse `#remind(...)` for per-memo timing.                   |
| `defaultDelay` | _(required)_ | Delay when no inline timing is given, e.g. `7d`.            |
| `tagDelays`    | _(none)_     | Per-tag delay overrides, e.g. `remind1w: 1w`.               |

**Inline timing grammar** (inside `#tag(...)`):

- `3d`, `12h`, `2w`, `1mo`, `1y`: a one-shot delay from creation.
- `every 1w`: a recurring reminder.
- `2026-12-01` or `2026-12-01 09:00`: an absolute date (defaults to 09:00).

**Durations** are `<n><unit>` where unit is `s`, `m`, `h`, `d`, `w` (exact) or `mo`, `y`
(calendar-aware).

### Real memo examples

##### No timing: uses defaultDelay (or a matching tagDelays entry)

- Renew the car insurance #remind

##### One-shot delay from when the memo is created

- Reply to the landlord #remind(45s)
- Take the cake out of the oven #remind(30m)
- Move the laundry to the dryer #remind(2h)
- Submit the expense report #remind(3d)
- Cancel the free trial #remind(2w)
- Schedule the dentist #remind(1mo)
- Renew the domain #remind(1y)

##### Recurring: repeats on the cadence until you clear or ignore it

- Water the plants #remind(every 3d)
- Weekly review #remind(every 1w)
- Pay rent #remind(every 1mo)
- Back up the NAS #remind(every 1y)

##### Absolute date (defaults to 09:00 in your configured timezone)

- Mom's birthday #remind(2026-09-12)

##### Absolute date and time (24h clock; space or T separator both work)

- Standup with the team #remind(2026-12-01 09:30)
- Catch the flight #remind(2026-12-01T06:15)

### `schedule`

| Key                  | Default        | Notes                                                                                                                       |
| -------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `checkInterval`      | `*/15 * * * *` | Cron expression for the due-check loop.                                                                                     |
| `timezone`           | `UTC`          | IANA tz for digest, `snooze_until`, absolute dates & quiet hours.                                                           |
| `renudge`            | `off`          | Nag interval for untouched one-shots; `off` = single shot.                                                                  |
| `deleteHandledAfter` | `off`          | Erase a handled message this long after you act on it; **max 24h** (best-effort; Telegram caps deletion at 48h after send). |
| `digest`             | disabled       | `{ enabled, at: "08:00" }`: batch due reminders once/day.                                                                   |
| `quietHours`         | _(none)_       | `{ enabled, from, to, timezone? }`: defer delivery (`timezone` overrides `schedule.timezone`).                              |

### `actions`

An ordered list (1 to 8) rendered as the button rows. Each has a short `id`, a `label`,
and a `type`:

| `type`         | Behavior                                                                   |
| -------------- | -------------------------------------------------------------------------- |
| `snooze`       | Push the reminder out by `duration`.                                       |
| `snooze_until` | Snooze to a clock `time`: `"14:30"`, `"next 09:00"`, `"tomorrow 08:00"`.   |
| `clear`        | Mark resolved; optional `archiveMemo: true`.                               |
| `ignore`       | Mark ignored (no further nags).                                            |
| `open_url`     | A link button; `url` supports `{memoUid}` / `{memoName}` / `{reminderId}`. |
| `webhook`      | Fire `GET`/`POST` to `url` with an optional templated `body`.              |
| `complete`     | Optional `addTag` + `archiveMemo` via the Memos API, then resolve.         |

Template variables: `{reminderId}`, `{memoId}`, `{memoUid}`, `{memoName}`.

### `notifier`, `memos`, `storage`, `server`

- `notifier.telegram`: `botToken`, `defaultChatId`, optional `chatRouting` (route by Memos
  creator id for shared instances).
- `memos`: `baseUrl` + `token`; required for archive/complete and deep links.
- `storage`: `driver` (`sqlite`) and `url` (a libSQL url such as
  `file:/app/data/memonudge.db`).
- `server.port`: webhook listen port (default `3000`).

---

## Local development

Requires **Node ≥ 22** (24 recommended) and **pnpm**.

```bash
pnpm install
cp config.example.yaml config.yaml   # then edit
cp .env.example .env                  # then fill in secrets

pnpm dev          # build + run, rebuilding on change
pnpm test         # vitest
pnpm typecheck    # tsc --noEmit
pnpm lint         # oxlint
pnpm fmt          # oxfmt
pnpm build        # bundle to dist/index.mjs (tsdown)
```

Database migrations are generated with `pnpm db:generate` (drizzle-kit) and applied
automatically at startup.

The toolchain leans on the [oxc / VoidZero](https://oxc.rs) family: **oxlint** for
linting, **oxfmt** for formatting, and **tsdown** for the build.

## Project layout

```
src/
  config/      schema.ts (Zod, single source of truth) + load.ts (yaml/json + ${ENV})
  core/        duration · time · reminders (triggers/views) · actions (executor)
  storage/     interface.ts + drizzle/ (schema, sqlite, migrations)
  notifiers/   interface.ts + telegram.ts (grammY)
  webhook/     server.ts (Hono + zod-validator)
  memos/       client.ts (Memos REST API)
  scheduler.ts cron loop · index.ts wiring
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). In short: `pnpm install`, then keep
`pnpm typecheck`, `pnpm lint`, `pnpm fmt:check`, and `pnpm test` green.

## License

[MIT](./LICENSE)
