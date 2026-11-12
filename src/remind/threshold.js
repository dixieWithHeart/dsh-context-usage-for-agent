/**
 * 阈值判定：纯函数，不碰宿主上下文，便于单测。
 *
 * 语义（移植自 dsh-context-landing）：
 *   · 用量首次 ≥ threshold → 提醒一次
 *   · 之后不再提醒（每会话一个闸门）
 */

/** 每会话的提醒闸门。 */
export function initialGate () {
  return {
    sent: false,
    /** 最近一次提醒时的百分比，供设置页显示 */
    lastPercent: null,
  }
}

function clampPercent (value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n))
}

/**
 * 判定这一次是否该提醒。
 * @param {{percent: number|null, gate: object, options: object}} input
 * @returns {{level: 'threshold', percent: number}|null}
 */
export function decide ({ percent, gate, options }) {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return null
  const threshold = clampPercent(options && options.threshold)
  const state = gate || initialGate()
  if (state.sent) return null
  return percent >= threshold ? { level: 'threshold', percent } : null
}

/** 提醒后更新闸门。 */
export function markSent (gate, decision) {
  const next = { ...(gate || initialGate()) }
  next.sent = true
  next.lastPercent = decision.percent
  return next
}
