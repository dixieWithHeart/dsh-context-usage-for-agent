/**
 * dsh-context-usage — 让 Agent 和用户都能看到当前上下文占用
 *
 * Host 半。三件事：
 *   1. context_usage 工具：Agent 主动查询
 *   2. 每轮自动一行读数（本回合第一次工具调用前，steer / inject）
 *   3. 设置页的数据与写入路由（/api/dsh-context-usage/{state,set}），供 client.js 使用
 *
 * 状态来源：ctx.sessionProjections 投影单元（官方 practices 要求——日志派生的每会话状态
 * 不订阅 session/event 自行累加）。pressureTokens 口径与 DSH 内部一致：
 * 未缓存输入 + 缓存读 + 缓存写（不含输出）。
 *
 * @module @local/dsh-context-usage-for-agent
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Loader identity for this plugin entry. */
export const name = 'context-usage-for-agent'

/** 依赖的服务：工具注册表 + 会话投影注册表。 */
export const inject = ['tools', 'sessionProjections']

const VERSION = '0.5.1'
const PROJECTION_KEY = 'contextUsage'
const SETTINGS_FILENAME = 'dsh-context-usage.json'

/** 默认注入模板，与 0.4.0 的固定文案保持等价。 */
const DEFAULT_TEMPLATE = '[ctx {percent}%] {used}/{window} · 缓存 {cache}% · 余 {remaining}'

const DEFAULTS = {
  enabled: true,
  /** model 上下文窗口的兜底值；request/context 到达后以 provider 上报为准。 */
  contextWindow: 1000000,
  injectPerTurn: true,
  /** 注入文案模板，用 {占位符} 取数。空串表示不注入。 */
  template: DEFAULT_TEMPLATE,
  /** 若确知 DSH 自动压缩阈值（0..1），设置页可填；null 表示不显示。 */
  compactAtRatio: null,
}

/** 模板长度上限：防手滑贴进一整段文档。 */
const MAX_TEMPLATE_LENGTH = 500

/** 模板里可用的全部占位符，供设置页展示与校验。 */
const PLACEHOLDERS = [
  ['percent', '上下文用量百分比，如 17.7'],
  ['used', '已用 token，带单位，如 177k'],
  ['usedRaw', '已用 token 的原始数字，如 177164'],
  ['window', '上下文总长度，带单位，如 1.00M'],
  ['windowRaw', '上下文总长度的原始数字'],
  ['remaining', '剩余可用 token，带单位'],
  ['remainingRaw', '剩余可用 token 的原始数字'],
  ['cache', '缓存命中率百分比，如 99.4'],
  ['turn', '当前回合号'],
  ['compact', '距自动压缩还有几个百分点（需配置 compactAtRatio，未配置时为 ?）'],
]

// ── 设置文件 ────────────────────────────────────────────────────────────────
// Host 行给的 config 是启动默认值；用户在设置页改的值落在这个文件里，优先级更高。

function settingsPath () {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, SETTINGS_FILENAME)
}

function sanitize (raw, base) {
  const o = { ...base }
  if (!raw || typeof raw !== 'object') return o
  if (typeof raw.enabled === 'boolean') o.enabled = raw.enabled
  if (typeof raw.injectPerTurn === 'boolean') o.injectPerTurn = raw.injectPerTurn
  if (typeof raw.template === 'string') {
    const t = raw.template.slice(0, MAX_TEMPLATE_LENGTH)
    // 允许空串：等于「不注入」。是否真的注入由 injectPerTurn 与模板空值共同决定。
    o.template = t
  }
  if (typeof raw.contextWindow === 'number' && Number.isFinite(raw.contextWindow) && raw.contextWindow > 0) {
    o.contextWindow = raw.contextWindow
  }
  if (raw.compactAtRatio === null) o.compactAtRatio = null
  else if (typeof raw.compactAtRatio === 'number' && raw.compactAtRatio > 0 && raw.compactAtRatio <= 1) {
    o.compactAtRatio = raw.compactAtRatio
  }
  return o
}

function loadSettings (log, defaults) {
  try {
    const file = settingsPath()
    if (!fs.existsSync(file)) return { ...defaults }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return sanitize(parsed, defaults)
  } catch (e) {
    log.warn(`settings load failed: ${e && e.message ? e.message : e}`)
    return { ...defaults }
  }
}

function saveSettings (log, settings) {
  try {
    const file = settingsPath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(settings, null, 2))
    return true
  } catch (e) {
    log.warn(`settings save failed: ${e && e.message ? e.message : e}`)
    return false
  }
}

/** 配置合并 + 明显错误的 fail-loud。 */
function resolveOptions (raw) {
  if (raw !== undefined && (raw === null || typeof raw !== 'object' || Array.isArray(raw))) {
    throw new TypeError('context-usage: config must be a mapping')
  }
  const o = { ...DEFAULTS, ...(raw || {}) }
  if (typeof o.contextWindow !== 'number' || !Number.isFinite(o.contextWindow) || o.contextWindow <= 0) {
    throw new TypeError('context-usage: contextWindow must be a positive number')
  }
  return o
}

/**
 * 造一条能被 harness 当成 user 消息接收的对象。
 * source.kind 必须写全（v4 会话格式拒绝退化的 plugin kind），否则投递会静默崩。
 */
async function buildNoticeMessage (text, detail) {
  const source = { kind: 'plugin:dsh-context-usage', form: 'notice', ...(detail ? { summary: detail } : {}) }
  const content = [{ type: 'text', text }]
  try {
    const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
    if (typeof createUserMessage === 'function') return createUserMessage({ content, source })
  } catch { /* 宿主可能不为插件解析该包，下面的等价兜底 */ }
  return {
    id: `ctxu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content,
    source,
  }
}

const kTok = (n) => {
  if (!Number.isFinite(n)) return '?'
  if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 2) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k'
  return String(Math.round(n))
}

const PLACEHOLDER_RE = /\{([A-Za-z][A-Za-z0-9]*)\}/g

/**
 * 把模板里的 {占位符} 换成实际值。
 * 未知占位符**原样保留**——这样用户在预览里一眼就能看到自己拼错了，而不是被悄悄吞掉。
 * 已知但暂无值的占位符显示 `?`。
 */
function renderTemplate (template, snap) {
  const values = {
    percent: snap.percent,
    used: kTok(snap.pressureTokens),
    usedRaw: snap.pressureTokens,
    window: kTok(snap.contextWindow),
    windowRaw: snap.contextWindow,
    remaining: kTok(snap.remainingTokens),
    remainingRaw: snap.remainingTokens,
    cache: snap.cacheHitPercent,
    turn: snap.turn,
    compact: snap.percentToCompact,
  }
  return template.replace(PLACEHOLDER_RE, (whole, key) => {
    if (!Object.hasOwn(values, key)) return whole
    const v = values[key]
    return v === null || v === undefined ? '?' : String(v)
  })
}

/**
 * 投影单元的状态 schema。
 * 宿主只调用 `.parse()`（schemastery 风格）；本包可以 import schemastery，
 * 但为一个仅做形状校验的字段引入依赖不值得，故手写最小实现。
 */
const stateSchema = {
  parse (value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('context-usage: projection state must be a plain object')
    }
    return value
  },
}

export function apply (ctx, config) {
  const log = ctx.logger('context-usage')
  const options = resolveOptions(config)
  let settings = loadSettings(log, options)
  if (!settings.enabled) {
    log.info('disabled by saved settings')
  }

  // `export const inject` 声明了依赖，这里再做一次运行时检查：服务缺席时降级而不是抛错。
  const projections = ctx.sessionProjections
  if (!projections) {
    log.warn('sessionProjections service unavailable: projection not registered, context_usage will report ok:false')
  }

  const initialState = () => ({
    pressureTokens: null,
    lastUsage: null,
    contextWindow: settings.contextWindow,
    windowSource: 'config',
    turn: null,
  })

  const projection = {
    key: PROJECTION_KEY,
    stateVersion: 1,
    stateSchema,
    init: () => initialState(),
    /** 纯同步折叠。与本单位无关的事件必须返回同一引用。 */
    apply: (state, event) => {
      if (event === null || typeof event !== 'object') return state
      if (event.type === 'turn/start') {
        const t = event.data && event.data.turn
        if (typeof t !== 'number' || t === state.turn) return state
        return { ...state, turn: t }
      }
      if (event.type === 'request/context') {
        const w = event.data && event.data.contextWindow
        if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0) return state
        if (w === state.contextWindow && state.windowSource === 'provider') return state
        return { ...state, contextWindow: w, windowSource: 'provider' }
      }
      if (event.type === 'assistant/message') {
        const u = event.data && event.data.usage
        if (!u || typeof u !== 'object') return state
        const p = (u.inputTokens || 0) + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0)
        if (!(p > 0)) return state
        return { ...state, pressureTokens: p, lastUsage: u }
      }
      return state
    },
  }

  ctx.effect(() => {
    if (!projections) return () => {}
    return projections.register(projection)
  })

  /** 最近一个走过工具调用的会话，供 HTTP 路由读取实时状态。 */
  let lastSession = null

  const stateOf = (session) => {
    if (!projections || !session) return initialState()
    try {
      const s = projections.stateOf(session, PROJECTION_KEY)
      if (!s) return initialState()
      // 兜底窗口以当前设置为准：投影单元只在 init 时读过一次，设置页改完值不会重建 cell，
      // 不回填会导致「改了窗口但注入文案还显示旧窗口」。
      return s.windowSource === 'config' ? { ...s, contextWindow: settings.contextWindow } : s
    } catch (e) {
      log.warn(`projection read failed: ${e && e.message ? e.message : e}`)
      return initialState()
    }
  }

  const percentOf = (state) => {
    if (!state.pressureTokens || !state.contextWindow) return null
    return Math.round((state.pressureTokens / state.contextWindow) * 1000) / 10
  }

  const snapshotOf = (state) => {
    const pct = percentOf(state)
    const u = state.lastUsage
    const cacheDenom = u ? (u.inputTokens || 0) + (u.cacheReadTokens || 0) : 0
    const cacheHit = u && cacheDenom > 0
      ? Math.round((u.cacheReadTokens || 0) / cacheDenom * 1000) / 10
      : null
    const percentToCompact = settings.compactAtRatio !== null && typeof pct === 'number'
      ? Math.round((settings.compactAtRatio * 100 - pct) * 10) / 10
      : null
    return {
      pressureTokens: state.pressureTokens,
      contextWindow: state.contextWindow,
      windowSource: state.windowSource,
      percent: pct,
      remainingTokens: state.pressureTokens && state.contextWindow
        ? state.contextWindow - state.pressureTokens
        : null,
      compactAtRatio: settings.compactAtRatio,
      percentToCompact,
      lastUsage: state.lastUsage,
      cacheHitPercent: cacheHit,
      turn: state.turn || null,
    }
  }

  /**
   * 按用户模板生成注入文案；模板为空或还没有 usage 时返回 null（不注入）。
   * 缓存命中率不再单独开关——要不要写进文案由模板决定。
   */
  const renderLine = (state) => {
    if (!settings.template) return null
    const snap = snapshotOf(state)
    if (snap.pressureTokens === null) return null
    return renderTemplate(settings.template, snap)
  }

  /**
   * 设置页用的注入预览。
   * 这个插件的定位是「让 Agent 能读上下文」，用户侧的占用显示由聊天框下方承担，
   * 所以这里不返回占用容量，只说明注入什么、最近注入了什么。
   */
  const injectPayload = () => {
    const state = stateOf(lastSession)
    return {
      active: settings.enabled && settings.injectPerTurn && Boolean(settings.template),
      hasSession: Boolean(lastSession),
      lastLine: lastInjectedText,
      lastTurn: injectedTurn,
      /** 按当前设置与当前会话数据会生成的句子；还没有 provider 数据时为 null。 */
      sampleLine: renderLine(state),
    }
  }

  // ── 每轮自动附加读数 ────────────────────────────────────────────────────
  /** 已注入过的回合号；同时供设置页显示"最近一次注入发生在哪一回合"。 */
  let injectedTurn = null
  /** 最近一次真实注入的完整句子，供设置页展示。 */
  let lastInjectedText = null

  ctx.on('tools/pre-execute', (exec, next) => {
    try {
      const agent = exec && exec.agent
      if (agent && agent.session) lastSession = agent.session
      const isOwn = exec && exec.name === 'context_usage'
      if (settings.enabled && settings.injectPerTurn && !isOwn && agent) {
        const state = stateOf(agent.session)
        const turn = state.turn
        if (turn !== null && turn !== injectedTurn) {
          const text = renderLine(state)
          if (text) {
            injectedTurn = turn
            lastInjectedText = text
            deliver(agent, text).catch((e) => log.warn(`inject failed: ${e && e.message ? e.message : e}`))
          }
        }
      }
    } catch (e) {
      log.warn(`pre-execute hook failed: ${e && e.message ? e.message : e}`)
    }
    return next()
  })

  /** 运行中的 Agent 用 steer；空闲的用 inject（不唤醒、不计费）。 */
  async function deliver (agent, text) {
    const msg = await buildNoticeMessage(text, 'context usage')
    if (agent.status === 'running') agent.steer(msg)
    else agent.inject(msg)
    log.info(`context line delivered: ${text}`)
  }

  // ── HTTP 路由（设置页读写）──────────────────────────────────────────────
  // 宿主没提供 ctx.inject 时不能让整个插件崩掉：那样工具和每轮读数都会一起失效。
  if (typeof ctx.inject !== 'function') {
    log.warn('webServer 不可用：设置页路由未注册')
  } else ctx.inject(['webServer'], (wctx) => {
    wctx.effect(() => {
      const routes = [
        {
          kind: 'exact',
          path: '/api/dsh-context-usage/state',
          handler: async (req, res) => {
            if (req.method !== 'GET' && req.method !== 'HEAD') {
              res.writeHead(405); res.end()
              return
            }
            res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
            res.end(JSON.stringify({
              version: VERSION,
              settings: {
                enabled: settings.enabled,
                injectPerTurn: settings.injectPerTurn,
                template: settings.template,
                contextWindow: settings.contextWindow,
                compactAtRatio: settings.compactAtRatio,
              },
              /** 供设置页渲染占位符说明，避免前后端各写一份。 */
              placeholders: PLACEHOLDERS.map(([key, desc]) => ({ key, desc })),
              defaultTemplate: DEFAULT_TEMPLATE,
              inject: injectPayload(),
            }))
          },
        },
        {
          kind: 'exact',
          path: '/api/dsh-context-usage/set',
          handler: async (req, res) => {
            if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
            let body = ''
            for await (const chunk of req) {
              body += chunk
              if (body.length > 16384) { res.writeHead(413); res.end(); return }
            }
            let patch
            try {
              patch = JSON.parse(body || '{}')
            } catch {
              res.writeHead(400, { 'content-type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: '请求体不是合法 JSON', settings }))
              return
            }
            const next = sanitize(patch, settings)
            const changed = JSON.stringify(next) !== JSON.stringify(settings)
            if (changed) {
              settings = next
              if (!saveSettings(log, settings)) {
                res.writeHead(500, { 'content-type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: '设置写入失败，见 DSH 日志', settings }))
                return
              }
              log.info(`settings updated: ${JSON.stringify(settings)}`)
            }
            res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
            res.end(JSON.stringify({ ok: true, changed, settings, inject: injectPayload() }))
          },
        },
      ]
      const disposers = routes.map((r) => wctx.webServer.register(r))
      return () => disposers.forEach((d) => d())
    })
  })

  // ── context_usage 工具 ─────────────────────────────────────────────────
  const parameters = {
    type: 'object',
    additionalProperties: false,
    properties: {
      detail: { type: 'boolean', description: 'Include raw usage fields and cache hit rate (default true).' },
    },
  }

  const toPlain = (v) => {
    if (v === undefined) return undefined
    try { return JSON.parse(JSON.stringify(v)) } catch { return undefined }
  }

  const execute = async (args, exec) => {
    const wantDetail = !args || args.detail !== false
    const session = exec && exec.agent ? exec.agent.session : null
    if (session) lastSession = session
    const snap = snapshotOf(stateOf(session))
    if (snap.pressureTokens === null) {
      return {
        ok: false,
        reason: projections
          ? '还没有可用的 usage：本会话日志中尚无 provider 上报的用量。'
          : 'sessionProjections 服务不可用，读不到会话状态。',
        contextWindow: snap.contextWindow,
        windowSource: snap.windowSource,
      }
    }
    const out = {
      ok: true,
      percent: snap.percent,
      pressureTokens: snap.pressureTokens,
      contextWindow: snap.contextWindow,
      windowSource: snap.windowSource,
      remainingTokens: snap.remainingTokens,
      note: 'pressureTokens = 未缓存输入 + 缓存读 + 缓存写（不含输出），与 DSH 内部 contextPressure 口径一致。',
    }
    if (snap.compactAtRatio !== null) {
      out.compactAtRatio = snap.compactAtRatio
      out.percentToCompact = typeof snap.percent === 'number'
        ? Math.round((snap.compactAtRatio * 100 - snap.percent) * 10) / 10
        : null
    }
    if (wantDetail) {
      out.cacheHitPercent = snap.cacheHitPercent
      out.turn = snap.turn
      const usage = toPlain(snap.lastUsage)
      if (usage !== undefined) out.lastUsage = usage
    }
    return out
  }

  /**
   * ToolRuntime.register() 的硬契约：output 必须存在且 render 是函数；
   * output.schema 走原生 JSON Schema 子集；execute 返回值按该 schema 校验。
   */
  const definition = {
    name: 'context_usage',
    description: 'Report this session\'s context usage: pressure tokens of the latest provider-reported request, the model context window, the used percentage and the remaining headroom.',
    parameters,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute,
  }

  ctx.effect(() => {
    try {
      const dispose = ctx.tools.register(definition)
      log.info('context_usage tool registered')
      return dispose
    } catch (e) {
      log.warn(`tool registration failed: ${e && e.message ? e.message : e}`)
      return () => {}
    }
  })

  log.info(`ready v${VERSION} (projection ${PROJECTION_KEY}, settings=${settingsPath()})`)
}
