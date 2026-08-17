# dsh-usage-insights

DeepSeek Harness 的本地只读用量面板。它从 DSH 会话事件中统计 Token、请求、Agent 活动、工具调用和性能，在“设置 > 工作活动”中提供可核对的卡片、趋势和分页明细。

当前版本为 alpha。插件不显示金额，不调用模型或服务商接口，也不修改、归档或删除会话。

## 界面预览

![工作活动统计面板概览](0648acc393c41f8a8f3b627b7437928b.png)

![工作活动统计面板明细](f262ea81574ce6afaed345190e17c0f7.png)

## 功能

- 按已验证的 IANA 时区自然日查看今天、近 7 天、近 30 天或全部数据。
- 同时按工作区、服务商和模型筛选。
- 分开展示未缓存输入、缓存读取、缓存写入、输出和输出中的推理 Token。
- 展示已计量请求、活跃工作区、活跃会话、Agent Usage、模型耗时、工具耗时、TTFT 覆盖率和缓存复用率。
- 日趋势可在 Token 与请求数之间切换；服务商和模型明细区分 Agent 与 Compaction 请求来源。
- 提供工作区、服务商、模型、会话和工具五种分页明细，可搜索和排序。
- 工具事件没有精确的服务商/模型归因，因此工具维度会禁用这两项筛选，API 对该组合返回 HTTP 400。
- 统计平均首 Token 时间、输出速度、模型耗时、工具耗时、工具失败日趋势和轮次结果。
- 导出与当前筛选及分析维度一致的 UTF-8 CSV。
- 会话行通过 DSH 客户端会话服务打开，不构造私有 URL。
- 中英文界面、键盘可操作标签页、可聚焦的图表日桶和窄屏布局。

## 安装

```powershell
dsh plugin --profile web add dsh-usage-insights@0.2.0
```

> **v0.2.0 命名空间改版**：`dsh-activity-report` 已更名为 `dsh-usage-insights`（插件 ID、HTTP 路由、storage domain、CSS 前缀与本地化命名空间全部更新）。安装旧包的 profile 请先 `dsh plugin --profile web remove dsh-activity-report`，再安装新包并重启 `dsh web`；派生聚合会从会话事件自动重建。

添加后重启 `dsh web`，再打开“设置 > 工作活动”。host 插件需要重启加载，client bundle 随页面刷新加载。

## 指标口径

总输入 Token：

```text
未缓存输入 + 缓存读取 + 缓存写入
```

总处理 Token：

```text
总输入 Token + 输出
```

推理 Token 是输出的子集，不会再次加入总量。缓存复用率为缓存读取除以总输入 Token。Agent Usage 覆盖率为带 provider usage 的闭合步骤数除以全部闭合步骤数；模型耗时覆盖率和工具耗时覆盖率分别使用同一自然日 cohort 的已测样本数与闭合步骤/工具调用数。没有分母时显示“未报告”。工具失败率以已经返回结果的工具调用为分母。

`today`、`7d` 和 `30d` 使用配置的 IANA 时区自然日。API 返回实际 `timezone`、`startDay` 和排他的 `endDayExclusive`。卡片、趋势和明细从同一批日期桶聚合。时区或聚合算法版本改变时，插件会在打开兼容的 storage domain 后丢弃旧派生缓存并从会话事件重建，绝不混合不同统计口径。

## 数据准确性

- 使用类型化 `SessionEvent`，不接受历史原型的任意对象格式。
- 同一步的早期 usage chunk 会被最终 assistant message usage 替换，不重复计数。
- 最终消息缺失时保留已经报告的 usage，避免失败请求消失。
- compaction 用量单列为 `compaction` 请求来源，不混入 Agent 覆盖率分母。
- provider 与 model 使用联合路由事实，组合筛选取精确交集。
- 工具调用和结果用 `callId` 配对并持久去重；重复事件不会增加调用数或覆盖原始起始时间。配对结果、失败和耗时归入调用自然日，使调用数与耗时覆盖率使用同一 cohort。负耗时归零，未闭合区间不进入耗时。
- 每个会话的 watermark、增量状态和日期事实作为一个完整记录原子写入。
- 启动回填期间先缓冲实时事件，再按 seq 合并；重复 replay 由 watermark 忽略。读取失败的会话保持隔离，其实时事件不会越过未读历史推进 watermark，并在下次完整回填后恢复。
- 写入失败会保留 dirty 记录并显示降级状态；刷新会先重试固化，再重新读取页面数据。

## 本地存储与隐私

插件只读取 DSH 已有的本地会话语料，并通过 DSH `storageDomain` 的 `usage_insights` domain 固化每会话聚合记录。实际介质由 DSH profile 的 storage backend 决定。界面和导出不包含提示词、回复正文、工具参数或工具输出。

当源会话从 DSH 逻辑语料中移除时，插件只清理自己对应的派生聚合记录，不修改或删除 DSH 会话数据。

## 配置

`cordis.patch.yml` 暴露以下部署参数：

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `persistDebounceMs` | `1000` | 实时事件合并写入的等待毫秒数；可设为 `0` |
| `backfillConcurrency` | `4` | 历史会话回填并发数，范围 `1..32` |
| `defaultPageSize` | `25` | 明细默认页大小，范围 `1..200` |
| `timezone` | 系统 IANA 时区 | 自然日分桶时区，例如 `Asia/Shanghai`；非法值会在加载时失败 |

## HTTP API

| 路由 | 说明 |
|---|---|
| `GET /dsh-usage-insights/summary` | 卡片、日期趋势、服务商/模型/来源汇总和数据状态 |
| `GET /dsh-usage-insights/breakdown` | 指定维度、排序、方向、搜索、limit 和 cursor 的一页明细；实时投影变化会使旧 cursor 失效 |
| `GET /dsh-usage-insights/filters` | 当前范围及筛选条件下可用的工作区、服务商和模型 |
| `GET /dsh-usage-insights/export.csv` | 当前筛选和维度的完整 CSV |
| `POST /dsh-usage-insights/retry` | 重试尚未固化的派生记录并返回最新状态 |

三个 JSON 读取接口都返回 `timezone`、`startDay`、`endDayExclusive`、`status` 和样本覆盖率。所有读取接口接受 `range=today|7d|30d|all`，以及可重复的 `workspace`、`provider` 和 `model` 参数。工具维度不接受 `provider` 或 `model`。无效筛选组合、枚举、排序、游标或页大小返回 HTTP 400；意外的内部异常返回不泄漏细节的 HTTP 500。

CSV 按维度使用固定列。服务商和模型导出包含 `agent_requests`、`compaction_requests`、`steps`、`message_samples` 和 `ttft_samples`，工作区与会话也包含 `message_samples`，可据此独立核对来源与覆盖率；工作区导出不会重复输出 workspace 列。

## 开发与验证

需要 Node.js `^22.19.0` 或 `>=24.0.0` 与 pnpm。

```powershell
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
pnpm run verify:package
```

`pnpm run build` 生成 host/client bundle、source map、manifest 和声明文件。`pnpm run verify:package` 会检查导出、JavaScript 语法和 `npm pack --dry-run` 文件清单。

## License

MIT
