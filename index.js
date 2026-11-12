/**
 * dsh-context-usage-for-agent —— 让 Agent 和用户都能看到当前上下文占用
 *
 * 本文件只做**装配**：把设置、投影、状态读取、工具、路由、注入串起来。
 * 具体实现分在 src/ 下，每个文件一个职责：
 *
 *   constants.js   常量与占位符表（配置契约的单一来源）
 *   settings.js    配置读取 / 校验 / 持久化
 *   template.js    数值格式化与模板渲染
 *   projection.js  会话投影单元
 *   state.js       状态读取层（纯函数）
 *   notice.js      往对话里塞通知
 *   tool.js        context_usage 工具定义
 *   routes.js      设置页 HTTP 路由
 *
 * 依赖方向单向：index → 各模块 → constants，模块之间不成环。
 *
 * 状态来源是 `ctx.sessionProjections` 投影单元（官方 practices 要求：日志派生的每会话状态
 * 不订阅 session/event 自行累加）。pressureTokens 口径与 DSH 内部一致：
 * 未缓存输入 + 缓存读 + 缓存写（不含输出）。
 *
 * @module dsh-context-usage-for-agent
 */

import { VERSION, PROJECTION_KEY } from './src/constants.js'
import { resolveOptions, loadSettings, saveSettings, settingsPath } from './src/settings.js'
import { placeholderValues, renderTemplate } from './src/usage/template.js'
import { createProjection } from './src/usage/projection.js'
import { initialState, snapshotOf, readState, renderLine } from './src/usage/state.js'
import { deliverNotice } from './src/remind/notice.js'
import { buildReminder } from './src/remind/reminder.js'
import { initialGate, markSent } from './src/remind/threshold.js'
import { createToolDefinition } from './src/surface/tool.js'
import { createRoutes } from './src/surface/routes.js'

/** Loader identity for this plugin entry. */
export const name = 'context-usage-for-agent'

/** 依赖的服务：工具注册表 + 会话投影注册表。 */
export const inject = ['tools', 'sessionProjections']

export function apply (ctx, config) {
  const log = ctx.logger('context-usage')
  const options = resolveOptions(config)

  /** 生效设置：启动时读文件覆盖 patch 默认值，之后由设置页改写。 */
  let settings = loadSettings(log, options)
  if (!settings.enabled) log.info('disabled by saved settings')

  // `export const inject` 声明了依赖，这里再做一次运行时检查：服务缺席时降级而不是抛错。
  const projections = ctx.sessionProjections
  if (!projections) {
    log.warn('sessionProjections service unavailable: projection not registered, context_usage will report ok:false')
  }

  /** 最近一个走过工具调用的会话，供 HTTP 路由读取实时状态。 */
  let lastSession = null
  /** 已注入过的回合号；同时供设置页显示「最近一次注入发生在哪一回合」。 */
  let injectedTurn = null
  /** 最近一次真实注入的完整句子，供设置页展示。 */
  let lastInjectedText = null

  // ── 投影 ──────────────────────────────────────────────────────────────
  const projection = createProjection(() => initialState(settings))
  ctx.effect(() => {
    if (!projections) return () => {}
    return projections.register(projection)
  })

  const readSnapshot = (session) => snapshotOf(
    readState({ projections, log, session, settings }),
    settings,
  )

  /**
   * 设置页用的注入预览。
   * 这个插件的定位是「让 Agent 能读上下文」，用户侧的占用显示由聊天框下方承担，
   * 所以这里不返回占用容量，只说明注入什么、最近注入了什么。
   */
  const injectPayload = () => {
    const snap = readSnapshot(lastSession)
    const ready = snap.pressureTokens !== null
    const mode = settings.injectMode
    const activeTemplate = mode === 'threshold' ? settings.remindTemplate : settings.template
    return {
      mode,
      threshold: settings.threshold,
      active: settings.enabled && mode !== 'off' && Boolean(activeTemplate),
      hasSession: Boolean(lastSession),
      lastLine: lastInjectedText,
      lastTurn: injectedTurn,
      /** everyTurn 模式用的读数句 */
      sampleLine: ready && settings.template ? renderTemplate(settings.template, snap) : null,
      /** threshold 模式用的提醒句 */
      remindSampleLine: ready && settings.remindTemplate ? renderTemplate(settings.remindTemplate, snap) : null,
      /** 占位符 → 已格式化值；设置页据此对「编辑中的模板」做实时预览，不必等保存 */
      values: ready ? placeholderValues(snap) : null,
    }
  }

  // ── 注入：两种模式共用同一挂点 ────────────────────────────────────────
  //   threshold（默认）：用量首次到阈值提醒一次，之后不再打扰
  //   everyTurn：每回合一行读数（旧行为）
  const gates = new Map()
  const gateKey = (session) => (session && session.id ? String(session.id) : session)

  const send = (agent, text) => {
    lastInjectedText = text
    deliverNotice(agent, text, log).catch((e) => log.warn(`inject failed: ${e && e.message ? e.message : e}`))
  }

  ctx.on('tools/pre-execute', (exec, next) => {
    try {
      const agent = exec && exec.agent
      if (agent && agent.session) lastSession = agent.session
      const isOwn = exec && exec.name === 'context_usage'
      const mode = settings.injectMode
      if (!settings.enabled || mode === 'off' || isOwn || !agent) return next()

      const state = readState({ projections, log, session: agent.session, settings })

      if (mode === 'everyTurn') {
        const turn = state.turn
        if (turn !== null && turn !== injectedTurn) {
          const text = renderLine(state, settings)
          if (text) {
            injectedTurn = turn
            send(agent, text)
          }
        }
        return next()
      }

      // threshold 模式：每会话一次
      const snap = snapshotOf(state, settings)
      const key = gateKey(agent.session)
      const gate = gates.get(key) || initialGate()
      const reminder = buildReminder({ snap, gate, options: settings })
      if (reminder) {
        gates.set(key, markSent(gate, { level: reminder.level, percent: reminder.percent }))
        injectedTurn = state.turn
        send(agent, reminder.text)
        log.info(`reminder sent at ${Math.round(reminder.percent)}%`)
      }
    } catch (e) {
      log.warn(`pre-execute hook failed: ${e && e.message ? e.message : e}`)
    }
    return next()
  })

  // ── 设置页路由 ────────────────────────────────────────────────────────
  // 宿主没提供 ctx.inject 时不能让整个插件崩掉：那样工具和每轮读数都会一起失效。
  if (typeof ctx.inject !== 'function') {
    log.warn('webServer 不可用：设置页路由未注册')
  } else {
    ctx.inject(['webServer'], (wctx) => {
      wctx.effect(() => {
        const routes = createRoutes({
          getSettings: () => settings,
          setSettings: (next) => { settings = next },
          persist: (next) => saveSettings(log, next),
          injectPayload,
          log,
        })
        const disposers = routes.map((r) => wctx.webServer.register(r))
        return () => disposers.forEach((d) => d())
      })
    })
  }

  // ── context_usage 工具（默认不暴露） ──────────────────────────────────
  // 工具一进清单就是持续暗示，Agent 会反复查询并把读数当预算用；关闭时压根不注册，
  // 模型侧完全看不到这个能力存在。
  if (settings.toolEnabled === true) {
    const definition = createToolDefinition({
      readSnapshot,
      onSession: (session) => { lastSession = session },
      hasProjections: Boolean(projections),
    })

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
  } else {
    log.info('context_usage tool not exposed (toolEnabled=false)')
  }

  log.info(`ready v${VERSION} (projection ${PROJECTION_KEY}, settings=${settingsPath()})`)
}
