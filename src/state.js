/**
 * 状态读取层：把投影单元里的裸状态加工成「工具/路由能直接用的快照」。
 *
 * 全部是纯函数，`settings` 显式传参而不是从闭包读——这样单独测试时不需要造插件上下文。
 */

import { PROJECTION_KEY } from './constants.js'
import { renderTemplate } from './template.js'

/** 投影缺失或还没有数据时的退化状态。 */
export function initialState (settings) {
  return {
    pressureTokens: null,
    lastUsage: null,
    contextWindow: settings.contextWindow,
    windowSource: 'config',
    turn: null,
  }
}

export function percentOf (state) {
  if (!state.pressureTokens || !state.contextWindow) return null
  return Math.round((state.pressureTokens / state.contextWindow) * 1000) / 10
}

/** 把投影裸状态加工成一份带派生字段的快照。 */
export function snapshotOf (state, settings) {
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
 * 读某个会话的实时投影状态。
 * 拿不到 session 或投影服务缺席时退回初始状态，而不是抛错。
 */
export function readState ({ projections, log, session, settings }) {
  if (!projections || !session) return initialState(settings)
  try {
    const s = projections.stateOf(session, PROJECTION_KEY)
    if (!s) return initialState(settings)
    // 兜底窗口以当前设置为准：投影单元只在 init 时读过一次，设置页改完值不会重建 cell，
    // 不回填会导致「改了窗口但注入文案还显示旧窗口」。
    return s.windowSource === 'config' ? { ...s, contextWindow: settings.contextWindow } : s
  } catch (e) {
    log.warn(`projection read failed: ${e && e.message ? e.message : e}`)
    return initialState(settings)
  }
}

/**
 * 按用户模板生成注入文案；模板为空或还没有 usage 时返回 null（表示不注入）。
 * 要不要缓存命中率由模板决定，不再单独开关。
 */
export function renderLine (state, settings) {
  if (!settings.template) return null
  const snap = snapshotOf(state, settings)
  if (snap.pressureTokens === null) return null
  return renderTemplate(settings.template, snap)
}
