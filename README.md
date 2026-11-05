# dsh-context-usage-for-agent（上下文自知）

让 Agent 读到自己的上下文占用。三处呈现：

- **`context_usage` 工具**：查占用百分比、已用 / 窗口 / 剩余 token、缓存命中率。
- **每轮一行读数**：本回合首次工具调用前注入 `[ctx 17.7%] 177k/1.00M · 缓存 99.4% · 余 823k`。
- **设置页**（设置 → 上下文自知）：注入开关、自定义模板、实时预览。

## 安装

```powershell
dsh plugin add dsh-context-usage-for-agent
```

装完刷新页面。工具立刻可用，每轮读数默认开启。

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
| `enabled` | `true` | 总开关。关掉只停每轮读数，工具仍可用 |
| `injectPerTurn` | `true` | 每轮注入一行 |
| `template` | `[ctx {percent}%] {used}/{window} · 缓存 {cache}% · 余 {remaining}` | 注入文案，留空即不注入 |
| `contextWindow` | `1000000` | 仅兜底，provider 上报后以真实值为准 |
| `compactAtRatio` | `null` | 已知自动压缩阈值（0–1）时，工具回报距压缩还有几个百分点 |

### 占位符

| 占位符 | 含义 |
| --- | --- |
| `{percent}` | 占用百分比，如 `17.7` |
| `{used}` / `{usedRaw}` | 已用 token，带单位 / 原始数字 |
| `{window}` / `{windowRaw}` | 窗口大小，带单位 / 原始数字 |
| `{remaining}` / `{remainingRaw}` | 剩余 token，带单位 / 原始数字 |
| `{cache}` | 缓存命中率 |
| `{turn}` | 回合号 |
| `{compact}` | 距压缩百分点（需配 `compactAtRatio`） |

未知占位符原样保留，便于发现拼错。已知但取不到值显示 `?`。

## HTTP 路由

供设置页使用，无鉴权。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET/HEAD | `/api/dsh-context-usage/state` | 设置 + 实时占用 |
| POST | `/api/dsh-context-usage/set` | 部分更新设置 |

## 结构

```
index.js           装配
src/constants.js   常量与默认值
src/settings.js    配置读写与校验
src/template.js    格式化与模板渲染
src/projection.js  投影单元
src/state.js       状态读取（纯函数）
src/notice.js      投递通知
src/tool.js        工具定义
src/routes.js      HTTP 路由
client.js          设置页
```

`client.js` 不拆：浏览器端只能 `require` 白名单模块，不能 import 相对路径文件。按七分区锚点定位。

## 验证

```powershell
node tools/test-context-usage.mjs   # 61 条契约断言
node --check index.js client.js
```

浏览器端渲染无法脚本断言，需刷新页面目视。
