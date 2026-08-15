/** Locale dictionaries for the activity panel. */

// Merge our namespace into DSH's locale map so `register` and slot `locale`
// accept it with full type checking.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-activity-report': keyof typeof zh
  }
}

export const NS = 'dsh-activity-report'

export interface LocaleDict {
  nav: string
  today: string
  last7d: string
  last30d: string
  all: string
  refresh: string
  totalTokens: string
  requests: string
  turns: string
  duration: string
  byProvider: string
  byModel: string
  bySession: string
  byTool: string
  calls: string
  share: string
  trend: string
  input: string
  output: string
  cacheRead: string
  cacheWrite: string
  toolCalls: string
  toolErrors: string
  session: string
  workspace: string
  noData: string
  updated: string
  subtitle: string
  loadError: string
  stepsFallback: string
  outcomeCompleted: string
  outcomeError: string
  outcomeAborted: string
  outcomeMaxTokens: string
  outcomeInterrupted: string
  outcomeBlocked: string
  outcomeCanceled: string
  outcomeUnknown: string
}

export const zh: LocaleDict = {
  nav: '工作活动',
  today: '今天',
  last7d: '近 7 天',
  last30d: '近 30 天',
  all: '全部',
  refresh: '刷新',
  totalTokens: '总 Token',
  requests: '请求数',
  turns: '轮次',
  duration: '总耗时',
  byProvider: '按服务商',
  byModel: '按模型',
  bySession: '按会话',
  byTool: '按工具',
  calls: '调用次数',
  share: '占比',
  trend: '按天趋势',
  input: '输入',
  output: '输出',
  cacheRead: '缓存命中',
  cacheWrite: '缓存写入',
  toolCalls: '工具调用',
  toolErrors: '工具失败',
  session: '会话',
  workspace: '工作区',
  noData: '暂无数据',
  updated: '更新于',
  subtitle: '按服务商 / 模型 / 会话统计本地全部会话的活动与用量（数据仅保存在本机）',
  loadError: '加载失败，请刷新重试',
  stepsFallback: '活动步数（压缩日志无轮次边界）',
  outcomeCompleted: '完成',
  outcomeError: '出错',
  outcomeAborted: '中止',
  outcomeMaxTokens: '达 Token 上限',
  outcomeInterrupted: '中断',
  outcomeBlocked: '阻塞',
  outcomeCanceled: '取消',
  outcomeUnknown: '未知',
}

export const en: LocaleDict = {
  nav: 'Activity',
  today: 'Today',
  last7d: 'Last 7 days',
  last30d: 'Last 30 days',
  all: 'All',
  refresh: 'Refresh',
  totalTokens: 'Total tokens',
  requests: 'Requests',
  turns: 'Turns',
  duration: 'Duration',
  byProvider: 'By provider',
  byModel: 'By model',
  bySession: 'By session',
  byTool: 'By tool',
  calls: 'Calls',
  share: 'Share',
  trend: 'Daily trend',
  input: 'Input',
  output: 'Output',
  cacheRead: 'Cache read',
  cacheWrite: 'Cache write',
  toolCalls: 'Tool calls',
  toolErrors: 'Tool errors',
  session: 'Session',
  workspace: 'Workspace',
  noData: 'No data',
  updated: 'Updated',
  subtitle: 'Activity and usage across all local sessions, by provider / model / session (stored locally only)',
  loadError: 'Failed to load. Refresh to retry.',
  stepsFallback: 'activity steps (compacted log, no turn boundaries)',
  outcomeCompleted: 'Completed',
  outcomeError: 'Error',
  outcomeAborted: 'Aborted',
  outcomeMaxTokens: 'Max tokens',
  outcomeInterrupted: 'Interrupted',
  outcomeBlocked: 'Blocked',
  outcomeCanceled: 'Canceled',
  outcomeUnknown: 'Unknown',
}
