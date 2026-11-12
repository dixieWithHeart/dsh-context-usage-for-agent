/**
 * 插件的全部常量与静态表。
 *
 * 单独成文的原因：这些值是「配置契约」——设置页、模板渲染、HTTP 路由三处都要读，
 * 放在一起改一处即可，避免在多个文件里各写一份而漂移。
 */

export const VERSION = '0.6.0'

/** 投影单元的 key。改它等于放弃历史 cell，需同步 stateVersion。 */
export const PROJECTION_KEY = 'contextUsage'

/** 用户设置的落盘文件名（在 $DSH_HOME 下）。 */
export const SETTINGS_FILENAME = 'dsh-context-usage.json'

/** 注入消息的来源标识，客户端据此识别「这是插件塞进来的读数」。 */
export const NOTICE_SOURCE_KIND = 'plugin:dsh-context-usage'

/** POST /set 的请求体上限，防手滑提交大对象。 */
export const MAX_BODY_BYTES = 16384

/** 默认注入模板。 */
export const DEFAULT_TEMPLATE = '[ctx {percent}%] 已用 {used} · 缓存 {cache}%'

/**
 * 阈值提醒的默认文案（2026-11-11 用户定稿）。
 * 语义：让 Agent 去提醒用户收尾，同时明确不要为了省上下文牺牲严谨性。
 */
export const DEFAULT_REMIND = '注意：你目前的上下文用量是 {percent}%，你应当提醒用户注意上下文情况，建议用户发起收尾流程。\n请保持工作流完整，不要因为上下文用量而破坏工作严谨性。'

/** 模板长度上限：防手滑贴进一整段文档。 */
export const MAX_TEMPLATE_LENGTH = 500

/** 启动默认值。Host 行（patch）里的 config 会覆盖它。 */
export const DEFAULTS = {
  enabled: true,
  /** model 上下文窗口的兜底值；request/context 到达后以 provider 上报为准。 */
  contextWindow: 1000000,
  /** 注入模式：threshold（到阈值提醒一次，默认）/ everyTurn（每回合一行读数）/ off（只留工具） */
  injectMode: 'threshold',
  /** 阈值模式的触发百分比。 */
  threshold: 75,
  /** 每轮读数模板，用 {占位符} 取数。空串表示不注入。 */
  template: DEFAULT_TEMPLATE,
  /** 阈值提醒模板（everyTurn 模式不使用）。 */
  remindTemplate: DEFAULT_REMIND,
  /**
   * 是否把 `context_usage` 工具暴露给 Agent。默认关闭：
   * 工具一进清单就是持续暗示，Agent 会反复查询并把读数当预算用（用户 2026-11-11 观察）。
   * 关闭时不调用 ctx.tools.register，工具从清单里彻底消失。
   */
  toolEnabled: false,
  /** 若确知 DSH 自动压缩阈值（0..1），设置页可填；null 表示不显示。 */
  compactAtRatio: null,
}

/**
 * 模板里可用的全部占位符：`[key, 说明]`。
 * 设置页直接消费这张表渲染说明，前后端不各写一份。
 *
 * 2026-11-11 用户裁决：只保留三个必要项，其余（window / remaining / usedRaw 等）下线，
 * 避免模板里塞进太多数字、把注入行变长。旧模板里的未知占位符会原样保留。
 */
export const PLACEHOLDERS = [
  ['percent', '上下文用量百分比，如 17.7'],
  ['used', '已用 token，带单位，如 177k'],
  ['cache', '缓存命中率百分比，如 99.4'],
]
