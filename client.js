// dsh-context-usage — 浏览器半 / browser half
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
  id: 'dsh-context-usage-for-agent',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    // ═══ 1. 常量 ═══════════════════════════════════════════════════════
    const API = '/api/dsh-context-usage'
    const POLL_MS = 2000
    const LOG = '[dsh-context-usage-for-agent]'
    const PLACEHOLDER_RE = /\{([A-Za-z][A-Za-z0-9]*)\}/g

    // 界面文案：走宿主 locale 服务（ctx.locale），随界面语言切换即时更新。
    // locale/*.json 只放插件清单的 meta，不承载界面文案——界面字典必须内联在 client 里。
    const NS = 'contextUsage'
    const DICTS = {
      zh: {
        nav: '上下文自知',
        title: '上下文自知',
        'status.error': '连接异常：{error}',
        'status.reading': '正在读取…',
        'status.on': '已开启：每轮自动注入',
        'status.off': '已关闭：仅 Agent 主动查询',
        enabled: '已启用',
        disabled: '已停用',
        togglePlugin: '启用插件',
        desc1: '让 Agent 能读到自己的上下文占用：既可以通过 context_usage 工具主动查询，',
        desc2: '也可以在每轮开头自动注入一行读数。你在聊天框下方的占用条由宿主显示，与本插件无关。',
        rowTitle: '每轮把上下文注入到对话中',
        rowDesc1: '开启：每个回合的第一次工具调用前，主动把按模板生成的文案塞进当前回合。',
        rowDesc2: '关闭：完全不注入，只保留 Agent 主动调用 context_usage 的能力。',
        injectOn: '已开启每轮注入',
        injectOff: '已关闭每轮注入，仅保留工具查询',
        modeLabel: '注入方式',
        modeThreshold: '到阈值提醒',
        modeEveryTurn: '每轮读数',
        modeOff: '关闭',
        modeHint: '阈值：用量达到阈值时提醒一次，提醒用户收尾；每轮：每回合注入一行读数；关闭：只保留 context_usage 工具查询。',
        thresholdLabel: '提醒阈值',
        thresholdHint: '用量首次达到该百分比时注入提醒。',
        thresholdCurrent: '当前 {percent}%',
        toolLabel: '暴露 context_usage 工具',
        toolHint: '默认关闭：Agent 看不到这个工具，只能等阈值提醒。开启后 Agent 可随时查询，但容易把读数当预算、反复查询。',
        toolOn: '已暴露',
        toolOff: '未暴露',
        templateLabel: '注入模板　用 {占位符} 取数，留空表示不注入',
        remindLabel: '提醒文案　用 {占位符} 取数，留空表示不提醒',
        templateAria: '注入模板',
        templateSaved: '模板已保存',
        templateCleared: '模板已清空：将不再注入',
        saveTemplate: '保存模板',
        restoreDefault: '恢复默认',
        unsaved: '未保存',
        preview: '实时预览',
        previewUnsaved: '未保存，保存后生效',
        previewSynced: '与已保存模板一致',
        emptyTemplate: '模板为空，不会注入任何内容',
        noUsage: '本会话还没有 provider 上报的用量，下一轮就会生成',
        noTools: '本会话还没有工具调用记录，暂时无法生成',
        lastInject: '最近一次实际注入',
        turnN: '（第 {turn} 回合）',
        notYet: '本回合还没到注入时机（注入发生在本轮第一次工具调用前）',
        placeholders: '可用占位符（点击插入到光标处）',
        phHint: '未知的占位符会原样保留（便于发现拼错）；已知但暂时取不到值的会显示 ?。',
        foot1: 'pressureTokens = 未缓存输入 + 缓存读 + 缓存写（不含输出），与 DSH 内部 contextPressure 口径一致。',
        foot2: '数据来自会话投影，重启后不必等新事件即可读到。设置保存在 ~/.dsh/dsh-context-usage.json。',
        saveFailed: '保存失败：{error}',
        stillRunning: '请确认 DSH 仍在运行',
        'err.host': '无法连接宿主路由'
      },
      en: {
        nav: 'Context Self-Awareness',
        title: 'Context Self-Awareness',
        'status.error': 'Connection error: {error}',
        'status.reading': 'Reading…',
        'status.on': 'On: injects every turn',
        'status.off': 'Off: agent-only queries',
        enabled: 'Enabled',
        disabled: 'Disabled',
        togglePlugin: 'Enable plugin',
        desc1: 'Lets the agent read its own context usage: it can call the context_usage tool on demand,',
        desc2: ' and this plugin can inject one reading line at the start of every turn. The usage bar under the composer belongs to the host, not to this plugin.',
        rowTitle: 'Inject context into the conversation every turn',
        rowDesc1: 'On: before the first tool call of each turn, the rendered template is injected into that turn.',
        rowDesc2: 'Off: nothing is injected; the agent can still call context_usage itself.',
        injectOn: 'Per-turn injection on',
        injectOff: 'Per-turn injection off; tool queries only',
        modeLabel: 'Injection mode',
        modeThreshold: 'Remind at threshold',
        modeEveryTurn: 'Reading every turn',
        modeOff: 'Off',
        modeHint: 'Threshold: remind once when usage reaches the limit and suggest a wrap-up. Every turn: inject one reading line per turn. Off: keep only the context_usage tool.',
        thresholdLabel: 'Reminder threshold',
        thresholdHint: 'Inject the reminder the first time usage reaches this percentage.',
        thresholdCurrent: 'Currently {percent}%',
        toolLabel: 'Expose the context_usage tool',
        toolHint: 'Off by default: the agent cannot see the tool and waits for the threshold reminder. When on, the agent can query any time, but tends to treat the number as a budget and query repeatedly.',
        toolOn: 'Exposed',
        toolOff: 'Hidden',
        templateLabel: 'Injection template　use {placeholder} tokens; leave empty to inject nothing',
        remindLabel: 'Reminder text　use {placeholder} tokens; leave empty to send nothing',
        templateAria: 'Injection template',
        templateSaved: 'Template saved',
        templateCleared: 'Template cleared: nothing will be injected',
        saveTemplate: 'Save template',
        restoreDefault: 'Restore default',
        unsaved: 'Unsaved',
        preview: 'Live preview',
        previewUnsaved: 'Unsaved; takes effect after saving',
        previewSynced: 'Matches the saved template',
        emptyTemplate: 'Template is empty; nothing will be injected',
        noUsage: 'The provider has not reported usage this session yet; it appears next turn',
        noTools: 'No tool calls yet this session, so nothing can be generated',
        lastInject: 'Last actual injection',
        turnN: '(turn {turn})',
        notYet: 'Not injected yet this turn (injection happens before the first tool call)',
        placeholders: 'Available placeholders (click to insert at the cursor)',
        phHint: 'Unknown placeholders stay as-is so typos are visible; known ones without a value show ?.',
        foot1: 'pressureTokens = uncached input + cache read + cache write (outputs excluded), matching DSH internal contextPressure.',
        foot2: 'Data comes from the session projection, so a restart does not need new events. Settings live in ~/.dsh/dsh-context-usage.json.',
        saveFailed: 'Save failed: {error}',
        stillRunning: 'Make sure DSH is still running',
        'err.host': 'Cannot reach the host route'
      }
    }

    /** 占位符替换，语义与宿主 locale 的 translate 一致（`{name}` → params.name）。 */
    function fill (template, params) {
      if (!params) return template
      return template.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
    }

    // apply 前只有兜底值（内置中文）；宿主 locale 可用时替换为 bind(NS)。
    let t = (key, params) => fill(DICTS.zh[key] === undefined ? key : DICTS.zh[key], params)

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
      settings: { enabled: true, injectMode: 'threshold', threshold: 75, template: '', remindTemplate: '', contextWindow: 1000000, compactAtRatio: null },
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
        // 载荷缺字段时保留上一份状态：宿主返回异常结构不能让整页崩成空白
        // （tools\test-client-render.mjs 的「无响应」阶段会真的喂一个空载荷）
        state = { ...state, loading: false, error: null, version: j.version, settings: j.settings || state.settings, inject: j.inject || state.inject, placeholders: j.placeholders || [], defaultTemplate: j.defaultTemplate || '' }
      } catch (e) {
        state = { ...state, loading: false, error: (e && e.message) || t('err.host') }
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
      state = { ...state, settings: j.settings || state.settings, inject: j.inject || state.inject, error: null }
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
    // @ui-kit v1.3.0  共享 UI 基座（源：plugins/_shared/ui-kit.js；改源后重新复制本段）
    // ═════════════════════════════ [C] 颜色 token ═════════════════════════
    const C = {
      border: 'var(--dsw-alias-border-subtle, rgba(130,130,140,0.28))',
      text: 'var(--dsw-alias-text-primary, inherit)',
      dim: 'var(--dsw-alias-text-secondary, rgba(140,140,150,1))',
      accent: 'var(--dsw-alias-accent, #4f7cff)',
      surface: 'var(--dsw-alias-surface-raised, rgba(130,130,140,0.06))',
      ok: 'var(--dsw-alias-success, #2f9e6b)',
      warn: 'var(--dsw-alias-warning, #c8862a)',
      danger: 'var(--dsw-alias-danger, #e5534b)',
      radius: 'var(--dsw-radius-lg, 12px)',
      radiusSm: 'var(--dsw-radius-sm, 8px)',
      mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    }

    // ═════════════════════════ [S_BASE] 通用样式 ═════════════════════════
    // 插件用 `{ ...S_BASE, ...特有键 }` 组装自己的 S，特有键不要回填本文件。
    const S_BASE = {
      card: { border: '1px solid ' + C.border, borderRadius: C.radius, padding: '16px 18px', display: 'grid', gap: '14px', color: C.text },
      head: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' },
      title: { fontSize: '15px', fontWeight: 600, margin: 0 },
      badge: { fontSize: '12px', color: C.dim, border: '1px solid ' + C.border, borderRadius: '999px', padding: '1px 8px' },
      status: { marginLeft: 'auto', fontSize: '12px', color: C.dim },
      desc: { margin: 0, fontSize: '13px', lineHeight: 1.6, color: C.dim },
      /* 行布局自适应：空间不够时控件整体换到下一行，而不是把标题挤成一字一列 */
      row: { display: 'flex', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' },
      rowText: { display: 'grid', gap: '2px', flex: '1 1 200px', minWidth: '180px' },
      rowTitle: { fontSize: '13px', fontWeight: 550 },
      rowDesc: { fontSize: '12px', color: C.dim, lineHeight: 1.5 },
      field: { display: 'grid', gap: '4px' },
      label: { fontSize: '12px', color: C.dim },
      hint: { fontSize: '12px', color: C.dim, lineHeight: 1.5 },
      inline: { display: 'flex', alignItems: 'center', gap: '8px', flex: '0 1 auto', flexWrap: 'wrap', justifyContent: 'flex-end' },
      toggle: (on) => ({
        width: '38px', height: '22px', borderRadius: '999px', border: '1px solid ' + C.border,
        background: on ? C.accent : 'rgba(130,130,140,0.25)', position: 'relative', cursor: 'pointer',
        flex: 'none', marginTop: '2px', transition: 'background 160ms ease',
      }),
      knob: (on) => ({
        position: 'absolute', top: '2px', left: on ? '18px' : '2px', width: '16px', height: '16px',
        borderRadius: '50%', background: '#fff', transition: 'left 160ms ease',
      }),
      chip: (on) => ({
        padding: '3px 10px', fontSize: '12px', borderRadius: '999px', cursor: 'pointer',
        border: '1px solid ' + (on ? C.accent : C.border),
        background: on ? C.accent : 'transparent',
        color: on ? '#fff' : C.dim,
      }),
      chips: { display: 'flex', gap: '6px', flexWrap: 'wrap', minWidth: 0 },
      panel: { background: C.surface, borderRadius: C.radiusSm, padding: '12px 14px', display: 'grid', gap: '10px' },
      input: {
        width: '110px', padding: '5px 8px', fontSize: '13px', textAlign: 'right',
        border: '1px solid ' + C.border, borderRadius: C.radiusSm, background: 'transparent', color: C.text,
      },
      textarea: {
        fontFamily: C.mono, fontSize: '12.5px', lineHeight: 1.6, padding: '8px 10px',
        resize: 'vertical', border: '1px solid ' + C.border, borderRadius: '6px',
        background: 'transparent', color: C.text, minHeight: '56px', width: '100%', boxSizing: 'border-box',
      },
      /* 文本输入：与 textarea 同族的全宽、等宽、左对齐；行内需要伸缩时在使用处加 flex */
      textInput: {
        width: '100%', boxSizing: 'border-box',
        fontFamily: C.mono, fontSize: '12.5px', lineHeight: 1.6, padding: '7px 9px',
        border: '1px solid ' + C.border, borderRadius: '6px',
        background: 'transparent', color: C.text,
      },
      btn: (disabled) => ({
        padding: '5px 12px', fontSize: '13px', borderRadius: C.radiusSm,
        border: '1px solid ' + C.border, background: 'transparent', color: C.text,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, flex: 'none',
      }),
      link: { fontSize: '13px', padding: '5px 12px', borderRadius: C.radiusSm, border: '1px solid ' + C.border, background: 'transparent', color: C.text, cursor: 'pointer' },
      line: {
        fontFamily: C.mono, fontSize: '12.5px', lineHeight: 1.6, wordBreak: 'break-all',
        background: 'rgba(130,130,140,0.12)', borderRadius: '6px', padding: '8px 10px', color: C.text,
      },
      empty: { fontSize: '12.5px', color: C.dim, fontStyle: 'italic' },
      msg: (bad) => ({ fontSize: '12px', color: bad ? C.danger : C.dim }),
      foot: { fontSize: '12px', color: C.dim, lineHeight: 1.6, margin: 0 },
      mono: { fontFamily: C.mono, wordBreak: 'break-all' },
      statItem: { display: 'grid', gap: '2px' },
      statValue: { fontSize: '18px', fontWeight: 600 },
      statKey: { fontSize: '12px', color: C.dim },
      range: { width: '100%', accentColor: C.accent, cursor: 'pointer' },
      sliderHead: { display: 'flex', alignItems: 'baseline', gap: '8px', justifyContent: 'space-between' },
      sliderValue: { fontSize: '13px', fontWeight: 600, fontFamily: C.mono },
    }

    // ═════════════════════════ [组件] 通用控件 ═════════════════════════
    /** 开关按钮。 */
    function Toggle ({ on, label, onChange }) {
      return h('button', {
        type: 'button',
        'aria-label': label,
        'aria-pressed': on ? 'true' : 'false',
        style: S.toggle(on),
        onClick: () => onChange(!on),
      }, h('span', { style: S.knob(on) }))
    }

    /** 一行设置：左标题与说明，右控件。 */
    function Row ({ title, desc, control }) {
      return h('div', { style: S.row },
        h('div', { style: S.rowText },
          h('div', { style: S.rowTitle }, title),
          desc ? h('div', { style: S.rowDesc }, desc) : null,
        ),
        control,
      )
    }

    /** 一行文本：有值显示内容，无值显示占位说明。 */
    function Line ({ text, placeholder }) {
      return text
        ? h('div', { style: S.line }, text)
        : h('div', { style: S.empty }, placeholder)
    }

    /** 标签 + 值（值默认等宽）。 */
    function Field ({ label, value, mono }) {
      return h('div', { style: S.field },
        h('span', { style: S.label }, label),
        h('span', { style: mono === false ? { fontSize: '12.5px' } : { fontFamily: C.mono, fontSize: '12.5px' } }, value),
      )
    }

    /** 百分比滑条。valueText 传当前值的可读形式（如 "30%"），不传则只显示标签。 */
    function Slider ({ label, value, min, max, step, hint, valueText, disabled, onChange }) {
      return h('div', { style: S.field },
        h('div', { style: S.sliderHead },
          h('span', { style: S.rowTitle }, label),
          valueText ? h('span', { style: S.sliderValue }, valueText) : null,
        ),
        h('input', {
          type: 'range',
          min,
          max,
          step,
          value: Number(value) || 0,
          style: S.range,
          'aria-label': label,
          disabled,
          onChange: (e) => onChange(Number(e.target.value)),
        }),
        hint ? h('span', { style: S.hint }, hint) : null,
      )
    }

    /** 数据卡片：一个数值 + 一句说明。 */
    function Stat ({ value, label }) {
      return h('div', { style: S.statItem },
        h('div', { style: S.statValue }, value),
        h('div', { style: S.statKey }, label),
      )
    }

    /** 互斥选项组（药丸按钮）。options 为 `[[value, label], ...]`。 */
    function ChipGroup ({ value, options, disabled, onChange }) {
      return h('div', { style: S.chips },
        options.map(([key, label]) => h('button', {
          key,
          type: 'button',
          style: S.chip(value === key),
          'aria-pressed': value === key ? 'true' : 'false',
          disabled,
          onClick: () => onChange(key, label),
        }, label))
      )
    }


    /** 本插件特有样式，叠加在共享基座之上。 */
    const S = {
      ...S_BASE,
      // 头部总开关
      headToggle: { display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '14px' },
      headToggleLabel: { fontSize: '12px', color: C.dim },
      // 占位符列表
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
      // 模板预览框
      previewBox: { borderLeft: '2px solid ' + C.accent, paddingLeft: '10px', display: 'grid', gap: '6px', marginTop: '4px' },
      // 与基座同名但细节不同的覆盖（保持零视觉差异）
      label: { fontSize: '12px', color: C.dim, display: 'flex', alignItems: 'center', gap: '6px' },
      row: { ...S_BASE.row, paddingTop: '4px' },
      btn: (disabled) => ({
        padding: '5px 12px', fontSize: '13px', borderRadius: C.radiusSm,
        border: '1px solid ' + C.border, background: 'transparent', color: C.text,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
      }),
    }

    // ═══ 5. 通用组件 ═══════════════════════════════════════════════════
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

    function TemplatePanel ({
      labels, placeholders, value, preview, dirty, busy,
      lastLine, lastTurnLabel, emptyPlaceholder, textareaRef,
      onEdit, onSave, onReset, onPick,
    }) {
      return h('div', { style: S.panel },
        h('div', { style: S.label }, labels.title),
        h('textarea', {
          ref: textareaRef,
          style: S.textarea,
          rows: 3,
          spellCheck: false,
          value,
          'aria-label': labels.aria,
          onChange: (e) => onEdit(e.target.value),
        }),
        h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
          h('button', {
            type: 'button',
            style: S.btn(busy || !dirty),
            disabled: busy || !dirty,
            onClick: onSave,
          }, labels.save),
          h('button', {
            type: 'button',
            style: S.btn(busy),
            disabled: busy,
            onClick: onReset,
          }, labels.reset),
          dirty ? h('span', { style: { fontSize: '12px', color: C.dim } }, labels.unsaved) : null,
        ),
        h('div', { style: S.previewBox },
          h('div', { style: S.label },
            labels.preview,
            h('span', { style: { opacity: 0.7 } }, dirty ? labels.previewUnsaved : labels.previewSynced),
          ),
          h(Line, { text: preview || null, placeholder: emptyPlaceholder }),
          h('div', { style: S.label },
            labels.lastInject,
            lastTurnLabel ? h('span', { style: { opacity: 0.8 } }, lastTurnLabel) : null,
          ),
          h(Line, { text: lastLine, placeholder: labels.notYet }),
        ),
        h('div', { style: S.label }, labels.placeholders),
        h('div', { style: S.phList },
          (placeholders || []).map((p) => h(PhRow, { key: p.key, pkey: p.key, desc: p.desc || '', onPick })),
        ),
        h('div', { style: S.hint }, labels.phHint),
      )
    }

    // ═══ 6. 设置页（slot: settings.section）═════════════════════════════
    function SettingsCard () {
      const s = useStore()
      const [busy, setBusy] = useState(false)
      const [msg, setMsg] = useState(null)
      /** 指向模板 textarea，用于把占位符插到光标处而不是末尾 */
      const tplRef = useRef(null)

      // 注入模式决定编辑哪一份模板；切换模式时丢弃未保存草稿
      const mode = s.settings.injectMode || 'threshold'
      const field = mode === 'everyTurn' ? 'template' : 'remindTemplate'
      const serverTpl = (mode === 'everyTurn' ? s.settings.template : s.settings.remindTemplate) ?? ''
      const [draft, setDraft] = useState({ field: null, value: '' })
      const editing = draft.field === field
      const tpl = editing ? draft.value : serverTpl
      const tplDirty = editing && draft.value !== serverTpl
      const setTpl = (value) => setDraft({ field, value })

      // 模式或服务端值变化时丢弃草稿，避免把 A 模板的编辑带进 B
      useEffect(() => {
        setDraft({ field: null, value: '' })
      }, [field, serverTpl])

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
          flash(t('saveFailed', { error: (e && e.message) || t('stillRunning') }), true)
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
      const injecting = s.settings.enabled && mode !== 'off'
      // 占位符的格式化在宿主完成，这里只做替换，规则与宿主一致：
      // 未知占位符原样保留，已知占位符的值直接拼接。
      const livePreview = renderPreview(tpl, inject.values)
      const statusText = s.error ? t('status.error', { error: s.error })
        : s.loading ? t('status.reading')
          : injecting ? t('status.on')
            : t('status.off')

      return h('div', { style: S.card },
        h('div', { style: S.head },
          h('h3', { style: S.title }, t('title')),
          s.version ? h('span', { style: S.badge }, 'v' + s.version) : null,
          h('span', { style: S.status }, statusText),
          // 总开关在头部，一眼可见、一步可达
          h('div', { style: S.headToggle },
            h('span', { style: S.headToggleLabel }, s.settings.enabled ? t('enabled') : t('disabled')),
            h(Toggle, {
              on: s.settings.enabled,
              label: t('togglePlugin'),
              onChange: (v) => apply({ enabled: v }, v ? t('enabled') : t('disabled')),
            }),
          ),
        ),
        h('p', { style: S.desc }, t('desc1') + t('desc2')),

        h(Row, {
          title: t('modeLabel'),
          desc: t('modeHint'),
          control: h(ChipGroup, {
            value: mode,
            options: [['threshold', t('modeThreshold')], ['everyTurn', t('modeEveryTurn')], ['off', t('modeOff')]],
            disabled: busy,
            onChange: (key, label) => apply({ injectMode: key }, label),
          }),
        }),

        h(Row, {
          title: t('toolLabel'),
          desc: t('toolHint'),
          control: h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
            h('span', { style: S.hint }, s.settings.toolEnabled === true ? t('toolOn') : t('toolOff')),
            h(Toggle, {
              on: s.settings.toolEnabled === true,
              label: t('toolLabel'),
              onChange: (v) => apply({ toolEnabled: v }, v ? t('toolOn') : t('toolOff')),
            })
          ),
        }),

        // 阈值只在阈值模式下有意义
        mode === 'threshold'
          ? h(Slider, {
            label: t('thresholdLabel'),
            value: s.settings.threshold || 0,
            valueText: (s.settings.threshold || 0) + '%',
            min: 0,
            max: 100,
            step: 5,
            hint: t('thresholdHint'),
            disabled: busy,
            onChange: (value) => apply({ threshold: value }),
          })
          : null,

        // 条件渲染：关闭注入时不显示模板
        mode !== 'off'
          ? h(TemplatePanel, {
            labels: {
              title: mode === 'everyTurn' ? t('templateLabel') : t('remindLabel'),
              aria: mode === 'everyTurn' ? t('templateAria') : t('remindLabel'),
              save: t('saveTemplate'),
              reset: t('restoreDefault'),
              unsaved: t('unsaved'),
              preview: t('preview'),
              previewUnsaved: t('previewUnsaved'),
              previewSynced: t('previewSynced'),
              lastInject: t('lastInject'),
              notYet: t('notYet'),
              placeholders: t('placeholders'),
              phHint: t('phHint'),
            },
            placeholders: s.placeholders,
            value: tpl,
            preview: livePreview,
            dirty: tplDirty,
            busy,
            lastLine: inject.lastLine,
            lastTurnLabel: inject.lastTurn !== null ? t('turnN', { turn: inject.lastTurn }) : null,
            emptyPlaceholder: inject.values
              ? t('emptyTemplate')
              : (inject.hasSession ? t('noUsage') : t('noTools')),
            textareaRef: tplRef,
            onEdit: setTpl,
            onSave: async () => { await apply({ [field]: tpl }, tpl.trim() ? t('templateSaved') : t('templateCleared')) },
            onReset: () => { if (s.defaultTemplate) setTpl(s.defaultTemplate) },
            onPick: insertPlaceholder,
          })
          : null,

        msg ? h('div', { style: S.msg(msg.bad) }, msg.text) : null,
        h('p', { style: S.foot }, t('foot1') + t('foot2')),
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

    const inject = ['slots', 'locale']

    function apply (ctx) {
      // 界面文案接入宿主 locale：注册字典后 t 指向 bind(NS)，切换语言即时生效。
      // 精简组合或测试替身可能没有 locale 服务——判存在后退回内置中文，不让整块 UI 崩掉。
      if (ctx.locale && typeof ctx.locale.register === 'function' && typeof ctx.locale.bind === 'function') {
        ctx.effect(() => ctx.locale.register(NS, DICTS), 'context-usage-dicts')
        t = ctx.locale.bind(NS)
      } else {
        console.warn(LOG, 'locale 服务不可用：界面文案固定中文')
      }

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
          { name: 'settings.section', id: 'context-usage', order: 215, locale: NS, label: () => t('nav') },
          SettingsCard,
          'settings.section',
        ),
        'context-usage-settings-section',
      )
    }

    return { inject, apply }
  },
})
