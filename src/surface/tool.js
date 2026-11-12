/**
 * `context_usage` 工具的定义。
 *
 * 宿主 `ToolRuntime.register()` 的硬契约（缺一样就注册失败，插件 active 但工具消失）：
 *   · `output` 必须存在且 `render` 是函数
 *   · `parameters` 是原生 JSON Schema 本体，不是 defineTool 的 spec 简写
 *   · `execute` 的返回值按 `output.schema` 校验，并做 lossless JSON 快照
 */

/**
 * @param {object} deps
 * @param {(session: object|null) => object} deps.readSnapshot - 读会话快照（已含派生字段）
 * @param {(session: object) => void} deps.onSession - 记录当前活跃会话
 * @param {boolean} deps.hasProjections - 投影服务是否可用（决定 ok:false 的措辞）
 */
export function createToolDefinition ({ readSnapshot, onSession, hasProjections }) {
  const parameters = {
    type: 'object',
    additionalProperties: false,
    properties: {
      detail: { type: 'boolean', description: 'Include raw usage fields and cache hit rate (default true).' },
    },
  }

  /** 宿主会把返回值当 lossless JSON 快照，先做一次 round-trip 归一。 */
  const toPlain = (v) => {
    if (v === undefined) return undefined
    try { return JSON.parse(JSON.stringify(v)) } catch { return undefined }
  }

  const execute = async (args, exec) => {
    const wantDetail = !args || args.detail !== false
    const session = exec && exec.agent ? exec.agent.session : null
    if (session) onSession(session)

    const snap = readSnapshot(session)
    if (snap.pressureTokens === null) {
      return {
        ok: false,
        reason: hasProjections
          ? '还没有可用的 usage：本会话日志中尚无 provider 上报的用量。'
          : 'sessionProjections 服务不可用，读不到会话状态。',
        contextWindow: snap.contextWindow,
        windowSource: snap.windowSource,
      }
    }

    const out = {
      ok: true,
      percent: snap.percent,
      pressureTokens: snap.pressureTokens,
      contextWindow: snap.contextWindow,
      windowSource: snap.windowSource,
      remainingTokens: snap.remainingTokens,
      note: 'pressureTokens = 未缓存输入 + 缓存读 + 缓存写（不含输出），与 DSH 内部 contextPressure 口径一致。',
    }
    if (snap.compactAtRatio !== null) {
      out.compactAtRatio = snap.compactAtRatio
      out.percentToCompact = typeof snap.percent === 'number'
        ? Math.round((snap.compactAtRatio * 100 - snap.percent) * 10) / 10
        : null
    }
    if (wantDetail) {
      out.cacheHitPercent = snap.cacheHitPercent
      out.turn = snap.turn
      const usage = toPlain(snap.lastUsage)
      if (usage !== undefined) out.lastUsage = usage
    }
    return out
  }

  return {
    name: 'context_usage',
    description: 'Report this session\'s context usage: pressure tokens of the latest provider-reported request, the model context window, the used percentage and the remaining headroom.',
    parameters,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute,
  }
}
