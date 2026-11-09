// Loads the prebuilt GUI bundle outside the app and checks that it registers
// the parts the window needs. Not shipped in the package.
const fs = require("node:fs")
const path = require("node:path")
const Module = require("node:module")

const bundlePath = path.join(__dirname, "..", "dist", "gui-experimental.cjs")
const code = fs.readFileSync(bundlePath, "utf8")

const registries = {
  TitlebarItem: Symbol("TitlebarItem"),
  Panel: Symbol("Panel"),
  Slot: Symbol("Slot"),
  Style: Symbol("Style"),
}

// Node resolves solid-js/web to its SSR build, which throws on template().
// The app's window provides the client build (main gets an inert placeholder),
// so a no-op template is enough for a setup-only smoke test.
const solidWebStub = { template: () => () => null }
const stub = { Plugin: { define: (value) => value }, ...registries }

const load = Module._load
Module._load = function (request, parent, isMain) {
  if (request === "@opencode/plugin/gui") return stub
  if (request === "solid-js/web") return solidWebStub
  return load.call(this, request, parent, isMain)
}

const mod = new Module(bundlePath, module)
mod.filename = bundlePath
mod.paths = Module._nodeModulePaths(path.dirname(bundlePath))
mod._compile(code, bundlePath)

const definition = mod.exports.default
if (!definition || typeof definition.setup !== "function") {
  throw new Error("bundle default export has no setup()")
}

const added = []
const stats = {
  tokens: { input: 11, output: 22, reasoning: 33, cache: { read: 44, write: 55 } },
  cost: 0.5,
  models: [
    {
      model: { id: "vendor/example-model", providerID: "example" },
      tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
      cost: 0.1,
    },
  ],
}

const ctx = {
  id: "opencode-token-usage",
  signal: new AbortController().signal,
  client: { experimental: { session: { stats: async () => stats } } },
  sessions: { current: () => undefined },
  layout: { open: () => {}, close: () => {} },
  dialogs: { open: () => {} },
  add: (registry, value) => {
    added.push([registry, value])
    return () => {}
  },
  on: () => () => {},
  ui: {},
  t: (key) => key,
}

const { createRoot } = require("solid-js")
createRoot(() => {
  definition.setup(ctx)
})

// The titlebar item is a getter the host re-reads, and the first refresh is
// async, so check after it settles.
setTimeout(() => {
  const panel = added.find(([registry]) => registry === registries.Panel)
  const titlebar = added.find(([registry]) => registry === registries.TitlebarItem)
  const slot = added.find(([registry]) => registry === registries.Slot)
  const style = added.find(([registry]) => registry === registries.Style)

  if (!panel || !titlebar || !slot || !style) {
    throw new Error(
      `missing registrations: panel=${!!panel} titlebar=${!!titlebar} slot=${!!slot} style=${!!style}`,
    )
  }
  if (slot[1].at !== "window.bottom") throw new Error(`unexpected slot: ${slot[1].at}`)
  if (!style[1].includes(".mt-panel")) throw new Error("style is missing .mt-panel")
  if (!style[1].includes(".mt-status")) throw new Error("style is missing .mt-status")

  const item = titlebar[1]()
  if (!item || typeof item.label !== "string" || item.label.length === 0) {
    throw new Error(`titlebar item is empty: ${JSON.stringify(item)}`)
  }

  console.log("registrations:", added.map(([registry]) => String(registry)).join(", "))
  console.log("titlebar:", JSON.stringify(item))
  console.log("panel id:", panel[1].id, "region:", panel[1].region)
  console.log("slot:", slot[1].at)
  console.log("BUNDLE OK")
  process.exit(0)
}, 50)
