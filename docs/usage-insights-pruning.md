# Usage Insights 字段精简建议

本文基于当前客户端实际读取路径、HTTP 响应校验、CSV 导出和持久化折叠逻辑整理，建议先精简浏览器展示契约，再评估内部聚合记录；本次样式优化不删除任何统计字段。

## 优先级一：可从 summary 浏览器响应移除的重复聚合

`ActivitySummaryResponse.byProvider`、`byModel` 和 `byOrigin` 当前没有被 `src/client/Section.tsx` 消费，页面使用 breakdown 接口展示维度明细，`coverage` 也已经由服务端从来源聚合计算完成；从 summary JSON 删除这三个数组可以减少重复传输和客户端 schema 维护，但应保留 `querySummary()` 的内部返回值，直到查询测试和其他调用者确认不再依赖它们。

建议保留 `totals`、`series`、`coverage`、`activeSessions` 和 `activeWorkspaces`，因为它们分别支撑概览卡、趋势图、缺失数据提示和活动范围摘要。

## 优先级二：可以从维度表默认展示中收起的细节

`reasoning` 是 `output` 的子集，适合放在 Token 主卡或 hover 说明中，不必在工作区、服务商、模型和会话表格中重复占用列宽。

`cacheWrite` 对理解缓存成本有价值，但在默认明细表中的关注度低于总输入、缓存读取和输出；可以收进行展开详情或导出 CSV，而不是直接删除内部数据。

`turns`、`steps`、`outcomes` 更接近调试和可靠性分析，建议仅在会话维度和工作区维度保留；服务商和模型表优先展示请求、来源、Token、模型耗时和覆盖率。

`toolMs` 和 `toolTimingCoverage` 在工作区、会话表中与工具维度和性能面板重复，建议从默认表格隐藏，保留工具维度、CSV 和性能摘要中的值。

## 优先级三：可评估从 CSV 默认列中移除的原始样本字段

`message_samples`、`ttft_samples`、`decode_ms` 和 `decode_tokens` 主要用于独立复算覆盖率、平均首 Token 和输出速度；如果 CSV 的目标从审计转为日常阅读，可以只导出已计算的平均值和覆盖率，降低导出宽度，但这会减少离线复算能力，默认不建议立刻删除。

## 不建议删除的内部字段

`runtime.openStep`、`openUsage`、`pendingTools`、`seenToolCalls` 和 `lastCountedTurn` 支撑跨事件折叠、usage 替换、工具去重和轮次计数，删除会破坏重启后的增量一致性。

`aggregationVersion` 和 `timezone` 用于识别需要重建的旧派生记录，不能当作展示冗余字段清除。

`DayFacts.byRoute`、`byProvider`、`byModel`、`byOrigin` 和 `byTool` 是筛选、精确归因、分页和导出的内部索引；即使某些字段不再直接展示，也不应在没有替代索引前删除。

## 建议实施顺序

先从 summary 浏览器响应移除未被客户端消费的三个数组，并保留服务端内部聚合返回；再把 reasoning、cacheWrite、工具耗时等字段改为行详情或 CSV 专属字段；最后根据真实导出使用情况决定是否压缩原始样本列。每一步都应更新 response schema、API 测试、CSV 测试和客户端快照，并检查卡片、趋势、分页明细与导出仍然使用同一批自然日事实。
