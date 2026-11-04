# dsh-context-usage-for-agent（上下文自知）

显示 DSH 会话的上下文占用，三处呈现：

1. **`context_usage` 工具** —— Agent 主动查询当前占用百分比、已用 token、窗口大小、剩余量、缓存命中率。
2. **每轮自动一行读数** —— 本回合第一次工具调用前，往对话注入形如
   `[ctx 17.7%] 177k/1.00M · 缓存 99.4% · 余 823k` 的极短文本。
   运行中的 Agent 走 `steer`（下一步即可读到，不新开回合），空闲的走 `inject`（静默、不唤醒、不计费）。
3. **设置页**（设置 → 上下文自知）—— 注入开关、可自定义模板、占位符面板与实时预览。

## 安装

```powershell
dsh plugin add dsh-context-usage-for-agent
```

装完刷新页面，在「设置 → 上下文自知」里开关每轮注入、改模板。工具 `context_usage` 立刻可用。

## 目录结构

宿主侧按职责拆分，依赖单向（index → 各模块 → constants），每个文件 40-90 行：

```
index.js              装配：把下面这些串起来（约 140 行）
src/constants.js      常量与占位符表（配置契约的单一来源）
src/settings.js       配置读取 / 校验 / 持久化
src/template.js       数值格式化与模板渲染
src/projection.js     会话投影单元
src/state.js          状态读取层（纯函数，settings 显式传参）
src/notice.js         往对话里塞通知
src/tool.js           context_usage 工具定义
src/routes.js         设置页 HTTP 路由
client.js             浏览器半（含设置页 UI）
```

> **`client.js` 为何不拆**：浏览器端通过 `window.__ModuleLoader__.load({ factory })` 注册，
> `factory` 里的 `require` 只能取到 `react` 这类白名单模块，不支持 import 项目内相对路径文件。
> 因此该文件按「常量 / 纯函数 / store / 样式 / 组件 / 设置页 / 注册」七个分区组织，
> 每区有 `═══ n. xxx ═══` 锚点注释，修改时按锚点定位，不要跨区大范围替换。

## 数据从哪来

全部是宿主已有事实，不做估算：

| 项 | 来源 |
| --- | --- |
| `pressureTokens` | 投影单元折叠 `assistant/message` 的 `usage`，口径 `未缓存输入 + 缓存读 + 缓存写`（不含输出） |
| `contextWindow` | 优先取 `request/context` 事件的真实值；未到达前用配置兜底 |
| 回合号 | `turn/start` 事件 |

口径核对：`inputTokens 1036 + cacheReadTokens 176128 = 177164`，加 `outputTokens 1507` 等于同一时刻的
`totalTokens 178671`，与 DSH 内部 `contextPressure` 定义一致。

## 状态用投影而不订阅事件

0.2.0 起注册 host-only 投影单元（`key: 'contextUsage'`、`stateVersion: 1`、无 `wire`），
`apply(state, event)` 纯同步，无关事件返回同一引用。依据是官方 `references/practices.md`：
由日志派生的每会话状态应放 `ctx.sessionProjections`，不要订阅 `session/event` 自行累加。

收益：折叠日志即得当前值，重启或冷读后不必等下一次 provider 上报。

三个源事件已实测确认都进会话日志（`request/context`、`assistant/message`、`turn/start`），
判断工具见 `tools/session-event-stats.mjs`。

## 配置

Host 行（`cordis.patch.yml`）里的 `config` 是启动默认值；用户在设置页改的值写在
`~/.dsh/dsh-context-usage.json`，优先级更高。

| 项 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关，关掉后不再自动注入读数（工具仍可调用） |
| `injectPerTurn` | `true` | 每轮自动一行读数 |
| `template` | 见下 | **注入文案模板**，用 `{占位符}` 取数；留空表示不注入 |

### 注入模板占位符

| 占位符 | 含义 |
| --- | --- |
| `{percent}` | 上下文用量百分比，如 `17.7` |
| `{used}` / `{usedRaw}` | 已用 token，带单位 / 原始数字 |
| `{window}` / `{windowRaw}` | 上下文总长度，带单位 / 原始数字 |
| `{remaining}` / `{remainingRaw}` | 剩余可用 token，带单位 / 原始数字 |
| `{cache}` | 缓存命中率百分比 |
| `{turn}` | 当前回合号 |
| `{compact}` | 距自动压缩还有几个百分点（需配置 `compactAtRatio`） |

默认模板：`[ctx {percent}%] {used}/{window} · 缓存 {cache}% · 余 {remaining}`

- 未知占位符**原样保留**，方便在预览里发现拼错。
- 已知但暂时取不到值的显示 `?`。
- `showCacheHit` 已于 0.5.0 退役——要不要缓存率改由模板决定。
| `contextWindow` | `1000000` | **仅兜底**，provider 上报后以真实值为准 |
| `compactAtRatio` | `null` | 若确知 DSH 自动压缩阈值（0..1），工具会回报「距压缩还有几个百分点」 |

HTTP 路由（供设置页使用，无鉴权，与 `dsh-auto-continue` 同款）：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET/HEAD | `/api/dsh-context-usage/state` | 当前设置 + 实时占用 |
| POST | `/api/dsh-context-usage/set` | 部分更新设置（JSON body） |

## 验证

```powershell
node .\tools\test-context-usage.mjs            # 56 条契约断言
node --check index.js; node --check client.js  # 语法
```

离线测试覆盖：工具 `output` 契约、投影折叠语义与引用同一性、冷启动即得值、每轮只注入一次、
`steer`/`inject` 分支、`source.kind`、HTTP 路由的读写与错误分支、投影服务缺席时的降级。

浏览器端渲染**无法脚本验证**，只能人工刷新页面目视确认。
