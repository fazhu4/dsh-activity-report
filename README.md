# dsh-activity-report

DeepSeek Harness Web GUI 的「工作活动」统计面板：以 **服务商（provider）/ 模型（model）/ 会话（session）** 三个维度，统计本地全部会话的活动与用量数据（请求数、Token 四类、轮次、工具调用、耗时、结束原因），布局对齐 DeepSeek 官网用量页。**无命令、无 LLM、无定时**，纯确定性统计，数据仅保存在本机。

## 安装

```sh
dsh plugin --profile web add <包名或本目录路径>
# 本地开发安装：
dsh plugin --profile web add link:G:\项目\git\demo\dsh-activity-report
```

安装后**重启 `dsh web`** 生效（host 半部分需要重启加载；client bundle 随页面刷新加载）。

打开 **设置 > 工作活动** 查看。

## 功能

- **三个维度 Tab**：按服务商 / 按模型 / 按会话（会话维度显示标题 + 工作区，可点击打开）
- **时间范围**：今天 / 近 7 天 / 近 30 天 / 全部
- **汇总卡片**：总 Token、请求数、轮次、总耗时、工具调用、工具失败，以及结束原因分布
- **趋势图**：按天的 Token 用量（零依赖 SVG 柱状图）
- **明细表**：每个分组的请求数 / 输入 / 输出 / 缓存命中 / 缓存写入 / 总 Token / 轮次 / 工具调用 / 耗时，按总 Token 降序
- **工具调用明细**：全部工具名 × 次数 chips

## 架构

```
host:  sessionQuery 回填全部历史 → 每会话固化折叠（watermark + 统计量）
       监听 session/event 增量 → debounce 落盘 $DSH_HOME/storages/activity-report.json
       → webServer 路由 /dsh-activity-report/summary?range=... & /sessions
client: 设置页 slots.section 注册面板 → fetch 路由 → 渲染
```

- **固化合法性**：DSH 会话日志 append-only，已折叠到 seq N 的统计量永久有效，增量折叠只处理新事件
- **首次安装**：后台扫描一次全部历史（不阻塞启动）；之后每次启动只读增量
- **数据安全**：全部本地、无网络请求、无模型调用
- **路径**：固化文件用 `dshHomePath('storages', ...)` 绝对路径解析（`ctx.fs.resolve` 的相对路径不锚定 `$DSH_HOME`）
- **口径说明**：DSH 的会话压缩（compaction）会从持久化日志中移除 `turn/start`+`turn/end` 边界事件。实时监听能拿到完整事件流（轮次/耗时/结束原因正确）；回填压缩过的历史日志时，轮次列自动回退显示 `step/end` 活动步数（`turns` 为 0 时用 `steps`），避免面板空白

## HTTP API

| 路由 | 说明 |
|---|---|
| `GET /dsh-activity-report/summary?range=today\|7d\|30d\|all` | 汇总 + byProvider + byModel + bySession + 按天序列 |
| `GET /dsh-activity-report/sessions?range=...` | 会话明细行 |

## 开发

```sh
pnpm install
pnpm test        # vitest（fold 纯函数 + 事件适配）
pnpm typecheck   # tsc --noEmit
pnpm run build   # esbuild → lib/index.js + lib/client.js
```

## License

MIT
