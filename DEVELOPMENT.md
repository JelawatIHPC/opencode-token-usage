# Development

The repository root is the plugin package root. OpenCode loads `src/index.ts`,
`src/tui.tsx` and `dist/gui-experimental.cjs` through the `exports` entries, so
there is no build step for the server or TUI parts.

```
src/index.ts        server part: the plugin id and an empty setup
src/tui.tsx         TUI part: sidebar, database scan, aggregation cache
src/gui.tsx         GUI part source: titlebar pill, window bar, side panel
src/core.ts         pure helpers shared by TUI and GUI (no bun/node/DOM/JSX)
dist/               GUI build output, committed because Git installs cannot build
tests/              bundle smoke test, run with plain node
```

## Commands

```bash
npm install
npm run typecheck    # tsc for the TUI (tsconfig.json) and the GUI (tsconfig.gui.json)
npm run build:gui    # vite build -> dist/gui-experimental.cjs
npm run test:bundle  # load the bundle with stubbed host modules
```

`build:gui` is deliberately not named `build`: a `build` / `prepare` /
`install` script makes npm run a preparation install for Git dependencies,
which fails on some OpenCode versions. The bundle is committed instead.

## Why the GUI bundle is committed

The desktop window loads plugins through a module map that provides
`@opencode/plugin/gui`, `solid-js` and `solid-js/web` and inlines every dynamic
import. That means the GUI part must already be one CommonJS file when the app
reads it, and `dist/` must not be git-ignored or a Git install ships without
`./gui-experimental`.

## Verifying the bundle

`npm run test:bundle` compiles `dist/gui-experimental.cjs` in a stub module
registry, calls `setup`, and asserts that the bundle registers a panel, a
titlebar item, a `window.bottom` slot and the stylesheet. It does not start
OpenCode, so it catches broken exports and stale builds quickly.

## Local iteration

Point a global `opencode.jsonc` at this directory (a directory, not a file; no
`~`) and run the desktop app:

```jsonc
{ "plugins": ["path\\to\\opencode-token-usage"] }
```

The desktop app watches `dist/gui-experimental.cjs`, so `npm run build:gui` is
enough to update the GUI. The TUI part is loaded per process.

## Storage

The plugin id is `opencode-token-usage`, and both halves derive their storage
from it: the TUI writes `plugin.opencode-token-usage.{settings,retired,modelNames}`
under the TUI state directory, the desktop window uses the same namespace
through `ctx.storage`. Changing the id therefore starts from empty caches.
