/**
 * TUI 与 GUI 共用的纯逻辑。
 *
 * 这里不能出现 bun:sqlite、node:*、DOM 或 JSX：TUI 跑在 Bun 里，GUI 的窗口
 * 进程只有 Solid 和宿主提供的模块，两边唯一安全的交集是纯函数。
 */

export type RangeMode = "monthly" | "weekly" | "daily" | "yearly" | "collapsed"
/** 点击循环顺序：收起放在 Daily 后面 */
export const RANGE_ORDER: readonly RangeMode[] = ["monthly", "weekly", "daily", "collapsed", "yearly"]

export type Settings = {
  range: RangeMode
}

export type MonthlyTotals = {
  input: number
  output: number
  cached: number
  cost: number
}

export type ModelRow = {
  /** 纯 model.id，provider 已经合并掉 —— 换供应商不会裂成两行 */
  modelID: string
  tokens: number
  cost: number
  /** 按 token 降序的 provider 份额，[0] 是主力；合并后用来出标签 */
  providers: Array<{ id: string; tokens: number }>
}

export type UsageSnapshot = {
  label: string
  totals: MonthlyTotals
  models: ModelRow[]
}

export function emptySnapshot(label: string): UsageSnapshot {
  return { label, totals: { input: 0, output: 0, cached: 0, cost: 0 }, models: [] }
}

const INT_FORMATTER = new Intl.NumberFormat("en-US")

export function formatInt(value: number): string {
  return INT_FORMATTER.format(Math.max(0, Math.round(value)))
}

export function formatMoney(value: number): string {
  return `$${Math.max(0, value).toFixed(2)}`
}

/** B/M/K 十进制单位，降序。token 量用。 */
const COMPACT_UNITS: ReadonlyArray<readonly [number, string]> = [
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
]

/** 去掉 toPrecision 补出来的尾随零与孤立小数点：4.788240 -> 4.788，999.0 -> 999 */
function trimZeros(text: string): string {
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text
}

/**
 * 4 位有效数字 + B/M/K 单位，尾数落在 (1, 1000]。
 * 4,788,240 -> "4.788 M"，489,612,004 -> "489.6 M"，999 -> "999"，1001 -> "1.001 K"
 *
 * B 是规格里的最大单位；当前数据量远低于 1e12。
 */
export function formatCompact(value: number): string {
  const v = Math.max(0, value)
  if (!Number.isFinite(v) || v === 0) return "0"
  if (v < 1) return v.toFixed(2)
  if (v <= 1000) return trimZeros(v.toPrecision(4))
  for (let i = 0; i < COMPACT_UNITS.length; i++) {
    const [scale, suffix] = COMPACT_UNITS[i]
    if (v < scale) continue
    const text = trimZeros((v / scale).toPrecision(4))
    if (i > 0 && Number(text) >= 1000) {
      const [upScale, upSuffix] = COMPACT_UNITS[i - 1]
      return `${trimZeros((v / upScale).toPrecision(4))} ${upSuffix}`
    }
    return `${text} ${suffix}`
  }
  return `${trimZeros((v / 1e9).toPrecision(4))} B`
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0")
}

function dayLabel(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/**
 * 周期起点按系统本地时间算（new Date(y,m,d) 即本地零点），UTC+8 自动适配。
 * DB 里的 time_created 是 epoch 毫秒，与时区无关。
 */
export function periodStart(
  mode: Exclude<RangeMode, "collapsed">,
  now = new Date(),
): { label: string; start: number } {
  if (mode === "daily") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    return { label: dayLabel(now), start }
  }
  if (mode === "weekly") {
    // 周一起始（ISO 周）：周日 getDay()=0 视为上周第七天
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    monday.setDate(monday.getDate() - ((now.getDay() + 6) % 7))
    return { label: dayLabel(monday), start: monday.getTime() }
  }
  if (mode === "yearly") {
    const start = new Date(now.getFullYear(), 0, 1).getTime()
    return { label: `${now.getFullYear()}`, start }
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  return { label: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`, start }
}

export function rangeTitle(mode: RangeMode, label: string): string {
  if (mode === "monthly") return `Monthly tokens ${label}`
  if (mode === "weekly") return `Weekly tokens ${label}`
  if (mode === "daily") return `Daily tokens ${label}`
  return `Yearly tokens ${label}`
}

/** 本地时区的 YYYY-MM-DD，和 periodStart 的口径保持一致 */
export function dayKey(epochMs: number): string {
  const d = new Date(epochMs)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/**
 * `providerID/model.id` -> `model.id`。
 *
 * 只切第一段：providerID 本身是纯 slug、不含斜杠，而 model.id 可能自带
 * 斜杠（`vendor/model-name`），从后往前切会切错。
 */
export function modelIdOf(key: string): string {
  const slash = key.indexOf("/")
  return slash < 0 ? key : key.slice(slash + 1)
}

/** `providerID/model.id` -> `providerID`；'unknown' 没有供应商，返回空串 */
export function providerOf(key: string): string {
  const slash = key.indexOf("/")
  return slash < 0 ? "" : key.slice(0, slash)
}

/**
 * Corp ID = model.id 的第 0 段，但**只在 id 自己带斜杠时**才算厂商 ——
 * `space-bunny-free` 是单段，space-bunny 是模型名不是厂商。
 */
function corpOf(modelID: string): string {
  const slash = modelID.indexOf("/")
  return slash < 0 ? "" : modelID.slice(0, slash)
}

/**
 * 标签列表：Corp ID 优先，其次 Provider ID。
 * 同一模型被多个供应商提供时只显示 token 最多的那个，后面跟 `+N`。
 * 返回裸值，由调用方决定怎么摆放：TUI 加方括号，GUI 画成药丸。
 */
export function modelTags(
  modelID: string,
  providers: readonly { id: string; tokens: number }[],
): string[] {
  const top = providers[0]
  const provider =
    top === undefined ? "" : providers.length > 1 ? `${top.id} +${providers.length - 1}` : top.id
  return [corpOf(modelID), provider].filter((tag) => tag !== "")
}

/** `modelTags` 的 TUI 形态：最多两行方括号标签。 */
export function modelTagLines(
  modelID: string,
  providers: readonly { id: string; tokens: number }[],
): [string, string] {
  const tags = modelTags(modelID, providers)
  const cell = (tag: string | undefined) => (tag === undefined ? "" : `[${tag}]`)
  return [cell(tags[0]), cell(tags[1])]
}

/**
 * 有显示名用显示名；没有就用 id 末段推导：
 * `vendor/some-model` -> `Some Model`
 *
 * 目录里的官方名原样直出，不做归一化：`Some-Name` 这类名字里横杠本来就
 * 是产品名的一部分。
 */
export function fallbackModelLabel(modelID: string): string {
  const tail = modelID.split("/").pop() ?? modelID
  return tail
    .split("-")
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ")
}

/** djb2 哈希：同一 model-id 颜色稳定 */
function hashString(input: string): number {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0
  }
  return hash
}

function toHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0")
}

/** 名字行的明度 / 标签行的明度（后者略暗，让名字当视觉锚点） */
const MODEL_NAME_L = 0.58
export const MODEL_TAG_L = 0.45

/**
 * model-id 伪随机色：色相由哈希决定，饱和度/亮度钳在暗色可读区间。
 * HSL -> RGB，S=0.45：色调分散但避开高亮黄绿，明度统一压暗。
 */
export function colorForModel(modelID: string, l = MODEL_NAME_L): string {
  const hue = hashString("1048" + modelID) % 360
  const s = 0.45
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (hue < 60) {
    r = c
    g = x
  } else if (hue < 120) {
    r = x
    g = c
  } else if (hue < 180) {
    g = c
    b = x
  } else if (hue < 240) {
    g = x
    b = c
  } else if (hue < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  return `#${toHex((r + m) * 255)}${toHex((g + m) * 255)}${toHex((b + m) * 255)}`
}

/** 数字在前（与默认 Context 块一致），total 置顶。 */
export function metricLines(totals: MonthlyTotals): Array<{ value: string; label: string }> {
  const total = totals.input + totals.output + totals.cached
  return [
    { value: formatInt(total), label: "total" },
    { value: formatInt(totals.input), label: "input" },
    { value: formatInt(totals.output), label: "output" },
    { value: formatInt(totals.cached), label: "cached" },
    { value: formatMoney(totals.cost), label: "spent" },
  ]
}

/** 存储值可能是旧版本或手改留下的非法值，校验后回落 monthly */
export function normalizeRange(value: unknown): RangeMode {
  return RANGE_ORDER.includes(value as RangeMode) ? (value as RangeMode) : "monthly"
}
