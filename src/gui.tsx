/**
 * Desktop GUI entry: a titlebar pill, a window-bottom status bar, and a side
 * panel with the full breakdown.
 *
 * The period (year/month/week/day) is chosen in the panel and persisted here;
 * the titlebar and the status bar follow it. The data layer is
 * `ctx.client.experimental.session.stats` (scheme A), so the window needs no
 * database access and no server part. Everything shared with the TUI lives in
 * ./core; this file only maps stats -> UsageSnapshot and renders.
 */
import { createSignal, For, onCleanup, Show } from "solid-js"
import {
  Panel,
  Plugin,
  Slot,
  Style,
  TitlebarItem,
  type Context,
  type PanelTab,
} from "@opencode/plugin/gui"
import {
  colorForModel,
  fallbackModelLabel,
  formatCompact,
  formatMoney,
  metricLines,
  MODEL_TAG_L,
  modelTags,
  normalizeRange,
  periodStart,
  rangeTitle,
  type MonthlyTotals,
  type RangeMode,
  type UsageSnapshot,
} from "./core"

type Stats = Awaited<ReturnType<Context["client"]["experimental"]["session"]["stats"]>>

const MAX_MODEL_ROWS = 7
const REFRESH_MS = 60_000
const TITLEBAR_ID = "monthly"
const PANEL_ID = "usage"
const PANEL_KEY = "usage"
const RANGE_KEY = "monthly-tokens.range"
const CACHE_KEY = "monthly-tokens.cache"

type GuiRange = Exclude<RangeMode, "collapsed">

const RANGE_LABELS: Record<GuiRange, string> = {
  monthly: "Monthly",
  weekly: "Weekly",
  daily: "Daily",
  yearly: "Yearly",
}

const RANGE_OPTIONS = (["monthly", "weekly", "daily", "yearly"] as const).map((value) => ({
  value,
  label: RANGE_LABELS[value],
}))

function storedRange(): GuiRange {
  try {
    const mode = normalizeRange(localStorage.getItem(RANGE_KEY))
    return mode === "collapsed" ? "monthly" : mode
  } catch {
    return "monthly"
  }
}

function storeRange(mode: GuiRange): void {
  try {
    localStorage.setItem(RANGE_KEY, mode)
  } catch {
    // A window that refuses storage keeps the range for this session only.
  }
}

function totalOf(totals: MonthlyTotals): number {
  return totals.input + totals.output + totals.cached
}

/** `SessionStatsInfo` -> the snapshot shape the shared render helpers expect. */
function toSnapshot(stats: Stats, label: string): UsageSnapshot {
  const perModel = new Map<
    string,
    { tokens: number; cost: number; providers: Map<string, number> }
  >()

  for (const usage of stats.models) {
    const tokens =
      usage.tokens.input +
      usage.tokens.output +
      usage.tokens.reasoning +
      usage.tokens.cache.read +
      usage.tokens.cache.write
    const modelID = usage.model.id
    let bucket = perModel.get(modelID)
    if (!bucket) {
      bucket = { tokens: 0, cost: 0, providers: new Map() }
      perModel.set(modelID, bucket)
    }
    bucket.tokens += tokens
    bucket.cost += usage.cost
    const provider = usage.model.providerID
    if (provider !== "") {
      bucket.providers.set(provider, (bucket.providers.get(provider) ?? 0) + tokens)
    }
  }

  return {
    label,
    totals: {
      // Same accounting as the TUI: reasoning is part of output, cache read and
      // write are both cached tokens.
      input: stats.tokens.input,
      output: stats.tokens.output + stats.tokens.reasoning,
      cached: stats.tokens.cache.read + stats.tokens.cache.write,
      cost: stats.cost,
    },
    models: [...perModel.entries()]
      .map(([modelID, bucket]) => ({
        modelID,
        tokens: bucket.tokens,
        cost: bucket.cost,
        providers: [...bucket.providers.entries()]
          .map(([id, tokens]) => ({ id, tokens }))
          .sort((a, b) => b.tokens - a.tokens),
      }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, MAX_MODEL_ROWS),
  }
}

const CSS = `
.mt-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  overflow-y: auto;
  padding: 12px 14px 18px;
  color: inherit;
  font-size: 12px;
  line-height: 1.4;
}
.mt-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.mt-title {
  font-size: 13px;
  font-weight: 600;
}
.mt-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 16px;
}
.mt-metric {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}
.mt-value {
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.mt-label {
  font-size: 10px;
  letter-spacing: 0.08em;
  opacity: 0.55;
  text-transform: uppercase;
}
.mt-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mt-section-title {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.75;
}
.mt-models {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mt-model {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 10px;
  border-top: 1px solid rgba(128, 128, 128, 0.2);
}
.mt-model:first-child {
  padding-top: 0;
  border-top: none;
}
.mt-model-name {
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mt-model-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
}
.mt-tags {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}
.mt-tag {
  max-width: 100%;
  overflow: hidden;
  padding: 1px 6px;
  border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 12%, transparent);
  font-size: 10px;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mt-nums {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
}
.mt-num {
  font-variant-numeric: tabular-nums;
  opacity: 0.6;
}
.mt-note {
  font-size: 11px;
  opacity: 0.6;
}
.mt-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  opacity: 0.7;
}
.mt-error {
  font-size: 11px;
  color: #d9534f;
  overflow-wrap: anywhere;
}
.mt-range {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.mt-range-label {
  font-size: 10px;
  letter-spacing: 0.08em;
  opacity: 0.55;
  text-transform: uppercase;
}
.mt-select {
  min-width: 124px;
}
.mt-status {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  width: 100%;
  height: 28px;
  padding: 0 12px;
  border-top: 1px solid rgba(128, 128, 128, 0.22);
  background: rgba(128, 128, 128, 0.06);
  color: inherit;
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  user-select: none;
  overflow: hidden;
}
.mt-status-period {
  flex: none;
  font-weight: 600;
  opacity: 0.7;
}
.mt-status-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  min-width: 0;
  font-variant-numeric: tabular-nums;
}
.mt-status-total {
  flex: none;
  opacity: 0.85;
}
.mt-status-sep {
  flex: none;
  width: 1px;
  height: 12px;
  background: currentColor;
  opacity: 0.18;
}
.mt-status-model {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.mt-status-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 999px;
}
.mt-status-name {
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
}
.mt-status-num {
  flex: none;
}
.mt-status-note {
  flex: none;
  opacity: 0.55;
}
`

export default Plugin.define({
  setup(ctx) {
    // Yearly and monthly scans cost the server roughly 0.8 s and 0.2 s, so they
    // get a stale-while-revalidate cache: switching periods paints the previous
    // numbers at once and the fresh request replaces them when it lands. Weekly
    // and daily answer in a few milliseconds and are always fetched.
    // Entries never expire on their own: the key carries the period label, so a
    // new year or month simply misses, and any hit is refreshed right away.
    const CACHED_RANGES: ReadonlySet<GuiRange> = new Set(["monthly", "yearly"])
    const CACHE_LIMIT = 8

    // `at` only orders entries for the size cap; it is not an expiry.
    const cache = new Map<string, { snapshot: UsageSnapshot; at: number }>()
    const cacheKey = (mode: GuiRange) => `${mode}|${periodStart(mode).label}`

    const isSnapshot = (value: unknown): value is UsageSnapshot => {
      const snap = value as UsageSnapshot | undefined
      return (
        typeof snap === "object" &&
        snap !== null &&
        typeof snap.label === "string" &&
        typeof snap.totals === "object" &&
        Array.isArray(snap.models)
      )
    }

    try {
      const raw = localStorage.getItem(CACHE_KEY)
      if (raw !== null) {
        const parsed = JSON.parse(raw) as Record<string, { snapshot: unknown; at: unknown }>
        for (const [key, entry] of Object.entries(parsed)) {
          if (typeof entry?.at === "number" && isSnapshot(entry.snapshot)) {
            cache.set(key, { snapshot: entry.snapshot, at: entry.at })
          }
        }
      }
    } catch {
      // A corrupt or unavailable cache only costs an extra request.
    }

    const saveCache = () => {
      try {
        const entries = [...cache.entries()]
          .sort((a, b) => b[1].at - a[1].at)
          .slice(0, CACHE_LIMIT)
        localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)))
      } catch {
        // Storage may be full or disabled; the in-memory cache still works.
      }
    }

    const readCache = (mode: GuiRange): UsageSnapshot | undefined => {
      if (!CACHED_RANGES.has(mode)) return undefined
      return cache.get(cacheKey(mode))?.snapshot
    }

    const [range, setRange] = createSignal<GuiRange>(storedRange())
    const [snapshot, setSnapshot] = createSignal<UsageSnapshot | undefined>(readCache(range()))
    const [loading, setLoading] = createSignal(false)
    const [error, setError] = createSignal<string>()

    // Requests can overlap when the period changes mid-flight; only the latest
    // one may write, so a slower older request cannot overwrite the new period.
    let sequence = 0
    const refresh = async () => {
      const id = ++sequence
      const mode = range()
      const { label, start } = periodStart(mode)
      setLoading(true)
      setError(undefined)
      try {
        const stats = await ctx.client.experimental.session.stats({
          from: start,
          to: Date.now(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          tools: "none",
        })
        if (ctx.signal.aborted || id !== sequence) return
        const next = toSnapshot(stats, label)
        setSnapshot(next)
        if (CACHED_RANGES.has(mode)) {
          cache.set(cacheKey(mode), { snapshot: next, at: Date.now() })
          saveCache()
        }
      } catch (cause) {
        if (ctx.signal.aborted || id !== sequence) return
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!ctx.signal.aborted && id === sequence) setLoading(false)
      }
    }

    const changeRange = (mode: GuiRange) => {
      if (mode === range()) return
      setRange(mode)
      storeRange(mode)
      // Paint the cached numbers for the new period if there are any; otherwise
      // clear so the previous period's numbers never wear the new label.
      setSnapshot(readCache(mode))
      void refresh()
    }

    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_MS)
    onCleanup(() => clearInterval(timer))

    const open = () => {
      const session = ctx.sessions.current()
      if (session) {
        ctx.layout.open(`${ctx.id}:${PANEL_KEY}`, session)
        return
      }
      ctx.dialogs.open((dialog) => (
        <ctx.ui.Dialog
          title={rangeTitle(range(), snapshot()?.label ?? periodStart(range()).label)}
          description="Usage across every session on this server."
          size="large"
          footer={
            <>
              <ctx.ui.Button
                variant="ghost"
                icon="refresh"
                busy={loading()}
                onClick={() => void refresh()}
              >
                Refresh
              </ctx.ui.Button>
              <ctx.ui.Button variant="contrast" onClick={dialog.close}>
                Close
              </ctx.ui.Button>
            </>
          }
        >
          <UsageView />
        </ctx.ui.Dialog>
      ))
    }

    const tab: PanelTab = {
      id: PANEL_ID,
      title: "Token usage",
    }

    ctx.add(Panel, {
      id: "usage",
      region: "side",
      width: 360,
      list: (input) => (input.open.includes(PANEL_KEY) ? [tab] : []),
      render: () => <UsageView />,
    })

    // Always present: the pill is the only way to open the panel, so hiding it
    // while loading or after a stats error would leave the panel unreachable.
    ctx.add(TitlebarItem, (): TitlebarItem => {
      const snap = snapshot()
      const failure = error()
      const mode = range()
      const label = snap?.label ?? periodStart(mode).label
      const unavailable = failure !== undefined && snap === undefined
      return {
        id: TITLEBAR_ID,
        label: snap
          ? `Tokens ${formatCompact(totalOf(snap.totals))} · ${formatMoney(snap.totals.cost)}`
          : unavailable
            ? "Tokens unavailable"
            : "Tokens",
        title: snap
          ? rangeTitle(mode, snap.label)
          : unavailable
            ? `Token usage unavailable: ${failure}`
            : `Loading ${rangeTitle(mode, label)}`,
        icon: unavailable ? "circle-exclamation" : "status",
        busy: loading() && snap === undefined,
        run: open,
      }
    })

    ctx.add(Slot, {
      at: "window.bottom",
      order: 0,
      render: () => <UsageBar />,
    })

    ctx.add(Style, CSS)

    function UsageBar() {
      const mode = () => range()
      const label = () => snapshot()?.label ?? periodStart(mode()).label
      const title = () => {
        const snap = snapshot()
        if (snap) return rangeTitle(mode(), snap.label)
        if (error()) return `Token usage unavailable: ${error()}`
        return `Loading ${rangeTitle(mode(), label())}`
      }

      return (
        <div class="mt-status" data-component="monthly-tokens-status" title={title()}>
          <div class="mt-status-right">
            <span class="mt-status-period">
              {RANGE_LABELS[mode()]} · {label()}
            </span>
            <Show
              when={snapshot()}
              keyed
              fallback={
                <span class="mt-status-note">
                  {error() ? "Usage unavailable" : loading() ? "Loading usage…" : "No usage data yet."}
                </span>
              }
            >
              {(snap) => (
                <>
                  <span class="mt-status-sep" />
                  <span class="mt-status-total">
                    {formatCompact(totalOf(snap.totals))} tokens · {formatMoney(snap.totals.cost)}
                  </span>
                  <Show when={snap.models[0]} keyed>
                    {(row) => {
                      const name = fallbackModelLabel(row.modelID)
                      const color = colorForModel(row.modelID)
                      const dim = colorForModel(row.modelID, MODEL_TAG_L)
                      return (
                        <>
                          <span class="mt-status-sep" />
                          <span
                            class="mt-status-model"
                            title={`${name}: ${formatCompact(row.tokens)} tokens · ${formatMoney(row.cost)}`}
                          >
                            <span class="mt-status-dot" style={{ background: color }} />
                            <span class="mt-status-name" style={{ color }}>
                              {name}
                            </span>
                            <span class="mt-status-num" style={{ color: dim }}>
                              {formatCompact(row.tokens)} tokens · {formatMoney(row.cost)}
                            </span>
                          </span>
                        </>
                      )
                    }}
                  </Show>
                </>
              )}
            </Show>
          </div>
        </div>
      )
    }

    function UsageView() {
      return (
        <div class="mt-panel">
          <div class="mt-top">
            <span class="mt-title">
              {rangeTitle(range(), snapshot()?.label ?? periodStart(range()).label)}
            </span>
            <ctx.ui.IconButton
              icon="refresh"
              label="Refresh token usage"
              size="small"
              busy={loading()}
              onClick={() => void refresh()}
            />
          </div>

          <div class="mt-range">
            <span class="mt-range-label">Period</span>
            <ctx.ui.Select
              class="mt-select"
              label="Usage period"
              options={RANGE_OPTIONS}
              value={range()}
              onChange={changeRange}
            />
          </div>

          <Show when={error()}>
            {(message) => <div class="mt-error">Usage unavailable: {message()}</div>}
          </Show>

          <Show
            when={snapshot()}
            fallback={
              <div class="mt-loading">
                <Show
                  when={loading()}
                  fallback={<span class="mt-note">No usage data yet.</span>}
                >
                  <ctx.ui.Loader size="small" />
                  <span>Loading usage…</span>
                </Show>
              </div>
            }
          >
            {(snap) => (
              <>
                <div class="mt-metrics">
                  <For each={metricLines(snap().totals)}>
                    {(row) => (
                      <div class="mt-metric">
                        <span class="mt-value">{row.value}</span>
                        <span class="mt-label">{row.label}</span>
                      </div>
                    )}
                  </For>
                </div>

                <Show when={snap().models.length > 0}>
                  <div class="mt-section">
                    <div class="mt-section-title">Top models</div>
                    <div class="mt-models">
                      <For each={snap().models}>
                        {(row) => {
                          const nameColor = colorForModel(row.modelID)
                          const tagColor = colorForModel(row.modelID, MODEL_TAG_L)
                          return (
                            <div class="mt-model">
                              <div class="mt-model-name" style={{ color: nameColor }}>
                                {fallbackModelLabel(row.modelID)}
                              </div>
                              <div class="mt-model-row">
                                <div class="mt-tags">
                                  <For each={modelTags(row.modelID, row.providers)}>
                                    {(tag) => (
                                      <span class="mt-tag" style={{ color: tagColor }}>
                                        {tag}
                                      </span>
                                    )}
                                  </For>
                                </div>
                                <div class="mt-nums">
                                  <span class="mt-num">{formatCompact(row.tokens)} tokens</span>
                                  <span class="mt-num">{formatMoney(row.cost)}</span>
                                </div>
                              </div>
                            </div>
                          )
                        }}
                      </For>
                    </div>
                  </div>
                </Show>
              </>
            )}
          </Show>
        </div>
      )
    }
  },
})
