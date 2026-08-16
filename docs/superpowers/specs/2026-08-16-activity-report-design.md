# DSH Activity Report 可靠分析产品设计

## 状态

本设计于 2026-08-16 获得批准。插件保持只读，只展示 DeepSeek Harness 本地会话日志能够验证的活动、用量、性能和可靠性数据。插件不展示金额，不估算费用，不修改、归档或删除会话，也不要求修改 deepseek-harness 核心仓库。

## 产品目标

`dsh-activity-report` 是 DeepSeek Harness Web GUI 的本地活动分析插件。它让用户回答以下问题：

- 今天、最近 7 个自然日、最近 30 个自然日或全部时间实际产生了多少模型用量？
- 哪些工作区、服务商、模型和会话贡献了这些用量？
- Agent 完成了多少轮次和步骤，调用了哪些工具，失败集中在哪里？
- 模型首 Token 延迟、解码速度和工具耗时如何变化？
- 当前统计覆盖了多少日志，历史回填和持久化是否健康？

成功标准是同一筛选条件下的卡片、趋势和明细能够相互核对；重新启动、历史回填和实时写入不会漏算或重复计算；数据缺失显示为“未报告”或覆盖率，而不是伪装成零。

## 非目标

- 不显示实际账单、价格或估算成本。不同服务商和模型的计价规则不属于本地会话日志事实。
- 不连接 DeepSeek、OpenAI 或其他服务商的在线用量接口。
- 不提供会话归档、删除、恢复或批量管理功能。
- 不成为通用多 Agent 可观测平台；产品差异是 DSH 原生、本地、可复算的数据分析。
- 不修改 deepseek-harness 的包或运行时行为。

## 参考口径

DeepSeek 官方用量把输入区分为缓存命中和缓存未命中，并单列输出 Token；推理 Token 是输出的子集。OpenAI 官方用量按时间桶统计请求和 Token，并允许按项目、用户、API Key、模型等维度聚合，同时把 Usage 与 Costs 分开。

本插件采用相同的产品原则，但以 DSH 的日志语义为准：

- `inputTokens` 是未缓存输入。
- `cacheReadTokens` 与 `cacheWriteTokens` 是与未缓存输入互斥的输入桶。
- `outputTokens` 已包含 `reasoningTokens`；推理 Token 只作为输出细分，不能再次加入总量。
- `compaction/summary.usage` 是一次压缩摘要请求的持久用量；它属于辅助模型请求，必须与普通 Agent 步骤分开标识后计入总用量。
- 工作区是 DSH 对 OpenAI“项目”维度的本地对应项；服务商、模型、会话和工具是额外分析维度。

本地日志不是服务商账单。没有 provider usage 的调用无法推算；例如当前 `session/title-llm-request` 只持久化请求参数而不持久化返回 usage，因此标题生成请求不进入 Token 或已计量请求统计，页面必须明确提示这一覆盖限制。

参考资料：

- DeepSeek 上下文硬盘缓存：https://api-docs.deepseek.com/zh-cn/guides/kv_cache/
- DeepSeek 模型与价格中的计量说明：https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
- OpenAI organization usage reference：https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage
- DSH `TokenUsage`：`packages/llm/llm/src/types.ts`
- DSH `tokenUsage` 投影：`packages/llm/token-meter/src/usage-projection.ts`
- DSH `sessionStats` 投影：`packages/session/session-stats/src/projection.ts`

## 指标定义

### 用量

| 指标 | 定义 |
|---|---|
| 已计量请求 | 有 provider usage 的唯一 Agent `(session, turn, step)` 数，加上有 usage 的 `compaction/summary` 数；按 `agent` 与 `compaction` 来源分组 |
| 未缓存输入 | `inputTokens` 之和 |
| 缓存读取 | `cacheReadTokens` 之和 |
| 缓存写入 | `cacheWriteTokens` 之和 |
| 输出 | `outputTokens` 之和 |
| 总处理 Token | 未缓存输入 + 缓存读取 + 缓存写入 + 输出 |
| 推理 Token | provider 报告的 `reasoningTokens` 之和，是输出子集 |
| 缓存复用率 | 缓存读取 /（未缓存输入 + 缓存读取 + 缓存写入）；分母为 0 时未定义 |
| 平均输入/输出 | 相应 Token / 已计量请求；请求为 0 时未定义 |

Agent usage chunk 先到而最终 message 缺失时，样本保留在开放步骤状态；带 usage 的最终 message 到达时替换同一步的早期样本，不能重复累计；不带 usage 的最终 message 不删除早期样本。只有 `step/end` 到达后，最终样本才与步骤一起归入该结束自然日。未报告 usage 的闭合步骤不产生请求或 Token，并通过 Agent Usage 覆盖率暴露。压缩摘要的 usage 按单个 `compaction/summary` 事件计入，不能与它产生的表层替换事件重复计算。

### 活动与可靠性

| 指标 | 定义 |
|---|---|
| 活跃工作区 | 筛选范围内至少有一个计量或活动事件的标准化 `cwd` 数 |
| 活跃会话 | 筛选范围内至少有一个计量或活动事件的会话数 |
| 轮次 | 至少包含一个闭合 `step/end` 的不同 `(session, turn)` 数 |
| 步骤 | `step/end` 数，包括完成、失败和取消的已进入步骤 |
| 工具调用 | `tool/call` 数，按 `callId` 去重 |
| 工具失败 | 对应 `tool/result.error` 存在的调用数 |
| 工具失败率 | 工具失败 / 已返回结果的工具调用；没有结果样本时未定义 |
| 结束结果 | `turn/end.reason.kind` 的分布；无步骤的被拒绝或空轮次仍属于结果统计，但不增加“轮次” |
| Agent Usage 覆盖率 | 有 provider usage 的闭合步骤 / 全部闭合步骤；不把辅助请求放进分母 |

### 性能

| 指标 | 定义 |
|---|---|
| 模型耗时 | 成功组装 message 的步骤中，`step/start` 到 `assistant/message` 的时间 |
| 工具耗时 | 按 `callId` 配对的 `tool/call` 到 `tool/result` 时间 |
| 平均 TTFT | `step/start` 到第一段非空 Token chunk 的总时间 / 有 TTFT 样本的步骤数 |
| 输出速度 | 有解码时间样本的输出 Token / 第一 Token 到最终 message 的时间 |
| TTFT 覆盖率 | 有首 Token 样本的消息组装步骤 / 全部消息组装步骤 |

负时间差归零；未闭合的区间不进入耗时。性能指标仅在日志有对应事件时显示，否则显示“未报告”。

## 时间语义

- “今天”是当前本地时区的 `[当天 00:00, 次日 00:00)`。
- “近 7 天”和“近 30 天”分别包含今天在内的 7 个和 30 个本地自然日，不使用滚动的 168/720 小时窗口。
- “全部”从最早可读事件到当前时间。
- 所有 API 使用明确的 `startDay` 和排他的 `endDayExclusive`；服务端返回实际时区和边界。
- Agent 请求用量归入最终有效 usage 样本发生的日期；最终 message 替换早期 chunk 时允许样本迁移日期。压缩摘要用量归入 `compaction/summary` 日期。
- 轮次结果归入 `turn/end` 日期；步骤、Agent usage、模型耗时和 TTFT 归入 `step/end` 日期；工具调用、对应结果、失败与耗时统一归入 `tool/call` 日期。
- 卡片、趋势和明细必须从同一组日期桶聚合，不能按“会话最后活动时间”筛选整段会话总量。

## 维度与可展示字段

所有页面共享时间、工作区、服务商和模型筛选。各维度只显示能够可靠归因的列：

| 维度 | 可展示字段 |
|---|---|
| 工作区 | 用量、请求、活跃会话、轮次、步骤、工具、结果、模型/工具耗时 |
| 服务商 | 用量、请求、请求来源、模型耗时、TTFT、输出速度、Agent Usage 覆盖率 |
| 模型 | 用量、请求、请求来源、模型耗时、TTFT、输出速度、Agent Usage 覆盖率 |
| 会话 | 全部用量、活动、结果和性能字段 |
| 工具 | 调用、已返回结果、失败、失败率、总耗时、平均耗时 |

服务商和模型表不显示无法归因的轮次、工具调用或 Agent 总耗时。缺失 `cwd`、provider 或 model 的数据进入显式的“未知工作区/未知服务商/未知模型”分组，并计入覆盖率，不得静默丢弃。

## 页面设计

页面保留在“设置 > 工作活动”，由以下区域组成：

1. 顶部筛选栏：自然日范围、工作区、服务商、模型、刷新和导出。
2. 数据状态条：`回填中 / 已就绪 / 降级`、最后成功固化时间、处理会话数和统计覆盖率。
3. 概览卡片：总处理 Token、已计量请求、活跃工作区、活跃会话、Agent Usage 覆盖率、缓存复用率。
4. 用量趋势：按日堆叠未缓存输入、缓存读取、缓存写入和输出；可以切换请求数。推理 Token 以输出内的辅助提示展示，不堆叠到总量。
5. 分析标签：工作区、服务商、模型、会话、工具。每个标签使用自己的合法列，并支持排序、分页和文本筛选。
6. 性能与结果：平均 TTFT、输出速度、模型耗时、工具耗时、轮次结果和工具失败趋势。
7. 指标说明：页面内可展开，展示公式、时间边界和覆盖率含义。

刷新期间保留现有结果并显示非阻塞加载状态。切换筛选会取消旧请求；旧响应不得覆盖新筛选结果。会话链接通过 DSH 客户端会话导航服务打开，不拼接未定义的 URL 查询参数。

## 架构

### 模块划分

- `src/domain.ts`：定义并验证 `activity-report` storage domain。
- `src/metrics.ts`：指标类型、加减合并、比例和数据不变量。
- `src/adapt.ts`：从类型化 DSH `SessionEvent` 提取折叠所需事实，不接受任意裸对象。
- `src/fold.ts`：单会话增量折叠；维护 watermark、步骤 usage 替换状态、开放时间区间和按日事实。
- `src/query.ts`：在日期桶和筛选条件上完成汇总、排序与分页。
- `src/http.ts`：参数验证、响应编码和 CSV 导出。
- `src/host.ts`：历史回填、实时缓冲、持久化队列、失败状态和显式重试。
- `src/index.ts`：Cordis 生命周期、配置解析、事件监听和路由注册。
- `src/client/api.ts`：带取消和响应校验的浏览器请求层。
- `src/client/Section.tsx`：页面状态和区域组合。
- `src/client/Chart.tsx`：Token/请求日趋势图。
- `src/client/styles.ts`：由 Cordis effect 拥有的页面样式。

共享类型保持客户端安全，不从 host-only 包导入运行时值。单文件只承担一个明确职责，避免继续扩大当前 `index.ts` 和 `Section.tsx`。

### 持久化模型

插件注入 `storageDomain`，打开版本化的 `activity_report` domain（storage domain 名称只允许小写字母、数字和下划线）。`sessions` 表以品牌化 Session ID 为键，每个值是一个原子会话折叠记录，包含：

- 会话元数据：工作区、标题、创建时间。
- 日期桶使用的规范 IANA 时区；缺失或不同的时区会触发从源会话重建。
- 聚合算法版本；缺失或不同的版本会在 storage domain 成功打开后触发从源会话重建，domain wire 版本保持可读取旧派生记录。
- 已持久化 watermark。
- 跨事件增量所需状态：当前路由、开放步骤、首 Token、未完成工具调用和最近 usage 样本。
- 按本地日期保存的用量、活动、性能、结果及各维度事实。

同一会话的 watermark 和聚合数据必须作为一个记录原子写入，避免崩溃发生在“数据已写但 watermark 未写”或相反状态。内存变化按会话标记 dirty；持久化队列合并同一会话的连续更新，但每次提交调用 `table.put(sessionId, completeRecord)`。写入失败保留 dirty 状态并进入降级状态，下一次刷新或事件触发重试。插件卸载时停止接收新事件，排空已经接受的写入，再关闭 domain。

派生记录的旧时区或聚合算法版本字段允许被识别，但不会进入查询；插件删除该记录并从源会话重建。无法识别的 domain wire 版本或记录校验失败会加载失败并报告诊断，不能静默清空。

### 启动与实时数据流

1. 注册实时监听器，但先把事件写入按会话排序的缓冲区。
2. 打开 storage domain 并加载已验证的会话折叠记录。
3. 列举历史会话，读取完整持久事件并按 seq 回填；折叠器按 watermark 跳过已处理事件。
4. 对读取成功的会话合并缓冲区；丢弃不高于当前 watermark 的重复事件，严格按 seq 折叠其余事件。读取失败的会话保持隔离，实时事件继续缓冲且不得推进 watermark，等待下次完整回填恢复。
5. 固化所有 dirty 会话后把状态切换为 `ready`，后续实时事件直接进入折叠和写入队列。

卸载会停止启动新的回填任务、排空已接受写入、注销 HTTP 路由和事件监听器。当前 DSH `readSession` 接口不接受 `AbortSignal`，因此已经开始的单次会话读取会完成后再关闭 domain。任何会话读取错误都记录会话 ID，并在状态接口报告失败数量；其余会话继续回填。

## HTTP 接口

- `GET /dsh-activity-report/summary`：筛选后的卡片、趋势、性能、结果和数据质量。
- `GET /dsh-activity-report/breakdown`：`dimension`、排序、方向、游标和受限 `limit`；返回投影修订号、一页明细及下一游标。翻页期间投影变化会拒绝旧游标并要求从第一页重载。
- `GET /dsh-activity-report/filters`：可用工作区、服务商和模型及其数据范围。
- `GET /dsh-activity-report/export.csv`：导出当前筛选及维度的完整明细。
- `POST /dsh-activity-report/retry`：重试 dirty 派生记录的固化并返回最新状态。

所有接口接受 `range=today|7d|30d|all` 以及可重复的 workspace/provider/model 过滤参数。未知范围、维度、排序字段、无效或过期游标和越界 limit 返回 400。JSON 响应在服务端发送前通过共享 schema 校验，并包含 `status`、`timezone`、`startDay`、`endDayExclusive`、`lastPersistedAt` 和覆盖率。正常接口不返回未分页的全部会话。

## 错误处理与数据质量

- 禁止空 `catch`。缺失文件、取消、单会话损坏、domain 失败和 HTTP 输入错误使用不同诊断。
- domain 无法打开时插件加载失败；不能以内存临时数据假装持久化正常。
- 回填部分失败时页面进入 `degraded`，显示成功、失败和待处理会话数。
- 存储写入失败时 `lastPersistedAt` 保持最后一次成功值；页面显示未固化 dirty 会话数。
- 未知可扩展事件合法忽略，但不会推进与指标无关的替代状态之外的业务计数。
- 持久记录和 HTTP 响应在耐久和网络边界进行运行时校验；同进程类型化调用不重复防御。

## 配置

部署可变项通过 Cordis 配置显式提供并在加载时验证：

- `persistDebounceMs`：同会话写入合并窗口。
- `backfillConcurrency`：历史读取并发数。
- `defaultPageSize`：明细默认分页大小，不得超过协议固定的安全上限。
- `timezone`：默认使用系统 IANA 时区，可显式覆盖。

配置值非法时加载失败。协议版本、domain 名称和安全上限不是隐藏调优项。

## 测试与验收

### 纯函数测试

- usage chunk 与 message 替换、失败后仅有 usage chunk、推理 Token 不重复加入总量。
- 跨午夜请求、自然日边界、今天/7 天/30 天/全部范围。
- provider/model/unknown 归因与维度总和守恒。
- turn/step、工具配对、失败、未闭合区间、TTFT 和解码速度。
- 同一事件重放、watermark 跳过和乱序缓冲。

### Host 组合测试

- 使用真实 Cordis Loader、memory storage backend、storage domain、session query 和 web server 组合插件。
- 首次回填、持久化后重启、回填期间实时事件、写入失败、读取取消和完整卸载。
- 路由注销、domain 关闭和后台任务排空。
- 无效持久记录必须拒绝；不能自动清空。

### API 与客户端测试

- 卡片等于趋势桶之和；各维度可归因字段之和等于同筛选汇总。
- 分页无重复无遗漏，排序稳定，CSV 与明细查询一致。
- 快速切换范围时旧响应不会覆盖新范围。
- loading、empty、degraded、error 和 ready 状态可见。
- 标签具有 `role=tab`、`aria-selected` 和键盘行为；会话使用 DSH 导航服务。

### 发布检查

- `pnpm run typecheck`、聚焦测试和 build 通过。
- TypeScript 保持 `strict` 与 `noImplicitAny`，声明生成失败会使 build 失败。
- `pnpm pack` 内容包含运行时依赖、类型、README 和真实 LICENSE。
- 从打包产物安装到 Web profile 后完成真实浏览器流程；产品可见 GUI 变更在 PR 中附真实流程 GIF。

## 发布边界

设计规格提交前，目标目录初始化为使用 `main` 分支的独立 Git 仓库。实现完成并通过验收后，补齐许可证、贡献说明和发布元数据，再创建 GitHub 仓库并发布草稿 PR。首次发布仍标记为 pre-release；在持久化重启、范围对账和真实 Web 流程全部验证前不得发布稳定版本。
