declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-activity-report': keyof typeof zh
  }
}

export const NS = 'dsh-activity-report'

export interface LocaleDict {
  nav: string; subtitle: string; privacy: string
  today: string; last7d: string; last30d: string; all: string
  allWorkspaces: string; allProviders: string; allModels: string
  refresh: string; export: string; loading: string; loadError: string; noData: string; notReported: string
  statusReady: string; statusBackfilling: string; statusDegraded: string; processed: string; persisted: string; localDays: string
  totalTokens: string; requests: string; activeWorkspaces: string; activeSessions: string; usageCoverage: string; cacheReuse: string
  trend: string; tokens: string; reasoningHint: string
  workspace: string; provider: string; model: string; session: string; tool: string
  search: string; sort: string; descending: string; ascending: string; loadMore: string
  input: string; cacheRead: string; cacheWrite: string; output: string; reasoning: string
  turns: string; steps: string; calls: string; results: string; errors: string
  modelTime: string; toolTime: string; avgTtft: string; outputSpeed: string; errorRate: string; average: string
  performance: string; outcomes: string; metricNotes: string; metricNotesBody: string
  toolFilterHint: string
}

export const zh: LocaleDict = {
  nav: '工作活动',
  subtitle: '本地会话的用量、活动与性能',
  privacy: '只读取本机 DSH 会话日志，不查询服务商，不显示金额。',
  today: '今天', last7d: '近 7 天', last30d: '近 30 天', all: '全部',
  allWorkspaces: '所有工作区', allProviders: '所有服务商', allModels: '所有模型',
  refresh: '刷新', export: '导出 CSV', loading: '正在更新…', loadError: '加载失败，请重试', noData: '当前筛选没有数据', notReported: '未报告',
  statusReady: '已就绪', statusBackfilling: '正在回填', statusDegraded: '部分数据不可用', processed: '已处理会话', persisted: '最后固化', localDays: '自然日',
  totalTokens: '总处理 Token', requests: '已计量请求', activeWorkspaces: '活跃工作区', activeSessions: '活跃会话', usageCoverage: 'Agent Usage 覆盖率', cacheReuse: '缓存复用率',
  trend: '用量趋势', tokens: 'Token', reasoningHint: '推理 Token 已包含在输出中，不重复堆叠。',
  workspace: '工作区', provider: '服务商', model: '模型', session: '会话', tool: '工具',
  search: '搜索当前维度', sort: '排序', descending: '降序', ascending: '升序', loadMore: '加载更多',
  input: '未缓存输入', cacheRead: '缓存读取', cacheWrite: '缓存写入', output: '输出', reasoning: '其中推理',
  turns: '轮次', steps: '步骤', calls: '调用', results: '已返回', errors: '失败',
  modelTime: '模型耗时', toolTime: '工具耗时', avgTtft: '平均首 Token', outputSpeed: '输出速度', errorRate: '失败率', average: '平均耗时',
  performance: '性能与结果', outcomes: '轮次结果', metricNotes: '指标说明',
  toolFilterHint: '工具事件不能精确归因到服务商或模型；清除这两项筛选后查看工具维度。',
  metricNotesBody: '输入、缓存读取、缓存写入和输出是互斥计量桶；推理 Token 是输出子集。今天、近 7 天和近 30 天按本机时区的自然日计算。覆盖率不足时显示“未报告”，不会把缺失数据当作零。',
}

export const en: LocaleDict = {
  nav: 'Activity',
  subtitle: 'Usage, activity, and performance for local sessions',
  privacy: 'Reads local DSH session logs only. No provider calls and no monetary amounts.',
  today: 'Today', last7d: 'Last 7 days', last30d: 'Last 30 days', all: 'All',
  allWorkspaces: 'All workspaces', allProviders: 'All providers', allModels: 'All models',
  refresh: 'Refresh', export: 'Export CSV', loading: 'Updating…', loadError: 'Failed to load. Try again.', noData: 'No data for these filters', notReported: 'Not reported',
  statusReady: 'Ready', statusBackfilling: 'Backfilling', statusDegraded: 'Partial data', processed: 'Sessions processed', persisted: 'Last persisted', localDays: 'Calendar days',
  totalTokens: 'Total processed tokens', requests: 'Metered requests', activeWorkspaces: 'Active workspaces', activeSessions: 'Active sessions', usageCoverage: 'Agent usage coverage', cacheReuse: 'Cache reuse',
  trend: 'Usage trend', tokens: 'Tokens', reasoningHint: 'Reasoning tokens are included in output and are not stacked twice.',
  workspace: 'Workspace', provider: 'Provider', model: 'Model', session: 'Session', tool: 'Tool',
  search: 'Search this dimension', sort: 'Sort', descending: 'Descending', ascending: 'Ascending', loadMore: 'Load more',
  input: 'Uncached input', cacheRead: 'Cache read', cacheWrite: 'Cache write', output: 'Output', reasoning: 'Reasoning subset',
  turns: 'Turns', steps: 'Steps', calls: 'Calls', results: 'Returned', errors: 'Errors',
  modelTime: 'Model time', toolTime: 'Tool time', avgTtft: 'Average TTFT', outputSpeed: 'Output speed', errorRate: 'Error rate', average: 'Average',
  performance: 'Performance and outcomes', outcomes: 'Turn outcomes', metricNotes: 'Metric definitions',
  toolFilterHint: 'Tool events cannot be attributed exactly to a provider or model. Clear those filters to view tools.',
  metricNotesBody: 'Input, cache read, cache write, and output are disjoint accounting buckets; reasoning tokens are a subset of output. Today, 7-day, and 30-day ranges use calendar days in the host timezone. Missing samples are reported as unavailable instead of zero.',
}
