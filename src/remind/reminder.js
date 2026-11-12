/**
 * 阈值提醒模块：判定 + 模板 → 文案。
 * 纯函数，注入动作由装配层执行。
 */

import { renderTemplate } from '../usage/template.js'
import { decide } from './threshold.js'

/**
 * 算出这一次是否要提醒、提醒什么。
 * @param {{snap: object, gate: object, options: object}} input
 * @returns {{level: 'threshold', percent: number, text: string}|null}
 */
export function buildReminder ({ snap, gate, options }) {
  if (!snap) return null
  const decision = decide({ percent: snap.percent, gate, options })
  if (!decision) return null
  const text = renderTemplate(options && options.remindTemplate, snap).trim()
  if (!text) return null
  return { level: decision.level, percent: decision.percent, text }
}
