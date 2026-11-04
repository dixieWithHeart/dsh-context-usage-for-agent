# @local/dsh-context-usage-for-agent（上下文自知）

显示 DSH 会话的上下文占用，三处呈现：

1. **`context_usage` 工具** —— Agent 主动查询当前占用百分比、已用 token、窗口大小、剩余量、缓存命中率。
2. **每轮自动一行读数** —— 本回合第一次工具调用前，往对话注入形如
   `[ctx 17.7%] 177k/1.00M · 缓存 99.4% · 余 823k` 的极短文本。
   运行中的 Agent 走 `steer`（下一步即可读到，不新开回合），空闲的走 `inject`（静默、不唤醒、不计费）。
3. **设置页**（设置 → 上下文用量）—— 实时占用进度条 + 三个开关 + 兜底窗口大小。

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
| `showCacheHit` | `true` | 读数里是否带缓存命中率 |
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
