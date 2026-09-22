# B1b 验证证据

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

- `red.log`：C59 系统目录缺失、C58 resident read 缺失，2/2 断言红（修正了 fixture settings 环境后重跑）。
- `compaction-red.log`：C61 百万 token 窗口下 81k usage 未触发压缩；C58/C59 已绿。
- `green.log`：9/9 loopback，包含 24 句原转录回放、目录增删、真实压缩落盘、技能读取与符号链接边界、旧会话恢复。
- `deepseek-sample.json`：正式三回合的投影、工具调用和两份八镜方案。面板投影当前不透传 skill details，加载标记以原始 JSONL 复核，不能只看投影字段。
- `deepseek-usage.json`：两次付费尝试按 pi usage 汇总。首次夹具未自动响应方案审批，终止后实结 ¥0.188228834192；正式小样 ¥0.339612201593；累计 ¥0.527841035785。

## 24 回合估算口径

使用真实 lane → pi → HTTP 的请求体，统一调用 pi estimateTokens。旧侧重建旧 formatter 的每回合全目录行为；不是把 loopback 固定 usage 冒充真实供应商 tokens。总输入估算 1,175,691 → 53,619（-95.44%），目录索引 785，首调 1,929（测试最小工具表）、后续新增 17–224。生产工具表另由 check:model-schema 量，不把最小 fixture 表当生产表。

## R30 同口径

| 回合 | 首调总输入 | 减上一回合末调输入后的新增 | 新加载技能 | 分镜档位 | 用户任务 |
|---|---:|---:|---|---|---|
| 把这份文稿拆成分镜 | 10,280 | 10,280（首次含固定前缀，无上一回合） | workbench-storyboard-planner | 8/8 | 通过 |
| 第 1 镜试拍一下 | 18,190 | 194 | 无，前文已加载 | 8/8 保持 | 未通过：没有生成草稿 |
| 重新拆一遍 | 19,325 | 201 | 无，前文已加载 | 8/8 | 通过 |

三回合首调工具选择 3/3；实际工具调用成功 5/6；分镜写入 2/2；用户任务 2/3。模型第二回合误选 staging reference，隔离写口拒绝，后续未建试拍草稿。不能把合法 schema 或档位正确等同试拍闭环通过。没有付费媒体请求。

正式样本后四次请求 cacheRead=16,384，但样本没有切组，不能据此声称 C59 切组前缀通过。工具切组方案等待明确裁决；完整 gates 与 push 尚未完成。

原始今日转录的同口径量已落 `original-usage.json`：多数后续回合新增输入约 8.6k–9.4k。上表采用“本轮首调输入 - 上轮末调输入”（194/201）；若再扣掉上轮输出，净新上下文为 11/6。两种数字都保留，不能混在同一比较列。原走查目录89项没有重写，回放夹具仅保留模型格式化需要的字段与公开原创24句。

## 原实施轮验证终态（历史记录）

- 传输/成本补跑 21/21 exit 0（`transport-cost-green.log`），原 broad lane 的 12 个 stale resident-read 预期已复验。
- 完整 gates exit 1：76 contracts 全部执行，唯一阻断 check:vocabularies；共享 origin/main 验证期间前进到 d3fa25888，而本分支 merge-base 仍为 f708568df。旧 productionShotActions ToastKind 债在 main 已移除，因此历史棘轮拒收（`gates-failure.log`）。本批未改这个文件；未合 main，未覆盖基线。
- lint、三套生产 typecheck、agent-runtime test types 均通过；contracts 阻断后全量 test/build 未执行。未提交、未推送。

## B1b-finish 交付追踪

用户已授权本地并 main；最终并线、gates 与 push 结果见上级 `2026-09-09-agent-lane-context-budget.md` 收尾记录及本地 `.tmp/b1b-finish/` 日志。C59 归 B1c，本批保留真实任务 2/3 的限制，不把传输预算测试等同全部行为验收。
