/**
 * 往对话里塞一条「插件通知」。
 *
 * `source.kind` 必须写全（v4 会话格式拒绝退化的 plugin kind），否则投递会静默失败。
 */

import { NOTICE_SOURCE_KIND } from './constants.js'

/**
 * 造一条能被 harness 当成 user 消息接收的对象。
 * @param {string} text - 消息正文
 * @param {string} [detail] - 附在 source.summary 里的短说明
 */
export async function buildNoticeMessage (text, detail) {
  const source = {
    kind: NOTICE_SOURCE_KIND,
    form: 'notice',
    ...(detail ? { summary: detail } : {}),
  }
  const content = [{ type: 'text', text }]
  try {
    const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
    if (typeof createUserMessage === 'function') return createUserMessage({ content, source })
  } catch { /* 宿主可能不为插件解析该包，走下面的等价兜底 */ }
  return {
    id: `ctxu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content,
    source,
  }
}

/**
 * 投递一行读数。
 * 运行中的 Agent 用 steer（下一步就能读到，不新开回合）；
 * 空闲的用 inject（静默，不唤醒、不计费新一轮）。
 */
export async function deliverNotice (agent, text, log) {
  const msg = await buildNoticeMessage(text, 'context usage')
  if (agent.status === 'running') agent.steer(msg)
  else agent.inject(msg)
  log.info(`context line delivered: ${text}`)
}
