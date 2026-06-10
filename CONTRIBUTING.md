# Contributing to MemoNudge

Thanks for your interest! MemoNudge is a small, focused codebase — contributions that keep
it that way are very welcome.

## Setup

Requires **Node ≥ 22** (24 recommended) and **pnpm** (via `corepack enable`).

```bash
pnpm install
cp config.example.yaml config.yaml   # then edit
cp .env.example .env                  # then fill in secrets
pnpm dev
```

## Before you push

Keep all four green:

```bash
pnpm typecheck    # tsc --noEmit
pnpm lint         # oxlint
pnpm fmt:check    # oxfmt --check .  (run `pnpm fmt` to auto-fix)
pnpm test         # vitest run
```

CI runs exactly these on every PR.

## Conventions

- **TypeScript, ESM, `.ts` import specifiers.** The project uses `NodeNext` resolution with
  `allowImportingTsExtensions`, so imports are written with their `.ts` extension (e.g.
  `import { x } from "./foo.ts"`). The build (tsdown) handles emit.
- **Config is the single source of truth.** All config types are derived from Zod schemas
  in `src/config/schema.ts` via `z.infer` — don't hand-maintain parallel interfaces.
- **Core owns semantics; notifiers are dumb.** A notifier renders a `ReminderView` and
  reports a tap as `(reminderId, actionId)`. It must not decide what an action _means_ —
  that lives in `src/core/actions.ts`.
- **Storage stays behind its interface.** Only `src/storage/drizzle/**` imports Drizzle.
  The rest of the app depends on `src/storage/interface.ts` so a non-SQL backend remains
  possible. (Drizzle dialects are compile-time, so each backend is its own implementation.)
- **Keep pure logic pure.** Parsing, time math, trigger evaluation, and view/keyboard
  building are side-effect-free and unit-tested. Put new logic of that kind next to its
  tests (`*.test.ts`).
- **Time is timezone-aware.** Use the helpers in `src/core/time.ts` (date-fns-tz) rather
  than raw `Date` arithmetic for anything user-facing.

## Database changes

Schema lives in `src/storage/drizzle/schema.ts`. After changing it:

```bash
pnpm db:generate   # drizzle-kit emits a new migration under src/storage/drizzle/migrations
```

Commit the generated SQL + metadata. Migrations are applied automatically at startup.

## Adding a notifier or storage backend

- **Notifier:** implement `Notifier` (and optionally `InteractiveNotifier`) from
  `src/notifiers/interface.ts`, then add it to the `NotifierConfig` discriminated union and
  the wiring in `src/index.ts`.
- **Storage:** implement `Storage` from `src/storage/interface.ts` and add the driver to
  `StorageConfig` + `src/index.ts`.

## Commits & PRs

- Small, focused PRs with a clear description.
- Include or update tests for behavior changes.
- Make sure the four checks above pass locally before opening the PR.

By contributing you agree your contributions are licensed under the project's
[MIT License](./LICENSE).
