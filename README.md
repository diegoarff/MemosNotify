<p align="center">
  <img src="assets/icon-256.png" width="128" alt="MemoNudge logo">
</p>

<h1 align="center">MemoNudge</h1>

> Self-hosted reminder bot for [Memos](https://usememos.com). Tag a memo and get a
> reminder with one-tap **snooze / clear / mute** actions — plus recurring reminders and
> daily digests. Triggers, timing, actions, notifiers, and storage are all config-driven.

**Default keyword:** `#remind` · **Notifiers:** Telegram · **Storage:** SQLite (Postgres-ready)

---

## Why

You jot something into Memos — _"renew passport #remind(3w)"_ — and forget about it.
MemoNudge watches for created memos, schedules a reminder, and delivers it to Telegram
with buttons to snooze, clear, ignore, or complete it. No public ingress required:
Telegram runs over long polling (outbound only) and the Memos → MemoNudge webhook hop
stays on your internal Docker network.

## Features

- **Tag-driven triggers** — react to memos tagged `#remind` (configurable), in `opt-in`
  or `all` mode.
- **Inline timing** — `#remind(3d)`, `#remind(every 1w)`, `#remind(2026-12-01 09:00)`.
- **Interactive actions** — snooze, snooze-until a clock time, clear, ignore, open the
  memo, fire a webhook, or complete (tag + archive via the Memos API). Rendered as inline
  Telegram buttons.
- **Recurring reminders & re-nudge** — repeat on a cadence, or nag until you act.
- **Quiet hours & daily digest** — defer delivery overnight; optionally batch everything
  into one message at a set time. DST-correct via `croner`.
- **Pluggable storage** — SQLite out of the box, behind a `Storage` interface so Postgres
  can slot in.
- **Config as the source of truth** — one validated `config.yaml`; secrets via `${ENV}` or
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

The bundled `docker-compose.yml` is an **example** that stands up Memos **and** MemoNudge
together — the fastest way to try it. If you already run Memos, skip to
[Already running Memos?](#already-running-memos) below.

1. **Get a Telegram bot token** from [@BotFather](https://t.me/BotFather) and your chat id
   from [@userinfobot](https://t.me/userinfobot).

2. **Create `.env`** (see [`.env.example`](./.env.example)):

   ```dotenv
   TELEGRAM_BOT_TOKEN=123456:ABC...
   TELEGRAM_CHAT_ID=123456789
   MEMOS_BASE_URL=http://memos:5230
   MEMOS_TOKEN=                       # Memos → Settings → Access Tokens (for archive/complete/links)
   ```

3. **Create `config.yaml`** by copying [`config.example.yaml`](./config.example.yaml) and
   adjusting triggers/actions to taste.

4. **Start it:**

   ```bash
   docker compose up -d
   ```

5. **Point Memos at the webhook.** In Memos → _Settings → Webhooks_, add:

   ```
   http://memonudge:3000/memos-webhook
   ```

   > **Memos ≥ 0.26.2** blocks webhook URLs that resolve to a private/reserved IP
   > (SSRF protection), and the internal address above is one. The compose file sets
   > `MEMOS_ALLOW_PRIVATE_WEBHOOKS=true` on the `memos` service to opt back in — this
   > requires **Memos ≥ v0.27.0**.

6. **Verify** — message your bot `/test`; it replies with the chat id it sees. Then create
   a memo containing `#remind(1m)` and wait a minute.

> The compose file pulls `ghcr.io/OWNER/memonudge:latest`. To build from local source
> instead, uncomment `build: .` under the `memonudge` service.

### Already running Memos?

You don't need the bundled `memos` service — run **just** MemoNudge and point it at your
existing instance. MemoNudge only talks to Memos over two seams: the inbound webhook
(Memos → MemoNudge) and the outbound REST client (`memos.baseUrl`, for archive/complete and
deep links). The only requirement is that the two can reach each other on the network.

Use the standalone [`docker-compose.memonudge.yml`](./docker-compose.memonudge.yml):

```bash
docker compose -f docker-compose.memonudge.yml up -d
```

Then:

1. Set `MEMOS_BASE_URL` in `.env` to your Memos URL (e.g. `http://memos:5230` if you join its
   Docker network, or `http://<host-ip>:5230`).
2. Make MemoNudge reachable from Memos — either attach MemoNudge to your existing Memos Docker
   network (reach it as `http://memonudge:3000/...`) or publish port `3000` and use
   `http://<host-ip>:3000/...`. The compose file documents both options inline.
3. In Memos → _Settings → Webhooks_, add the matching webhook URL ending in `/memos-webhook`.

> **SSRF note:** Memos ≥ 0.26.2 refuses webhook URLs resolving to a private/reserved IP
> — which both options above produce. Run your Memos (≥ v0.27.0) with
> `MEMOS_ALLOW_PRIVATE_WEBHOOKS=true`, or expose MemoNudge through a public tunnel and use
> that URL instead.

---

## Configuration

A single `config.yaml` (the loader also accepts `.json` — chosen by file extension).
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
| `tagDelays`    | —            | Per-tag delay overrides, e.g. `remind1w: 1w`.               |

**Inline timing grammar** (inside `#tag(...)`):

- `3d`, `12h`, `2w`, `1mo`, `1y` — a one-shot delay from creation.
- `every 1w` — a recurring reminder.
- `2026-12-01` or `2026-12-01 09:00` — an absolute date (defaults to 09:00).

**Durations** are `<n><unit>` where unit is `s`, `m`, `h`, `d`, `w` (exact) or `mo`, `y`
(calendar-aware).

### `schedule`

| Key                  | Default        | Notes                                                                                                                        |
| -------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `checkInterval`      | `*/15 * * * *` | Cron expression for the due-check loop.                                                                                      |
| `timezone`           | `UTC`          | IANA tz for digest, `snooze_until`, absolute dates & quiet hours.                                                            |
| `renudge`            | `off`          | Nag interval for untouched one-shots; `off` = single shot.                                                                   |
| `deleteHandledAfter` | `off`          | Erase a handled message this long after you act on it; **max 24h** (best-effort — Telegram caps deletion at 48h after send). |
| `digest`             | disabled       | `{ enabled, at: "08:00" }` — batch due reminders once/day.                                                                   |
| `quietHours`         | —              | `{ enabled, from, to, timezone? }` — defer delivery (`timezone` overrides `schedule.timezone`).                              |

### `actions`

An ordered list (1–8) rendered as the button rows. Each has a short `id`, a `label`, and a
`type`:

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

- `notifier.telegram` — `botToken`, `defaultChatId`, optional `chatRouting` (route by Memos
  creator id for shared instances).
- `memos` — `baseUrl` + `token`; required for archive/complete and deep links.
- `storage` — `driver` (`sqlite`) and `url` (a libSQL url such as
  `file:/app/data/memonudge.db`).
- `server.port` — webhook listen port (default `3000`).

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
