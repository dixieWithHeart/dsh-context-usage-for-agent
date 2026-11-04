// @local/dsh-context-usage — 浏览器半 / browser half
//
// 注册一个设置页（settings.section）。这个插件的定位是让 Agent 能读到自己的上下文，
// 用户侧的占用显示由聊天框下方承担，所以本页不预览占用容量，只做两件事：
//   1. 把「每轮注入的那句话」完整列出来（最近一条 + 按当前设置会生成的格式）
//   2. 提供开关：是否每轮注入（关闭后仅保留 Agent 主动查询的能力）
//
// 契约：
//   window.__ModuleLoader__.load({ id, factory(require) }) —— id 必须是包名
//   不 require 任何 @deepseek-ai/dsh-client-* 包；React 从 browser module table 取
//   样式只用 --dsw-alias-* 主题 token，且都带 fallback

window.__ModuleLoader__.load({
  id: '@local/dsh-context-usage-for-agent',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const API = '/api/dsh-context-usage'
    const POLL_MS = 2000
    const LOG = '[dsh-context-usage-for-agent]'

    let state = {
      loading: true,
      error: null,
      version: '',
      settings: { enabled: true, injectPerTurn: true, showCacheHit: true, contextWindow: 1000000, compactAtRatio: null },
      inject: { active: true, hasSession: false, lastLine: null, lastTurn: null, sampleLine: null },
    }
    const listeners = new Set()
    const emit = () => { for (const fn of listeners) fn(state) }

    async function refresh () {
      try {
        const r = await fetch(API + '/state', { headers: { accept: 'application/json' } })
        if (!r.ok) throw new Error('HTTP ' + r.status)
        const j = await r.json()
        state = { ...state, loading: false, error: null, version: j.version, settings: j.settings, inject: j.inject }
      } catch (e) {
        state = { ...state, loading: false, error: (e && e.message) || '无法连接宿主路由' }
      }
      emit()
    }

    async function save (patch) {
      const r = await fetch(API + '/set', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      let j = null
      try { j = await r.json() } catch { /* 非 JSON 响应按失败处理 */ }
      if (!r.ok || !j || j.ok === false) throw new Error((j && j.error) || ('HTTP ' + r.status))
      state = { ...state, settings: j.settings, inject: j.inject, error: null }
      emit()
      return j
    }

    function useStore () {
      const [snap, setSnap] = useState(state)
      useEffect(() => {
        listeners.add(setSnap)
        setSnap(state)
        return () => { listeners.delete(setSnap) }
      }, [])
      return snap
    }

    // ── 样式（只用主题 token，全部带 fallback）────────────────────────────
    const C = {
      border: 'var(--dsw-alias-border-subtle, rgba(130,130,140,0.28))',
      text: 'var(--dsw-alias-text-primary, inherit)',
      dim: 'var(--dsw-alias-text-secondary, rgba(140,140,150,1))',
      accent: 'var(--dsw-alias-accent, #4f7cff)',
      surface: 'var(--dsw-alias-surface-raised, rgba(130,130,140,0.06))',
      radius: 'var(--dsw-radius-lg, 12px)',
      radiusSm: 'var(--dsw-radius-sm, 8px)',
    }

    const S = {
      card: { border: '1px solid ' + C.border, borderRadius: C.radius, padding: '16px 18px', display: 'grid', gap: '14px', color: C.text },
      head: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' },
      title: { fontSize: '15px', fontWeight: 600, margin: 0 },
      badge: { fontSize: '12px', color: C.dim, border: '1px solid ' + C.border, borderRadius: '999px', padding: '1px 8px' },
      status: { marginLeft: 'auto', fontSize: '12px', color: C.dim },
      desc: { margin: 0, fontSize: '13px', lineHeight: 1.6, color: C.dim },
      panel: { background: C.surface, borderRadius: C.radiusSm, padding: '12px 14px', display: 'grid', gap: '10px' },
      label: { fontSize: '12px', color: C.dim, display: 'flex', alignItems: 'center', gap: '6px' },
      line: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: '12.5px', lineHeight: 1.6, wordBreak: 'break-all',
        background: 'rgba(130,130,140,0.12)', borderRadius: '6px', padding: '8px 10px', color: C.text,
      },
      empty: { fontSize: '12.5px', color: C.dim, fontStyle: 'italic' },
      row: { display: 'flex', alignItems: 'flex-start', gap: '12px', paddingTop: '4px' },
      rowText: { display: 'grid', gap: '2px', flex: 1, minWidth: 0 },
      rowTitle: { fontSize: '13px', fontWeight: 550 },
      rowDesc: { fontSize: '12px', color: C.dim, lineHeight: 1.5 },
      toggle: (on) => ({
        width: '38px', height: '22px', borderRadius: '999px', border: '1px solid ' + C.border,
        background: on ? C.accent : 'rgba(130,130,140,0.25)', position: 'relative', cursor: 'pointer',
        flex: 'none', marginTop: '2px', transition: 'background 160ms ease',
      }),
      knob: (on) => ({
        position: 'absolute', top: '2px', left: on ? '18px' : '2px', width: '16px', height: '16px',
        borderRadius: '50%', background: '#fff', transition: 'left 160ms ease',
      }),
      msg: (bad) => ({ fontSize: '12px', color: bad ? 'var(--dsw-alias-danger, #e5534b)' : C.dim }),
      foot: { fontSize: '12px', color: C.dim, lineHeight: 1.6, margin: 0 },
    }

    function Toggle ({ on, onChange, label }) {
      return h('button', {
        type: 'button',
        'aria-label': label,
        'aria-pressed': on ? 'true' : 'false',
        style: S.toggle(on),
        onClick: () => onChange(!on),
      }, h('span', { style: S.knob(on) }))
    }

    function Row ({ title, desc, control }) {
      return h('div', { style: S.row },
        h('div', { style: S.rowText },
          h('div', { style: S.rowTitle }, title),
          desc ? h('div', { style: S.rowDesc }, desc) : null,
        ),
        control,
      )
    }

    function Line ({ text, placeholder }) {
      return text
        ? h('div', { style: S.line }, text)
        : h('div', { style: S.empty }, placeholder)
    }

    // ── slot: settings.section ───────────────────────────────────────────
    function SettingsCard () {
      const s = useStore()
      const [busy, setBusy] = useState(false)
      const [msg, setMsg] = useState(null)

      const flash = (text, bad) => {
        setMsg({ text, bad })
        window.setTimeout(() => setMsg(null), 2600)
      }

      const apply = useCallback(async (patch, okText) => {
        setBusy(true)
        try {
          await save(patch)
          if (okText) flash(okText, false)
        } catch (e) {
          flash('保存失败：' + ((e && e.message) || '请确认 DSH 仍在运行'), true)
        } finally {
          setBusy(false)
        }
      }, [])

      const inject = s.inject || {}
      const injecting = s.settings.enabled && s.settings.injectPerTurn
      const statusText = s.error ? ('连接异常：' + s.error)
        : s.loading ? '正在读取…'
          : injecting ? '已开启：每轮自动注入'
            : '已关闭：仅 Agent 主动查询'

      return h('div', { style: S.card },
        h('div', { style: S.head },
          h('h3', { style: S.title }, '上下文自知'),
          s.version ? h('span', { style: S.badge }, 'v' + s.version) : null,
          h('span', { style: S.status }, statusText),
        ),
        h('p', { style: S.desc },
          '让 Agent 能读到自己的上下文占用：既可以通过 context_usage 工具主动查询，'
          + '也可以在每轮开头自动注入一行读数。你在聊天框下方的占用条由宿主显示，与本插件无关。'),

        h('div', { style: S.panel },
          h('div', { style: S.label }, '按当前设置会注入的句子'),
          h(Line, {
            text: inject.sampleLine,
            placeholder: inject.hasSession ? '本会话还没有 provider 上报的用量，下一轮就会生成' : '本会话还没有工具调用记录，暂时无法生成',
          }),
          h('div', { style: S.label },
            '最近一次实际注入',
            inject.lastTurn !== null ? h('span', { style: { opacity: 0.8 } }, '（第 ' + inject.lastTurn + ' 回合）') : null,
          ),
          injecting
            ? h(Line, { text: inject.lastLine, placeholder: '本回合还没到注入时机（注入发生在本轮第一次工具调用前）' })
            : h('div', { style: S.empty }, '注入已关闭，这里不会有内容；Agent 仍可调用 context_usage 工具。'),
        ),

        h(Row, {
          title: '每轮把上下文注入到对话中',
          desc: '开启：每个回合的第一次工具调用前，主动把上面那行读数塞进当前回合。'
            + '关闭：完全不注入，只保留 Agent 主动调用 context_usage 的能力。',
          control: h(Toggle, {
            on: s.settings.injectPerTurn,
            label: '每轮把上下文注入到对话中',
            onChange: (v) => apply({ injectPerTurn: v }, v ? '已开启每轮注入' : '已关闭每轮注入，仅保留工具查询'),
          }),
        }),
        h(Row, {
          title: '注入的句子带缓存命中率',
          desc: '只影响注入文案里是否出现「缓存 xx%」，不改变 pressureTokens 的口径。',
          control: h(Toggle, {
            on: s.settings.showCacheHit,
            label: '注入的句子带缓存命中率',
            onChange: (v) => apply({ showCacheHit: v }),
          }),
        }),
        h(Row, {
          title: '启用插件',
          desc: '总开关。关闭后既不注入，也不注册 context_usage 之外的行为（工具本身仍在，仅返回值可能为空）。',
          control: h(Toggle, {
            on: s.settings.enabled,
            label: '启用插件',
            onChange: (v) => apply({ enabled: v }, v ? '已启用' : '已停用'),
          }),
        }),

        msg ? h('div', { style: S.msg(msg.bad) }, msg.text) : null,
        h('p', { style: S.foot },
          'pressureTokens = 未缓存输入 + 缓存读 + 缓存写（不含输出），与 DSH 内部 contextPressure 口径一致。'
          + '数据来自会话投影，重启后不必等新事件即可读到。设置保存在 ~/.dsh/dsh-context-usage.json。'),
      )
    }

    // ── registration ─────────────────────────────────────────────────────
    function contribute (ctx, key, options, Component, what) {
      const fail = (e) => console.error(LOG, 'could not register ' + what + ':', e)
      try {
        return ctx.slots.inject(key, () => {
          try {
            return ctx.slots.register(options, Component)
          } catch (e) {
            fail(e)
            return () => {}
          }
        })
      } catch (e) {
        fail(e)
        return () => {}
      }
    }

    const inject = ['slots']

    function apply (ctx) {
      ctx.effect(() => {
        refresh()
        const timer = setInterval(() => { if (!document.hidden) refresh() }, POLL_MS)
        const onVisible = () => { if (!document.hidden) refresh() }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, 'context-usage-poll')

      ctx.effect(
        () => contribute(
          ctx,
          'settings.section',
          { name: 'settings.section', id: 'context-usage', order: 215, label: '上下文自知' },
          SettingsCard,
          'settings.section',
        ),
        'context-usage-settings-section',
      )
    }

    return { inject, apply }
  },
})
