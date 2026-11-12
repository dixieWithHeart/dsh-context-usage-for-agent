/**
 * 配置的读取、校验与持久化。
 *
 * 两个来源，优先级从低到高：
 *   1. Host 行（cordis.patch.yml）的 `config`
 *   2. `$DSH_HOME/dsh-context-usage.json`（设置页写入）
 * 全部经 `sanitize()` 过滤：只接受已知字段、类型不对就忽略，不抛错。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { SETTINGS_FILENAME, MAX_TEMPLATE_LENGTH, DEFAULTS } from './constants.js'

export function settingsPath () {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, SETTINGS_FILENAME)
}

/** 用 base 兜底，只覆盖 raw 里合法且已知的字段。 */
export function sanitize (raw, base) {
  const o = { ...base }
  if (!raw || typeof raw !== 'object') return o
  if (typeof raw.enabled === 'boolean') o.enabled = raw.enabled
  if (typeof raw.toolEnabled === 'boolean') o.toolEnabled = raw.toolEnabled
  // 注入模式；兼容旧字段 injectPerTurn（true → 每轮，false → 关闭）
  if (typeof raw.injectMode === 'string' && ['threshold', 'everyTurn', 'off'].includes(raw.injectMode)) {
    o.injectMode = raw.injectMode
  } else if (typeof raw.injectPerTurn === 'boolean') {
    o.injectMode = raw.injectPerTurn ? 'everyTurn' : 'off'
  }
  if (typeof raw.threshold === 'number' && Number.isFinite(raw.threshold)) {
    o.threshold = Math.min(100, Math.max(0, Math.round(raw.threshold)))
  }
  if (typeof raw.template === 'string') {
    // 允许空串：等于「不注入」。是否真的注入由 injectMode 与模板空值共同决定。
    o.template = raw.template.slice(0, MAX_TEMPLATE_LENGTH)
  }
  if (typeof raw.remindTemplate === 'string') {
    o.remindTemplate = raw.remindTemplate.slice(0, MAX_TEMPLATE_LENGTH)
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

export function loadSettings (log, defaults) {
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

export function saveSettings (log, settings) {
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
export function resolveOptions (raw) {
  if (raw !== undefined && (raw === null || typeof raw !== 'object' || Array.isArray(raw))) {
    throw new TypeError('context-usage: config must be a mapping')
  }
  const o = { ...DEFAULTS, ...(raw || {}) }
  if (typeof o.contextWindow !== 'number' || !Number.isFinite(o.contextWindow) || o.contextWindow <= 0) {
    throw new TypeError('context-usage: contextWindow must be a positive number')
  }
  return o
}
