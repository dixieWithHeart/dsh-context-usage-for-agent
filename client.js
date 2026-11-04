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

    // ═══ 1. 常量 ═══════════════════════════════════════════════════════
    const API = '/api/dsh-context-usage'
    const POLL_MS = 2000
    const LOG = '[dsh-context-usage-for-agent]'
    const PLACEHOLDER_RE = /\{([A-Za-z][A-Za-z0-9]*)\}/g

    // ═══ 2. 纯函数 ═════════════════════════════════════════════════════
    /**
     * 用宿主给的「已格式化占位符值」渲染模板。
     * 格式化（k/v 单位、百分比）全在宿主做，前端只做字符串替换，避免两套口径漂移。
     */
    function renderPreview (template, values) {
      if (!template) return ''
      if (!values) return template
      return template.replace(PLACEHOLDER_RE, (whole, key) => (
        Object.hasOwn(values, key) ? values[key] : whole
      ))
    }

    // ═══ 3. store：轮询与状态 ══════════════════════════════════════════
    let state = {
      loading: true,
      error: null,
      version: '',
      settings: { enabled: true, injectPerTurn: true, template: '', contextWindow: 1000000, compactAtRatio: null },
      inject: { active: true, hasSession: false, lastLine: null, lastTurn: null, sampleLine: null, values: null },
      placeholders: [],
      defaultTemplate: '',
    }
    const listeners = new Set()
    const emit = () => { for (const fn of listeners) fn(state) }

    async function refresh () {
      try {
        const r = await fetch(API + '/state', { headers: { accept: 'application/json' } })
        if (!r.ok) throw new Error('HTTP ' + r.status)
        const j = await r.json()
        state = { ...state, loading: false, error: null, version: j.version, settings: j.settings, inject: j.inject, placeholders: j.placeholders || [], defaultTemplate: j.defaultTemplate || '' }
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

    // ═══ 4. 样式（只用主题 token，全部带 fallback）══════════════════════
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
      textarea: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: '12.5px', lineHeight: 1.6, padding: '8px 10px', resize: 'vertical',
        border: '1px solid ' + C.border, borderRadius: '6px', background: 'transparent', color: C.text,
        minHeight: '56px', width: '100%', boxSizing: 'border-box',
      },
      hint: { fontSize: '12px', color: C.dim, lineHeight: 1.5 },
      headToggle: { display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '14px' },
      headToggleLabel: { fontSize: '12px', color: C.dim },
      phList: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '6px' },
      phRow: {
        display: 'grid', gap: '2px', padding: '6px 9px', alignContent: 'start',
        border: 'none', background: 'transparent', color: C.text,
        textAlign: 'left', cursor: 'pointer', borderRadius: '6px', width: '100%', boxSizing: 'border-box',
      },
      phKey: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: '12px', color: C.accent, lineHeight: 1.4,
      },
      phDesc: { fontSize: '11.5px', color: C.dim, lineHeight: 1.45 },
      phRowHover: { background: C.surface },
      previewBox: { borderLeft: '2px solid ' + C.accent, paddingLeft: '10px', display: 'grid', gap: '6px', marginTop: '4px' },
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
      btn: (disabled) => ({
        padding: '5px 12px', fontSize: '13px', borderRadius: C.radiusSm,
        border: '1px solid ' + C.border, background: 'transparent', color: C.text,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
      }),
      msg: (bad) => ({ fontSize: '12px', color: bad ? 'var(--dsw-alias-danger, #e5534b)' : C.dim }),
      foot: { fontSize: '12px', color: C.dim, lineHeight: 1.6, margin: 0 },
    }

    // ═══ 5. 通用组件 ═══════════════════════════════════════════════════
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

    /** 占位符行：hover / 聚焦时整行高亮，并在右侧浮出「点击插入」。 */
    function PhRow ({ pkey, desc, onPick }) {
      const [hot, setHot] = useState(false)
      return h('button', {
        type: 'button',
        style: hot ? { ...S.phRow, ...S.phRowHover } : S.phRow,
        // 只用 hover：加 onFocus 后点击会留下焦点，边框一直不消失
        onMouseEnter: () => setHot(true),
        onMouseLeave: () => setHot(false),
        onClick: () => onPick(pkey),
      },
        h('code', { style: S.phKey }, '{' + pkey + '}'),
        h('span', { style: S.phDesc }, desc),
      )
    }

    function Line ({ text, placeholder }) {
      return text
        ? h('div', { style: S.line }, text)
        : h('div', { style: S.empty }, placeholder)
    }

    // ═══ 6. 设置页（slot: settings.section）═════════════════════════════
    function SettingsCard () {
      const s = useStore()
      const [busy, setBusy] = useState(false)
      const [msg, setMsg] = useState(null)
      const [tpl, setTpl] = useState(s.settings.template ?? '')
      const [tplDirty, setTplDirty] = useState(false)
      const serverTpl = useRef(s.settings.template ?? '')
      /** 指向模板 textarea，用于把占位符插到光标处而不是末尾 */
      const tplRef = useRef(null)

      // 轮询不能覆盖用户正在编辑的模板
      useEffect(() => {
        const next = s.settings.template ?? ''
        if (next !== serverTpl.current) {
          serverTpl.current = next
          if (!tplDirty) setTpl(next)
        }
      }, [s.settings.template, tplDirty])

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

      /** 把 {key} 插入到 textarea 当前光标处（有选区则替换选区），然后把光标放到 token 之后。 */
      const insertPlaceholder = (key) => {
        const token = '{' + key + '}'
        const el = tplRef.current
        const start = el && typeof el.selectionStart === 'number' ? el.selectionStart : tpl.length
        const end = el && typeof el.selectionEnd === 'number' ? el.selectionEnd : start
        const next = tpl.slice(0, start) + token + tpl.slice(end)
        setTpl(next)
        setTplDirty(true)
        // 受控组件要等 React 把新值写回 DOM 之后才能设光标
        const pos = start + token.length
        const focusAfter = () => {
          if (!el) return
          el.focus()
          if (typeof el.setSelectionRange === 'function') el.setSelectionRange(pos, pos)
        }
        if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(focusAfter)
        else setTimeout(focusAfter, 0)
      }

      const inject = s.inject || {}
      const injecting = s.settings.enabled && s.settings.injectPerTurn
      // 占位符的格式化在宿主完成，这里只做替换，规则与宿主一致：
      // 未知占位符原样保留，已知占位符的值直接拼接。
      const livePreview = renderPreview(tpl, inject.values)
      const statusText = s.error ? ('连接异常：' + s.error)
        : s.loading ? '正在读取…'
          : injecting ? '已开启：每轮自动注入'
            : '已关闭：仅 Agent 主动查询'

      return h('div', { style: S.card },
        h('div', { style: S.head },
          h('h3', { style: S.title }, '上下文自知'),
          s.version ? h('span', { style: S.badge }, 'v' + s.version) : null,
          h('span', { style: S.status }, statusText),
          // 总开关在头部，一眼可见、一步可达
          h('div', { style: S.headToggle },
            h('span', { style: S.headToggleLabel }, s.settings.enabled ? '已启用' : '已停用'),
            h(Toggle, {
              on: s.settings.enabled,
              label: '启用插件',
              onChange: (v) => apply({ enabled: v }, v ? '已启用' : '已停用'),
            }),
          ),
        ),
        h('p', { style: S.desc },
          '让 Agent 能读到自己的上下文占用：既可以通过 context_usage 工具主动查询，'
          + '也可以在每轮开头自动注入一行读数。你在聊天框下方的占用条由宿主显示，与本插件无关。'),

        h(Row, {
          title: '每轮把上下文注入到对话中',
          desc: '开启：每个回合的第一次工具调用前，主动把按模板生成的文案塞进当前回合。'
            + '关闭：完全不注入，只保留 Agent 主动调用 context_usage 的能力。',
          control: h(Toggle, {
            on: s.settings.injectPerTurn,
            label: '每轮把上下文注入到对话中',
            onChange: (v) => apply({ injectPerTurn: v }, v ? '已开启每轮注入' : '已关闭每轮注入，仅保留工具查询'),
          }),
        }),


        // 条件渲染：只有开启每轮注入时才需要编辑模板
        s.settings.injectPerTurn
          ? h('div', { style: S.panel },
            h('div', { style: S.label }, '注入模板　用 {占位符} 取数，留空表示不注入'),
            h('textarea', {
              ref: tplRef,
              style: S.textarea,
              rows: 3,
              spellCheck: false,
              value: tpl,
              'aria-label': '注入模板',
              onChange: (e) => { setTpl(e.target.value); setTplDirty(true) },
            }),
            h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
              h('button', {
                type: 'button',
                style: S.btn(busy || !tplDirty),
                disabled: busy || !tplDirty,
                onClick: async () => {
                  await apply({ template: tpl }, tpl.trim() ? '模板已保存' : '模板已清空：将不再注入')
                  setTplDirty(false)
                },
              }, '保存模板'),
              h('button', {
                type: 'button',
                style: S.btn(busy),
                disabled: busy,
                onClick: async () => {
                  if (!s.defaultTemplate) return
                  setTpl(s.defaultTemplate)
                  setTplDirty(true)
                },
              }, '恢复默认'),
              tplDirty ? h('span', { style: { fontSize: '12px', color: C.dim } }, '未保存') : null,
            ),

            // 实时预览紧贴模板，中间不隔其他内容
            h('div', { style: S.previewBox },
              h('div', { style: S.label },
                '实时预览',
                h('span', { style: { opacity: 0.7 } }, tplDirty ? '未保存，保存后生效' : '与已保存模板一致'),
              ),
              h(Line, {
                text: livePreview || null,
                placeholder: inject.values
                  ? '模板为空，不会注入任何内容'
                  : (inject.hasSession ? '本会话还没有 provider 上报的用量，下一轮就会生成' : '本会话还没有工具调用记录，暂时无法生成'),
              }),
              h('div', { style: S.label },
                '最近一次实际注入',
                inject.lastTurn !== null ? h('span', { style: { opacity: 0.8 } }, '（第 ' + inject.lastTurn + ' 回合）') : null,
              ),
              h(Line, { text: inject.lastLine, placeholder: '本回合还没到注入时机（注入发生在本轮第一次工具调用前）' }),
            ),

            h('div', { style: S.label }, '可用占位符（点击插入到光标处）'),
            h('div', { style: S.phList },
              (s.placeholders || []).map((p) => h(PhRow, {
                key: p.key,
                pkey: p.key,
                desc: p.desc || '',
                onPick: insertPlaceholder,
              })),
            ),
            h('div', { style: S.hint },
              '未知的占位符会原样保留（便于发现拼错）；已知但暂时取不到值的会显示 ?。'),
          )
          : null,

        msg ? h('div', { style: S.msg(msg.bad) }, msg.text) : null,
        h('p', { style: S.foot },
          'pressureTokens = 未缓存输入 + 缓存读 + 缓存写（不含输出），与 DSH 内部 contextPressure 口径一致。'
          + '数据来自会话投影，重启后不必等新事件即可读到。设置保存在 ~/.dsh/dsh-context-usage.json。'),
      )
    }

    // ═══ 7. 注册 ═══════════════════════════════════════════════════════
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
