/** @jsxImportSource @opentui/solid */
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type { Store } from "solid-js/store"
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { Database } from "bun:sqlite"
import { homedir } from "node:os"
import { join } from "node:path"
import {
  colorForModel,
  dayKey,
  emptySnapshot,
  fallbackModelLabel,
  formatCompact,
  formatMoney,
  metricLines,
  MODEL_TAG_L,
  modelIdOf,
  modelTagLines,
  normalizeRange,
  periodStart,
  providerOf,
  RANGE_ORDER,
  rangeTitle,
  type RangeMode,
  type Settings,
  type UsageSnapshot,
} from "./core"

const DB_PATH = join(homedir(), ".local", "share", "opencode", "opencode.db")
const MAX_MODEL_ROWS = 7
const STORAGE_KEY = "settings"
/** 已删除会话的指纹，落地保存，跨重启和跨 TUI 实例可见 */
const RETIRED_KEY = "retired"
/** 模型 ID -> 显示名，落地保存。模型下架后目录里查不到，还要靠它出名字 */
const MODEL_NAMES_KEY = "modelNames"
const MAX_RETIRED_ENTRIES = 20_000
const MAX_KNOWN_SESSIONS = 5_000
const MAX_MODEL_NAMES = 2_000

/**
 * 聚合层：一次全量扫描 -> 进程内缓存，之后的每次刷新只扫水位线以上的新行，
 * 切换周期则完全不碰数据库。
 *
 * 为什么需要缓存（实测，几千行 session_message、data 平均十几 KB）：
 *   data 里内嵌了整条消息的 content（正文 + 工具调用），整表可达上百 MB JSON。
 *   json_extract 要把这些 JSON 全部解析一遍，所以
 *     - 每次切到 Monthly/Yearly：两条聚合 SQL 约 800 ms（UI 线程上同步执行）
 *     - 改成单条扁平投影（去掉 GROUP BY 排序）：约 158 ms
 *     - 只扫水位线以上的新行：约 0.1 ms
 *     - 纯内存读一个周期：约 1 us
 *
 * V2 的 schema 与 V1 不同，投影 SQL 按新表重写：
 * - 表：`message` -> `session_message`。V1 的 message 表升级后已停止写入，
 *   新数据只进 session_message。历史数据 V2 已经迁移进新表（两表最早时间戳
 *   一致），只读新表不会丢历史。
 * - role：V1 靠 `json_extract(data,'$.role')`，V2 是一等列 `type`，
 *   取值 assistant/user/compaction/system/synthetic/idle。
 * - model：V1 是扁平字符串 `data.modelID`；V2 是对象
 *   `data.model = { id, providerID, variant }`。这里拼成 `providerID/id`。
 *
 *   这个 key **带 provider** 是有意的：指纹用它，而指纹是落地保存的去重身份。
 *   改成只存 model.id 会让已保存的 retired 指纹全部对不上，那些消息会被
 *   当成「新的」再计一遍。所以 key 不动，聚合时再切掉第一段还原 model.id
 *   （providerID 无斜杠，model.id 可能有，见 modelIdOf）。
 * - tokens / cost / time.created 三个路径未变。
 *
 * 去重：fork 会把 fork 点之前的消息复制一份到新会话（新 id，内容完全一致），
 * 按周期聚合会 double count。去重指纹（7 字段）= 消息逻辑创建时间（毫秒）
 * + model + 5 个 token 分量。
 * - type 不进指纹：WHERE 已限定 assistant。
 * - cost 不进指纹：REAL 浮点不适合做键，组内取 MAX（复制行 cost 一致）。
 * 两次独立调用撞上同一毫秒+同模型+分量全同的概率可忽略；重试/重发是不同
 * 时间发起，不会被误杀。
 *
 * 指纹去重让 fold 幂等，所以增量刷新可以安全回看 OVERLAP_MS 的重叠窗口：
 * 时钟回拨或延迟落库导致的老行漏扫，重扫时会被指纹挡掉，不会重复累加。
 */
const SCAN_SQL = `SELECT
            json_extract(data,'$.time.created') AS tc,
            session_id AS session,
            COALESCE(json_extract(data,'$.model.providerID') || '/' || json_extract(data,'$.model.id'), 'unknown') AS model,
            IFNULL(CAST(json_extract(data,'$.tokens.input') AS INTEGER),0) AS i,
            IFNULL(CAST(json_extract(data,'$.tokens.output') AS INTEGER),0) AS o,
            IFNULL(CAST(json_extract(data,'$.tokens.reasoning') AS INTEGER),0) AS r,
            IFNULL(CAST(json_extract(data,'$.tokens.cache.read') AS INTEGER),0) AS cr,
            IFNULL(CAST(json_extract(data,'$.tokens.cache.write') AS INTEGER),0) AS cw,
            IFNULL(CAST(json_extract(data,'$.cost') AS REAL),0.0) AS cost,
            time_created AS inserted
          FROM session_message
          WHERE type='assistant' AND time_created >= ?`

/**
 * bun:sqlite 的 Statement.all() 返回的是**行对象**（键 = 列别名），不是数组：
 *   stmt.all("baz") // => [{ bar: "baz" }]
 * 所以下面全部按列名取值。写成元组解构会拿到一串 undefined，
 * 曾经因此让缓存静默建空、面板全是 0。
 */
type ScanRow = {
  tc: number
  session: string
  model: string
  i: number
  o: number
  r: number
  cr: number
  cw: number
  cost: number
  inserted: number
}

/** 去重后的一个分组。token 分量必须逐项留着，reindex 要靠它们还原 4 个口径。 */
type Group = {
  /** 指纹，作为 Map 的键时冗余存一份，retire 时要按它搬移 */
  fp: string
  /** 首次认领这条消息的会话。仅用于诊断和 knownSessions，不参与去重判断。 */
  session: string
  day: string
  model: string
  i: number
  o: number
  r: number
  cr: number
  cw: number
  cost: number
}

/** 落地保存的形态。条目是「已经从数据库里消失的指纹」。 */
type RetiredState = {
  entries: Group[]
  /** 见过的会话 id。冷启动时用它报告「面板没开着的时候有会话被删了」。 */
  knownSessions: string[]
}

/** 落地保存的模型名缓存。数组而不是 Record：storage 里读起来直观，顺序也可控。 */
type ModelNameState = {
  names: Array<{ id: string; name: string }>
}

/** 按天聚合的派生索引，切换周期时只读它 */
type ModelBucket = {
  tokens: number
  cost: number
  /** provider -> tokens。同一 model.id 可能被多个供应商提供，主力靠它选 */
  providers: Map<string, number>
}

type DayTotals = {
  input: number
  output: number
  cached: number
  cost: number
  models: Map<string, ModelBucket>
}

let groups = new Map<string, Group>()
/** 已从数据库消失、但确认已经产生过花费的指纹。落地保存，永久计入。 */
const retired = new Map<string, Group>()
/** 见过的会话 id，用来在冷启动时判断「面板没开着的时候有会话被删了」。 */
const knownSessions = new Set<string>()
/** 由 setup() 注入，把 retired / knownSessions 写回 storage */
let persistRetired: (() => void) | undefined
let byDay = new Map<string, DayTotals>()
/** 已消费到的最大 time_created，只增不减 */
let watermark = 0
/** 上次扫描的失败原因。非空时面板显示错误，而不是假装没有用量。 */
let lastError: string | undefined
const OVERLAP_MS = 300_000

/**
 * 把一行折进指纹表，并返回需要累加进按天索引的分组。
 * 重复指纹返回 null —— 只可能抬 cost，此时返回一条仅含 cost 差额的记录。
 * 指纹去重让这个函数可重复调用，所以增量扫描可以安全回看重叠窗口。
 *
 * 指纹去重还**顺带挡掉了 fork 副本**，这是承重逻辑，改动前先读这段：
 *
 * - session_v2 虽有 fork_session_id / fork_boundary 两列，实际全是 NULL，
 *   所以没法按「是不是 fork 出来的」过滤，只能靠指纹。
 * - 实测有互为副本的会话，assistant 消息字节完全相同（`length(data)` 一致），
 *   仅 session_message.id 不同；全库有相当比例的指纹对应多行。
 * - 折掉的是 fork 继承的那段前缀，语义上正确：钱在父会话已经花过一遍。
 *   不折的话总额会明显偏高。
 * - **脆弱点**：上面能生效，完全依赖「副本字节相同、time.created 不变」。
 *   如果哪天 V2 的 fork 改成给副本盖新时间戳，继承的那部分会静默翻倍。
 *   而且这套 A/B 验证抓不到 —— 参考 SQL 用的是同一个 GROUP BY，两边一起折叠。
 *   真要防，得改成按「消息的稳定 id」去重，而不是按时间戳+token 组合。
 *
 * 删除会话不受影响：那是硬删，session_message 行被物理移除（两个表
 * session / session_v2 都查过了，assistant 消息孤儿数为 0），无需过滤。
 * 归档是软隐藏（time_archived），当前 0 个；有的话会被计入，这是有意为之 ——
 * token 确实花了，归档只是不显示。
 */
/** 消息身份：tc + model + 5 个 token 分量。逐字段拼，不用 JSON 序列化以免键序漂移。 */
function fingerprintOf(row: ScanRow): string {
  return `${row.tc}|${row.model}|${row.i}|${row.o}|${row.r}|${row.cr}|${row.cw}`
}

function toGroup(fp: string, row: ScanRow): Group {
  return {
    fp,
    session: row.session,
    day: dayKey(row.tc),
    model: row.model,
    i: row.i,
    o: row.o,
    r: row.r,
    cr: row.cr,
    cw: row.cw,
    cost: row.cost,
  }
}

function ingest(row: ScanRow): Group | null {
  const { tc, cost } = row
  if (typeof tc !== "number") return null
  const fp = fingerprintOf(row)
  const existing = groups.get(fp)
  if (existing) {
    if (cost <= existing.cost) return null
    const delta = cost - existing.cost
    existing.cost = cost
    return {
      fp,
      session: existing.session,
      day: existing.day,
      model: existing.model,
      i: 0,
      o: 0,
      r: 0,
      cr: 0,
      cw: 0,
      cost: delta,
    }
  }
  const group = toGroup(fp, row)
  groups.set(fp, group)
  knownSessions.add(row.session)
  return group
}

/** 把一个分组累加进按天索引。O(1)，与已有数据量无关。 */
function accumulate(group: Group): void {
  let day = byDay.get(group.day)
  if (!day) {
    day = { input: 0, output: 0, cached: 0, cost: 0, models: new Map() }
    byDay.set(group.day, day)
  }
  day.input += group.i
  day.output += group.o + group.r
  day.cached += group.cr + group.cw
  day.cost += group.cost
  const tokens = group.i + group.o + group.r + group.cr + group.cw

  // 按 model.id 归档，不按 provider 归档：换供应商只换账本，不换模型。
  const modelID = modelIdOf(group.model)
  let bucket = day.models.get(modelID)
  if (!bucket) {
    bucket = { tokens: 0, cost: 0, providers: new Map() }
    day.models.set(modelID, bucket)
  }
  bucket.tokens += tokens
  bucket.cost += group.cost
  const provider = providerOf(group.model)
  if (provider !== "") bucket.providers.set(provider, (bucket.providers.get(provider) ?? 0) + tokens)
}

/** 由指纹表全量重建按天索引。groups 优先，retired 里已复活的指纹不重复计入。 */
function reindex(): void {
  byDay = new Map<string, DayTotals>()
  for (const group of groups.values()) accumulate(group)
  for (const [fp, group] of retired) {
    if (!groups.has(fp)) accumulate(group)
  }
}

/**
 * 全量重扫，并把「上一轮见过、这一轮消失」的指纹搬进 retired。
 *
 * 这是删除不再丢数的**唯一**依据，也是 fork 安全的关键：
 * 父会话被删、fork 子会话还留着同样的副本时，这些指纹仍然在 groups 里，
 * 因此不会被 retire —— 总额不变，不会因为「父会话的账要保留」而翻倍。
 * 反过来，fork 被删而父会话还在，同理不丢。
 * 只有当某条消息的**所有**副本都消失时，它才会进 retired。
 *
 * 代价是一次全量扫描。删除是低频操作，值得。
 */
function sweepRetired(): void {
  let db: Database | null = null
  try {
    db = new Database(DB_PATH, { readonly: true })
    const rows = db.query(SCAN_SQL).all(0) as ScanRow[]

    const next = new Map<string, Group>()
    let maxInserted = 0
    for (const row of rows) {
      const fp = fingerprintOf(row)
      if (next.has(fp)) continue
      next.set(fp, toGroup(fp, row))
      knownSessions.add(row.session)
      const inserted = row.inserted
      if (typeof inserted === "number" && inserted > maxInserted) maxInserted = inserted
    }

    for (const [fp, group] of groups) {
      if (!next.has(fp)) retired.set(fp, group)
    }
    // 会话被恢复/重新导入时，指纹回到 groups，retired 里那份必须让位
    for (const fp of next.keys()) retired.delete(fp)

    // 上一轮见过、这一轮整条都不在数据库里的会话：它们在面板没跑的时候被删了。
    // 这些会话的指纹从来没进过 retired，补不回来，只能如实报出来，别假装没发生。
    const live = new Set<string>()
    for (const group of next.values()) live.add(group.session)
    const vanishedWhileOffline = [...knownSessions].filter((id) => !live.has(id))
    if (vanishedWhileOffline.length > 0) {
      console.warn(
        `[token-usage] ${vanishedWhileOffline.length} session(s) were deleted while ` +
          `the panel was not running; their usage cannot be recovered`,
      )
    }

    groups = next
    watermark = maxInserted
    // 只保留还活着的会话，避免同一条告警每次启动都重报
    knownSessions.clear()
    for (const id of live) knownSessions.add(id)
    trimRetired()
    reindex()
    persistRetired?.()
    lastError = undefined
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
    console.error(`[token-usage] retire sweep failed: ${lastError}`)
  } finally {
    try {
      db?.close()
    } catch {
      // ignore
    }
  }
}

/** retired 无上限增长会撑爆 storage，按 Map 插入序丢最老的。 */
function trimRetired(): void {
  if (retired.size <= MAX_RETIRED_ENTRIES) return
  const drop = retired.size - MAX_RETIRED_ENTRIES
  let n = 0
  for (const fp of retired.keys()) {
    if (n++ >= drop) break
    retired.delete(fp)
  }
  console.warn(`[token-usage] retired set capped, dropped ${drop} oldest fingerprints`)
}

/** 扫描并把新行折进缓存。首次全量，之后只扫水位线以上。 */
function refreshCache(): void {
  let db: Database | null = null
  try {
    db = new Database(DB_PATH, { readonly: true })
    const from = watermark > 0 ? Math.max(0, watermark - OVERLAP_MS) : 0
    const rows = db.query(SCAN_SQL).all(from) as ScanRow[]
    for (const row of rows) {
      // 增量路径是 O(新增行数)：指纹表挡掉重复，按天索引就地累加，
      // 不再全量重建，所以刷新耗时不随历史消息量增长。
      const delta = ingest(row)
      if (delta) accumulate(delta)
      const inserted = row.inserted
      if (typeof inserted === "number" && inserted > watermark) watermark = inserted
    }
    lastError = undefined
  } catch (error) {
    // 以前这里只有一句注释，于是缓存建空时面板会显示一片 0，看起来像
    // 「真的没有用量」。失败必须显式暴露，不能伪装成数据。
    lastError = error instanceof Error ? error.message : String(error)
    console.error(`[token-usage] usage scan failed: ${lastError}`)
  } finally {
    try {
      db?.close()
    } catch {
      // ignore
    }
  }
}

/**
 * 冷启动校准。
 *
 * 指纹表和按天索引都是**进程内**状态，进程一起来就是空的，所以首次扫描
 * 天然是全量 —— 这就是校准。走 sweepRetired 而不是裸扫描，是为了顺带把
 * 「已落地保存、但会话又回来了」的指纹从 retired 里摘掉，避免重复计入。
 *
 * retired 本身在 setup() 里已经从 storage 装入，这里**绝不清空它** ——
 * 它是删除了的会话唯一的账，清了就真没了。
 *
 * 延续之前的取舍：首次渲染时才跑，而不是塞进 setup()，这样侧边栏被隐藏时
 * 不白付一次全量扫描。
 */
let calibrated = false
function calibrate(): void {
  if (calibrated) return
  calibrated = true
  sweepRetired()
}

/** 纯内存读一个周期，不碰数据库。跨天/跨周的口径在读取时才计算，无需刷新。 */
function snapshotFromCache(mode: Exclude<RangeMode, "collapsed">): UsageSnapshot {
  const { label, start } = periodStart(mode)
  const from = dayKey(start)
  const snap = emptySnapshot(label)
  const perModel = new Map<string, ModelBucket>()
  for (const [day, totals] of byDay) {
    // YYYY-MM-DD 定长可比，字典序即时间序
    if (day < from) continue
    snap.totals.input += totals.input
    snap.totals.output += totals.output
    snap.totals.cached += totals.cached
    snap.totals.cost += totals.cost
    for (const [modelID, bucket] of totals.models) {
      let target = perModel.get(modelID)
      if (!target) {
        target = { tokens: 0, cost: 0, providers: new Map() }
        perModel.set(modelID, target)
      }
      target.tokens += bucket.tokens
      target.cost += bucket.cost
      // provider 份额同样跨天累加，主力 provider 按整个周期算，而不是按最后一天
      for (const [provider, tokens] of bucket.providers) {
        target.providers.set(provider, (target.providers.get(provider) ?? 0) + tokens)
      }
    }
  }
  snap.models = [...perModel.entries()]
    .map(([modelID, bucket]) => ({
      modelID,
      tokens: bucket.tokens,
      cost: bucket.cost,
      providers: [...bucket.providers.entries()]
        .map(([id, tokens]) => ({ id, tokens }))
        .sort((a, b) => b.tokens - a.tokens),
    }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, MAX_MODEL_ROWS)
  return snap
}

/**
 * 模型显示名。
 *
 * 数据库里只存 `{ id, providerID, variant }`，没有可读名字，显示名要向
 * `GET /api/model`（插件里是 `context.client.model.list()`）取。但那只覆盖
 * **当前上架**的模型 —— 历史用量里已经下架的查不到，面板上就只能靠
 * 下面这份缓存兜底。
 *
 * 所以名字既不能只靠目录，也不能只活在进程里：这里维护 ID -> 显示名 的
 * **只增不减**缓存，并落地保存（MODEL_NAMES_KEY）。目录里查到的名字会覆盖
 * 旧值（改名要跟上），但**永远不删** —— 模型下架、换供应商、目录暂时拉
 * 失败，都还能显示上次确认过的名字。真查不到才退回由 id 推导。
 *
 * 键是纯 model.id，不是 `providerID/id`：同一个模型换供应商后 id 不变，
 * 名字应该跟着模型走，而不是跟着账本走。
 */
let modelNames = new Map<string, string>()
let namesFetch: Promise<void> | null = null
/** 由 setup() 注入，把 modelNames 写回 storage */
let persistModelNames: (() => void) | undefined

/**
 * 拉一次模型目录，把 id -> 显示名**合并**进缓存。
 *
 * 合并而不是替换，就是「下架后还有名字」的全部实现：替换会把已经消失的
 * 模型从缓存里抹掉，下次渲染就只能退化到 id 推导。
 *
 * 同一 id 可能被多个供应商同时上架，而且**名字不保证一致**（同一模型在不同
 * 供应商目录里写法可能不同）。按 providerID 排序后再逐条覆盖，赢家因此是
 * 确定的 —— 目录顺序变了、某次请求少返回一个 provider，都不会让面板上的
 * 名字跟着跳。
 */
function ensureModelNames(client: Context["client"]): Promise<void> {
  if (!namesFetch) {
    namesFetch = client.model
      .list()
      .then((res) => {
        const entries = [...res.data].sort((a, b) =>
          a.providerID === b.providerID ? 0 : a.providerID < b.providerID ? -1 : 1,
        )
        let changed = false
        for (const info of entries) {
          const name = info.name?.trim()
          if (!name) continue
          if (modelNames.get(info.id) === name) continue
          modelNames.set(info.id, name)
          changed = true
        }
        if (changed) {
          trimModelNames()
          persistModelNames?.()
        }
      })
      .catch((error: unknown) => {
        // 失败不致命：缓存里的旧名字和 id 推导都还能用；清掉 promise 让下次能重试
        console.error(`[token-usage] model list failed: ${error}`)
        namesFetch = null
      })
  }
  return namesFetch
}

/** 无上限增长会撑爆 storage，按插入序丢最老的（目录一年也就多几十个）。 */
function trimModelNames(): void {
  if (modelNames.size <= MAX_MODEL_NAMES) return
  const drop = modelNames.size - MAX_MODEL_NAMES
  let n = 0
  for (const id of modelNames.keys()) {
    if (n++ >= drop) break
    modelNames.delete(id)
  }
  console.warn(`[token-usage] model name cache capped, dropped ${drop} oldest ids`)
}

/**
 * 有显示名用显示名；没有就用 id 末段推导：vendor/some-model -> Some Model
 *
 * 目录里的官方名原样直出，不做归一化：试过把横杠全换成空格，但 GPT-6 Luna
 * 这类名字里横杠本来就是产品名的一部分（GPT-6），替掉反而错了。
 */
function modelLabel(modelID: string): string {
  return modelNames.get(modelID) ?? fallbackModelLabel(modelID)
}

function View(props: {
  context: Context
  settings: Store<Settings>
  updateSettings: (mutation: (draft: Settings) => void) => Promise<void>
}) {
  const theme = () => props.context.theme
  const initialMode = normalizeRange(props.settings.range)
  const [mode, setMode] = createSignal<RangeMode>(initialMode)

  // 冷启动校准：进程内状态是空的，所以这一次是全量扫描；之后只扫新增行
  calibrate()
  const [snapshot, setSnapshot] = createSignal<UsageSnapshot>(
    initialMode === "collapsed" ? emptySnapshot("") : snapshotFromCache(initialMode),
  )

  // usage 事件每一步都会触发，直接同步重扫会跟着抖；合并到一个短窗口里。
  const REFRESH_DEBOUNCE_MS = 400
  let pending: ReturnType<typeof setTimeout> | undefined
  const refresh = () => {
    // 缓存始终保持最新，即使当前是收起状态，这样展开时无需再查库
    refreshCache()
    const current = mode()
    if (current === "collapsed") return
    setSnapshot(snapshotFromCache(current))
  }
  const scheduleRefresh = () => {
    if (pending !== undefined) clearTimeout(pending)
    pending = setTimeout(() => {
      pending = undefined
      refresh()
    }, REFRESH_DEBOUNCE_MS)
  }

  /** 点击标题循环切换：Monthly -> Weekly -> Daily -> 收起 -> Yearly -> Monthly
   * 用 onMouseDown 而不用 onMouseUp：up 会被 renderer 的选区流程吃掉
   *（up + currentSelection.isDragging -> finishSelection + return），短标题行
   * 必中 text 建选区，导致要点两次；down 建完选区仍会正常分发，一次即触发。
   *
   * 切换只读缓存，不碰数据库 —— 这是加缓存的主要目的。
   */
  const cycle = (event: any) => {
    // 只响应左键，避免右键/滚轮误触
    if (event != null && typeof event.button === "number" && event.button !== 0) return
    if (event != null && typeof event.preventDefault === "function") event.preventDefault()
    const next = RANGE_ORDER[(RANGE_ORDER.indexOf(mode()) + 1) % RANGE_ORDER.length]
    setMode(next)
    void props.updateSettings((draft) => {
      draft.range = next
    })
    if (next !== "collapsed") setSnapshot(snapshotFromCache(next))
    if (event != null && typeof event.stopPropagation === "function") event.stopPropagation()
  }

  // V1 监听的是 "message.updated"，V2 没有对应事件：usage 变化改用
  // session.usage.updated，会话空闲仍用 session.idle。
  const offIdle = props.context.data.on("session.idle", scheduleRefresh)
  const offUsage = props.context.data.on("session.usage.updated", scheduleRefresh)

  /**
   * 会话被删除 → 全量重扫并把消失的指纹搬进 retired。
   *
   * 不能只靠事件载荷把「这个会话的总量」加进 retired：session.usage.updated
   * 和 session_v2 的计数器都是**按会话累计**的，fork 出来的子会话会把继承的
   * 前缀再算一遍。按会话加会重复计入。
   * 只有「指纹是否还存在于数据库」这个判断是 fork 安全的。
   *
   * 删除是低频操作，合并 300ms 再扫，连删多个只扫一次。
   */
  let sweepTimer: ReturnType<typeof setTimeout> | undefined
  const scheduleSweep = () => {
    if (sweepTimer !== undefined) clearTimeout(sweepTimer)
    sweepTimer = setTimeout(() => {
      sweepTimer = undefined
      sweepRetired()
      const current = mode()
      if (current !== "collapsed") setSnapshot(snapshotFromCache(current))
    }, 300)
  }
  const offDeleted = props.context.data.on("session.deleted", scheduleSweep)

  // 显示名是异步拉的，先用 id 推导顶上，落地后重算标签。
  // model.updated 在 V2Event union 里，目录变了就重新拉一次。
  const [nameVersion, setNameVersion] = createSignal(0)
  const reloadNames = () => {
    namesFetch = null
    void ensureModelNames(props.context.client).then(() => setNameVersion((v) => v + 1))
  }
  void ensureModelNames(props.context.client).then(() => setNameVersion((v) => v + 1))
  const offModel = props.context.data.on("model.updated", reloadNames)
  onCleanup(() => {
    if (pending !== undefined) clearTimeout(pending)
    if (sweepTimer !== undefined) clearTimeout(sweepTimer)
    offIdle()
    offUsage()
    offDeleted()
    offModel()
  })

  const usage = createMemo(() => snapshot())
  const modelColor = createMemo(() => {
    const map = new Map<string, string>()
    for (const row of usage().models) {
      if (!map.has(row.modelID)) map.set(row.modelID, colorForModel(row.modelID))
    }
    return map
  })
  const modelTagColor = createMemo(() => {
    const map = new Map<string, string>()
    for (const row of usage().models) {
      if (!map.has(row.modelID)) map.set(row.modelID, colorForModel(row.modelID, MODEL_TAG_L))
    }
    return map
  })
  // 每次返回新的 Map：solid 的 memo 对相同引用不通知下游，
  // 而 modelNames 是模块级普通变量、不会自己触发响应式，所以靠这个新引用
  // 把 nameVersion 的变化传导到文本节点。
  const modelLabels = createMemo(() => {
    nameVersion()
    const map = new Map<string, string>()
    for (const row of usage().models) map.set(row.modelID, modelLabel(row.modelID))
    return map
  })

  return (
    <box>
      <box onMouseDown={cycle}>
        <Show
          when={mode() !== "collapsed"}
          fallback={<text selectable={false} fg={theme().text.muted}>{`▶ Token usage`}</text>}
        >
          <text selectable={false} fg={theme().text.base}>
            <b>{rangeTitle(mode(), usage().label)}</b>
          </text>
        </Show>
      </box>
      <Show when={mode() !== "collapsed"}>
        <Show
          when={lastError === undefined}
          fallback={
            <text selectable={false} fg={theme().text.muted}>
              {`usage unavailable: ${lastError}`}
            </text>
          }
        >
          <For each={metricLines(usage().totals)}>
            {(row) => <text fg={theme().text.muted}>{`${row.value} ${row.label}`}</text>}
          </For>
        </Show>
        <Show when={lastError === undefined && usage().models.length > 0}>
          <text>{" "}</text>
          <text fg={theme().text.base}>
            <b>Top models</b>
          </text>
          <For each={usage().models}>
            {(row) => {
              const fg = modelColor().get(row.modelID) ?? theme().text.base
              const dim = modelTagColor().get(row.modelID) ?? theme().text.muted
              const [tagLine2, tagLine3] = modelTagLines(row.modelID, row.providers)
              return (
                <box flexDirection="column">
                  <text fg={fg}>{modelLabels().get(row.modelID) ?? row.modelID}</text>
                  {/* 右栏靠 space-between 顶到同一右边缘，不用手算宽度 */}
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={dim}>{tagLine2}</text>
                    <text fg={dim}>{`${formatCompact(row.tokens)} tokens`}</text>
                  </box>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={dim}>{tagLine3}</text>
                    <text fg={dim}>{formatMoney(row.cost)}</text>
                  </box>
                </box>
              )
            }}
          </For>
        </Show>
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "opencode-token-usage",
  setup(context) {
    const [settings, updateSettings] = context.storage.store<Settings>(STORAGE_KEY, {
      initial: { range: "monthly" },
    })

    // 已删除会话的账。storage.store 是落地 JSON，且跨 TUI 实例实时同步，
    // 所以一个实例删了会话，另一个实例也能看到同一份 retired。
    const [retiredState, updateRetired] = context.storage.store<RetiredState>(RETIRED_KEY, {
      initial: { entries: [], knownSessions: [] },
    })
    for (const entry of retiredState.entries ?? []) retired.set(entry.fp, entry)
    for (const id of retiredState.knownSessions ?? []) knownSessions.add(id)

    persistRetired = () => {
      // 只存 map 里的值；knownSessions 只要最近的一段
      const entries = [...retired.values()].slice(-MAX_RETIRED_ENTRIES)
      const sessions = [...knownSessions].slice(-MAX_KNOWN_SESSIONS)
      void updateRetired((draft) => {
        draft.entries = entries
        draft.knownSessions = sessions
      }).catch((error: unknown) => {
        console.error(`[token-usage] failed to persist retired set: ${error}`)
      })
    }

    // 模型名缓存同样落地：模型下架后目录里就没有它了，名字只能靠这份历史。
    // 在 setup 里同步装入，保证首帧渲染就能用上，不会先闪一下 id 推导的名字。
    const [nameState, updateModelNames] = context.storage.store<ModelNameState>(MODEL_NAMES_KEY, {
      initial: { names: [] },
    })
    for (const entry of nameState.names ?? []) {
      if (entry?.id && entry.name) modelNames.set(entry.id, entry.name)
    }
    persistModelNames = () => {
      const names = [...modelNames.entries()]
        .slice(-MAX_MODEL_NAMES)
        .map(([id, name]) => ({ id, name }))
      void updateModelNames((draft) => {
        draft.names = names
      }).catch((error: unknown) => {
        console.error(`[token-usage] failed to persist model names: ${error}`)
      })
    }
    // V1 用 order: 400 挤在 LSP 与 files 之间；V2 的 slot 只按锚点排序，
    // 没有 order 概念，改为追加到 sidebar.content 末尾。
    return context.ui.slot({
      append: "sidebar.content",
      render: () => <View context={context} settings={settings} updateSettings={updateSettings} />,
    })
  },
})
