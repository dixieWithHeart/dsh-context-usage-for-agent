/**
 * 设置页的 HTTP 路由。
 *
 * 两条：读状态、写设置。无鉴权，与本机既有插件（dsh-auto-continue）同款；
 * 响应统一带 `cache-control: no-store`，避免轮询拿到陈旧设置。
 */

import { VERSION, PLACEHOLDERS, DEFAULT_TEMPLATE, MAX_BODY_BYTES } from '../constants.js'
import { sanitize } from '../settings.js'

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' }

/** 读满请求体；超限直接 413，防止手滑提交大对象。 */
async function readBody (req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > MAX_BODY_BYTES) return null
  }
  return body
}

/**
 * @param {object} deps
 * @param {() => object} deps.getSettings - 当前生效设置
 * @param {(next: object) => void} deps.setSettings - 就地更新（供后续请求读到新值）
 * @param {(settings: object) => boolean} deps.persist - 落盘，返回是否成功
 * @param {() => object} deps.injectPayload - 注入预览载荷
 * @param {object} deps.log - 插件 logger
 */
export function createRoutes ({ getSettings, setSettings, persist, injectPayload, log }) {
  return [
    {
      kind: 'exact',
      path: '/api/dsh-context-usage/state',
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405); res.end()
          return
        }
        const settings = getSettings()
        res.writeHead(200, JSON_HEADERS)
        res.end(JSON.stringify({
          version: VERSION,
          settings: {
            enabled: settings.enabled,
            injectMode: settings.injectMode,
            threshold: settings.threshold,
            toolEnabled: settings.toolEnabled === true,
            template: settings.template,
            remindTemplate: settings.remindTemplate,
            contextWindow: settings.contextWindow,
            compactAtRatio: settings.compactAtRatio,
          },
          /** 设置页据此渲染占位符说明，避免前后端各写一份 */
          placeholders: PLACEHOLDERS.map(([key, desc]) => ({ key, desc })),
          defaultTemplate: DEFAULT_TEMPLATE,
          inject: injectPayload(),
        }))
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-context-usage/set',
      handler: async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return }

        const body = await readBody(req)
        if (body === null) { res.writeHead(413); res.end(); return }

        let patch
        try {
          patch = JSON.parse(body || '{}')
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: '请求体不是合法 JSON', settings: getSettings() }))
          return
        }

        const current = getSettings()
        const next = sanitize(patch, current)
        const changed = JSON.stringify(next) !== JSON.stringify(current)
        if (changed) {
          setSettings(next)
          if (!persist(next)) {
            res.writeHead(500, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: '设置写入失败，见 DSH 日志', settings: getSettings() }))
            return
          }
          log.info(`settings updated: ${JSON.stringify(next)}`)
        }
        res.writeHead(200, JSON_HEADERS)
        res.end(JSON.stringify({ ok: true, changed, settings: getSettings(), inject: injectPayload() }))
      },
    },
  ]
}
