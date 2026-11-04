/**
 * 会话投影单元的定义。
 *
 * 依据官方 practices：由日志派生的每会话状态放 `ctx.sessionProjections`，
 * 不要订阅 `session/event` 自行累加。这样冷读 / 重启后折叠日志即得当前值。
 *
 * 契约要点（宿主会强制）：
 *   · `apply` 必须同步，且与本单位无关的事件**返回同一引用**（注册表据此判定零下游工作）
 *   · `stateSchema.parse` 会被用来校验检查点里恢复出来的状态
 */

import { PROJECTION_KEY } from './constants.js'

/**
 * 状态 schema。
 * 宿主只调用 `.parse()`（schemastery 风格）；为一个形状校验引入 schemastery 依赖不值得，故手写最小实现。
 */
export const stateSchema = {
  parse (value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('context-usage: projection state must be a plain object')
    }
    return value
  },
}

/**
 * 造一个投影单元。
 * @param {() => object} initialState - 初始状态工厂（每次返回新对象）。
 */
export function createProjection (initialState) {
  return {
    key: PROJECTION_KEY,
    stateVersion: 1,
    stateSchema,
    init: () => initialState(),
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
}
