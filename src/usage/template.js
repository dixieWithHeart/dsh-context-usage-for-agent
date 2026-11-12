/**
 * 数值格式化与模板渲染。
 *
 * 格式化只在宿主做一次：设置页拿到的是「占位符 → 可直接拼接的字符串」，
 * 前端实时预览只做字符串替换，不需要复刻一套 k/M 换算与百分比取整。
 */

/** 把 token 数压成 1.00M / 177k 这样的短形式。 */
export const kTok = (n) => {
  if (!Number.isFinite(n)) return '?'
  if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 2) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k'
  return String(Math.round(n))
}

export const PLACEHOLDER_RE = /\{([A-Za-z][A-Za-z0-9]*)\}/g

/**
 * 把快照转成「占位符 → 已格式化的字符串」映射。
 *
 * 2026-11-11 用户裁决：只保留三个占位符（percent / used / cache）。
 * 未列出的占位符会被 `renderTemplate` 原样保留，便于用户发现模板里还在用旧字段。
 * 取不到值的统一给 `?`，避免文案里出现 null/undefined。
 */
export function placeholderValues (snap) {
  const raw = {
    percent: snap.percent,
    used: kTok(snap.pressureTokens),
    cache: snap.cacheHitPercent,
  }
  const out = {}
  for (const [key, v] of Object.entries(raw)) {
    out[key] = v === null || v === undefined ? '?' : String(v)
  }
  return out
}

/**
 * 把模板里的 {占位符} 换成实际值。
 * 未知占位符**原样保留**——这样用户在预览里一眼就能看到自己拼错了，而不是被悄悄吞掉。
 */
export function renderTemplate (template, snap) {
  const values = placeholderValues(snap)
  return template.replace(PLACEHOLDER_RE, (whole, key) => (
    Object.hasOwn(values, key) ? values[key] : whole
  ))
}
