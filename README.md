# dsh-context-usage-for-agent（上下文自知）

让 Agent 读到自己的上下文占用。三处呈现：

- **阈值提醒（默认）**：用量首次达到阈值（默认 75%）时注入一次提醒，建议用户收尾
- **可选工具**：`context_usage` 默认**不暴露**给 Agent；需要时在设置页打开（原因见下文）
- **可选每轮读数**：切成 `everyTurn` 模式后，每回合注入一行 `[ctx 17.7%] 已用 177k · 缓存 99.4%`
- **设置页**（设置 → 上下文自知）：注入开关、自定义模板、实时预览。

## 界面语言

设置页文案有中文与英文两套，跟随 DSH 界面语言（设置 → 常规 → 语言）即时切换，不需重启。插件清单里的名称与描述另由 `locale/zh.json` / `locale/en.json` 提供。

占位符列表里的小字描述来自宿主，目前只有中文。宿主若缺 locale 服务（精简组合），界面退回中文并在控制台留一条 warn。

## 安装

```powershell
dsh plugin add dsh-context-usage-for-agent
```

装完刷新页面。默认只做阈值提醒，`context_usage` 工具不暴露（设置页可开）。

## 数据来源

| 项 | 来源 |
| --- | --- |
| `pressureTokens` | `assistant/message` 的 `usage`：未缓存输入 + 缓存读 + 缓存写（不含输出） |
| `contextWindow` | `request/context` 的真实值，未到达前用配置兜底 |
| 回合号 | `turn/start` |

状态走会话投影（`ctx.sessionProjections`，key `contextUsage`），不订阅 `session/event`。冷读或重启后折叠日志即得当前值。

## 配置

`cordis.patch.yml` 的 `config` 是启动默认值；设置页写入 `~/.dsh/dsh-context-usage.json`，优先级更高。

| 项 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关。关掉只停注入，工具仍可用 |
| `injectMode` | `threshold` | 注入方式：`threshold` 到阈值提醒一次 / `everyTurn` 每轮一行读数 / `off` 不注入 |
| `toolEnabled` | `false` | 是否把 `context_usage` 工具暴露给 Agent；关闭时不注册，模型侧看不到 |
| `threshold` | `75` | 阈值模式的触发百分比 |
| `template` | `[ctx {percent}%] 已用 {used} · 缓存 {cache}%` | 每轮读数模板，留空即不注入 |
| `remindTemplate` | 见下 | 阈值提醒模板，留空即不提醒 |
| `contextWindow` | `1000000` | 仅兜底，provider 上报后以真实值为准 |
| `compactAtRatio` | `null` | 已知自动压缩阈值（0–1）时，工具回报距压缩还有几个百分点 |

### 注入方式

| 模式 | 行为 | 适合 |
| --- | --- | --- |
| `threshold`（默认） | 用量首次达到 `threshold` 时注入一次提醒，之后本会话不再打扰 | 不想让 Agent 每轮都盯着数字、只在快满时提醒它收尾 |
| `everyTurn` | 每回合第一次工具调用前注入一行读数 | 旧行为：想让 Agent 始终知道当前占用 |
| `off` | 不注入也不提醒 | 只想在设置页看数值 |

### 为什么默认不暴露工具

工具一进系统提示的工具清单，就是一次持续暗示：Agent 会反复查询，并把读数当预算用——查到 40% 就先决定"少读一个文件"，而不是"安心读完"。这会把上下文焦虑变成工作流退化（跳过必读文档、输出萎缩）。

阈值提醒把"何时该收尾"这件事交回插件：到点说一次，Agent 不必自己算。想保留查询能力再打开 `toolEnabled`。

阈值提醒的默认文案：

```text
注意：你目前的上下文用量是 {percent}%，你应当提醒用户注意上下文情况，建议用户发起收尾流程。
请保持工作流完整，不要因为上下文用量而破坏工作严谨性。
```

英文版：

```text
Note: your context usage is currently {percent}%. Remind the user about the context situation and suggest starting a wrap-up flow.
Keep the workflow intact; do not let context usage undermine the rigor of the work.
```

> 旧字段 `injectPerTurn` 会自动迁移：`true` → `everyTurn`，`false` → `off`。

### 占位符

| 占位符 | 含义 |
| --- | --- |
| `{percent}` | 占用百分比，如 `17.7` |
| `{used}` | 已用 token，带单位，如 `177k` |
| `{cache}` | 缓存命中率，如 `99.4` |

2026-11-11 起只保留这三个：`{window}` / `{remaining}` / `{usedRaw}` / `{turn}` / `{compact}` 等已下线，避免注入行越写越长。模板里若还写着旧占位符，它会**原样保留**（显示成 `{window}`），据此可判断哪里需要改。已知但取不到值显示 `?`。

## HTTP 路由

供设置页使用，无鉴权。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET/HEAD | `/api/dsh-context-usage/state` | 设置 + 实时占用 |
| POST | `/api/dsh-context-usage/set` | 部分更新设置 |

## 结构

```
index.js             装配
src/constants.js     常量与默认值
src/settings.js      配置读写与校验
src/usage/           投影、读数、模板（projection / state / template）
src/remind/          阈值判定与提醒（threshold / reminder / notice）
src/surface/         对外接口（tool / routes）
client.js            设置页
```

`client.js` 不拆：浏览器端只能 `require` 白名单模块，不能 import 相对路径文件。按分区锚点定位。

## 验证

```powershell
node tools/test-context-usage.mjs     # 62 条契约断言
node tools/test-threshold-mode.mjs    # 6 条阈值模式断言
node --check index.js client.js
```

浏览器端渲染无法脚本断言，需刷新页面目视。
