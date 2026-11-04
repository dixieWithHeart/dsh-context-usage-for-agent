/**
 * 插件的全部常量与静态表。
 *
 * 单独成文的原因：这些值是「配置契约」——设置页、模板渲染、HTTP 路由三处都要读，
 * 放在一起改一处即可，避免在多个文件里各写一份而漂移。
 */

export const VERSION = '0.5.1'

/** 投影单元的 key。改它等于放弃历史 cell，需同步 stateVersion。 */
export const PROJECTION_KEY = 'contextUsage'

/** 用户设置的落盘文件名（在 $DSH_HOME 下）。 */
export const SETTINGS_FILENAME = 'dsh-context-usage.json'

/** 注入消息的来源标识，客户端据此识别「这是插件塞进来的读数」。 */
export const NOTICE_SOURCE_KIND = 'plugin:dsh-context-usage'

/** POST /set 的请求体上限，防手滑提交大对象。 */
export const MAX_BODY_BYTES = 16384

/** 默认注入模板。 */
export const DEFAULT_TEMPLATE = '[ctx {percent}%] {used}/{window} · 缓存 {cache}% · 余 {remaining}'

/** 模板长度上限：防手滑贴进一整段文档。 */
export const MAX_TEMPLATE_LENGTH = 500

/** 启动默认值。Host 行（patch）里的 config 会覆盖它。 */
export const DEFAULTS = {
  enabled: true,
  /** model 上下文窗口的兜底值；request/context 到达后以 provider 上报为准。 */
  contextWindow: 1000000,
  injectPerTurn: true,
  /** 注入文案模板，用 {占位符} 取数。空串表示不注入。 */
  template: DEFAULT_TEMPLATE,
  /** 若确知 DSH 自动压缩阈值（0..1），设置页可填；null 表示不显示。 */
  compactAtRatio: null,
}

/**
 * 模板里可用的全部占位符：`[key, 说明]`。
 * 设置页直接消费这张表渲染说明，前后端不各写一份。
 */
export const PLACEHOLDERS = [
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
