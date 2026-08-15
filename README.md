# dsh-activity-report

DeepSeek Harness 的本地只读用量面板。它从 DSH 会话事件中统计 Token、请求、Agent 活动、工具调用和性能，在“设置 > 工作活动”中提供可核对的卡片、趋势和分页明细。

当前版本为 alpha。插件不显示金额，不调用模型或服务商接口，也不修改、归档或删除会话。

## 功能

- 按本机自然日查看今天、近 7 天、近 30 天或全部数据。
- 同时按工作区、服务商和模型筛选。
- 分开展示未缓存输入、缓存读取、缓存写入、输出和输出中的推理 Token。
- 展示已计量请求、活跃工作区、活跃会话、Agent Usage 覆盖率和缓存复用率。
- 提供工作区、服务商、模型、会话和工具五种分页明细，可搜索和排序。
- 统计平均首 Token 时间、输出速度、模型耗时、工具耗时、工具失败和轮次结果。
- 导出与当前筛选及分析维度一致的 UTF-8 CSV。
- 会话行通过 DSH 客户端会话服务打开，不构造私有 URL。
- 中英文界面、键盘可操作标签页、可聚焦的图表日桶和窄屏布局。

## 安装

在 DSH Web profile 中添加本地目录：

```powershell
dsh plugin --profile web add link:G:\项目\git\demo\dsh-activity-report
```

开发 worktree 可使用其实际绝对路径。添加后重启 `dsh web`，再打开“设置 > 工作活动”。GitHub 仓库建立后也可以把仓库地址交给同一条 `dsh plugin add` 命令。

## 指标口径

总输入 Token：

```text
未缓存输入 + 缓存读取 + 缓存写入
```

总处理 Token：

```text
总输入 Token + 输出
```

推理 Token 是输出的子集，不会再次加入总量。缓存复用率为缓存读取除以总输入 Token。Agent Usage 覆盖率为带 provider usage 的 Agent 请求数除以闭合步骤数；没有分母时显示“未报告”。工具失败率以已经返回结果的工具调用为分母。

`today`、`7d` 和 `30d` 使用 DSH host 所在时区的自然日。API 返回实际 `timezone`、`startDay` 和排他的 `endDayExclusive`。卡片、趋势和明细从同一批日期桶聚合。

## 数据准确性

- 使用类型化 `SessionEvent`，不接受历史原型的任意对象格式。
- 同一步的早期 usage chunk 会被最终 assistant message usage 替换，不重复计数。
- 最终消息缺失时保留已经报告的 usage，避免失败请求消失。
- compaction 用量单列为 `compaction` 请求来源，不混入 Agent 覆盖率分母。
- provider 与 model 使用联合路由事实，组合筛选取精确交集。
- 工具调用和结果用 `callId` 配对；负耗时归零，未闭合区间不进入耗时。
- 每个会话的 watermark、增量状态和日期事实作为一个完整记录原子写入。
- 启动回填期间先缓冲实时事件，再按 seq 合并；重复 replay 由 watermark 忽略。

## 本地存储与隐私

插件只读取 DSH 已有的本地会话语料，并通过 DSH `storageDomain` 的 `activity_report` domain 固化每会话聚合记录。实际介质由 DSH profile 的 storage backend 决定。界面和导出不包含提示词、回复正文、工具参数或工具输出。

## 配置

`cordis.patch.yml` 暴露以下部署参数：

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `persistDebounceMs` | `1000` | 实时事件合并写入的等待毫秒数；可设为 `0` |
| `backfillConcurrency` | `4` | 历史会话回填并发数，范围 `1..32` |
| `defaultPageSize` | `25` | 明细默认页大小，范围 `1..200` |

## HTTP API

| 路由 | 说明 |
|---|---|
| `GET /dsh-activity-report/summary` | 卡片、日期趋势、服务商/模型/来源汇总和数据状态 |
| `GET /dsh-activity-report/breakdown` | 指定维度、排序、方向、搜索、limit 和 cursor 的一页明细 |
| `GET /dsh-activity-report/filters` | 可用工作区、服务商、模型和已观察日期范围 |
| `GET /dsh-activity-report/export.csv` | 当前筛选和维度的完整 CSV |

所有数据接口接受 `range=today|7d|30d|all`，以及可重复的 `workspace`、`provider` 和 `model` 参数。无效枚举、排序、游标或页大小返回 HTTP 400。

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
