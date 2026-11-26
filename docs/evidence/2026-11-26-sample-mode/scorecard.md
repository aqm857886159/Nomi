# 体验成绩单：Seedance 2.5 样片模式：先出 480p 样片，满意再出 1080p

- 改动：Seedance 2.5 样片模式：先出 480p 样片，满意再出 1080p
- 验收 head：`c9129f473`
- 场景 id：`sample-mode.walk`
- 谁验：I-SD-sample-mode（实现线自验（走查 + 替身），不是独立验收）
- 日期：2026-11-26

**用户这次能完成：**在模型菜单选「Seedance 2.5（样片模式）」出一条 480p 样片；满意就点节点下方「出高清」，只拿样片号出 1080p，写进同一节点第 2 版「高清版」；同一条样片第二次出高清先问；过期了换「重拍样片」。

**能力变化：**新增：菜单「Seedance 2.5（样片模式）」一行、节点下方「样片 · 剩 N 天」+「出高清」、第二次出高清确认框文案、任务中心按样片号只重发高清；改变：发送键 / 单位菜单 / 确认框主钮的约价记号收成 SendCostAmount 一处；去掉：ModelSurfaces 板旧的 picker.draft-row（标 dropped）

## 结果

- 机器：完成 **14 / 14**（失败 0 条，原样列在下表，不丢）
- 首次尝试成功：null（未采集：需要真人首次操作，AI 不代填）

| 尝试 | 结果 | 说明 | 证据 |
| --- | --- | --- | --- |
| zh-CN-light · menu | 通过 |  | docs/evidence/2026-11-26-sample-mode/walk-summary.json |
| zh-CN-light · sample | 通过 |  | docs/evidence/2026-11-26-sample-mode/walk-summary.json |
| zh-CN-light · hd | 通过 |  | docs/evidence/2026-11-26-sample-mode/walk-summary.json |
| zh-CN-light · second | 通过 |  | docs/evidence/2026-11-26-sample-mode/walk-summary.json |
| zh-CN-light · plain | 通过 |  | docs/evidence/2026-11-26-sample-mode/walk-summary.json |
| zh-CN-light · narrow | 通过 |  | docs/evidence/2026-11-26-sample-mode/walk-summary.json |
| zh-CN-light · expiry | 通过 |  | docs/evidence/2026-11-26-sample-mode/walk-summary.json |
| en-dark · menu | 通过 |  | docs/evidence/2026-11-26-sample-mode/walk-summary.json |
| en-dark · sample | 通过 |  | docs/evidence/2026-11-26-sample-mode/walk-summary.json |
| en-dark · hd | 通过 |  | docs/evidence/2026-11-26-sample-mode/walk-summary.json |
| en-dark · second | 通过 |  | docs/evidence/2026-11-26-sample-mode/walk-summary.json |
| en-dark · plain | 通过 |  | docs/evidence/2026-11-26-sample-mode/walk-summary.json |
| en-dark · narrow | 通过 |  | docs/evidence/2026-11-26-sample-mode/walk-summary.json |
| en-dark · expiry | 通过 |  | docs/evidence/2026-11-26-sample-mode/walk-summary.json |

## 机器测的

来源：walk-log
设备 / 窗口 / 语言：macOS（Apple Silicon，本机） / 1100×690 + 停靠 Agent / zh-CN 浅色 / en 深色。边界：替身扮 APIMart 两步，零花费；真付费未跑

| 主指标 / 指标 | 现状 → 当前 | 单位 | 样本数 | 口径 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 出高清请求只带 {model, draft_task_id, resolution} 的比例（主指标） | 0 → 100 | % | 4 | 脚本计数（真事件，非采集器） | 替身日志：出高清 POST 4 次，其中键集合恰好的 4 次；main 上没有出高清（基线 0） |
| 样片 POST（draft:true）次数 | 0 → 4 | 次 | 1 | 脚本计数（真事件，非采集器） | 每轨：出样片 1 次 + 过期后重拍 1 次 |
| 第二次出高清没确认就发的次数（护栏 1） | null → 0 | 次 | 2 | 脚本计数（真事件，非采集器） | 取消、Esc 各一次后 POST 数不变（second 站断言） |
| 200 视频节点（50 样片）平移帧间隔 | null → 9.8 | ms | 5 | 实测（采集器） | 中位数；p95 9.8；预算 33；这份基线是实现线忙时量的，标了 noisy，待验收线重量 |

## 真人给的（和上面分开记）

- SEQ（1–7）：null（未采集）
- 误点：null · 回退：null · 求助：null · 首次尝试成功：null
- 说明：没有真人试用；SEQ 与误点 / 回退 / 求助不由 AI 代填

## 护栏

| 护栏 | 结果 | 证据 / 说明 |
| --- | --- | --- |
| 不重复扣钱：第二次出高清先问，取消 / Esc 不发 | 通过 | 走查 second 站，06-confirm |
| 不印假价：算不出价时按钮与发送键都不印数、不印 0 | 通过 | 走查 sample 站 + NodeSampleRow.test.tsx |
| 老节点不变：普通 2.5 选 480p 没有这一行 | 通过 | 走查 plain 站，07-plain-480p；sampleFacts.oldUser.test.ts |
| 带视频结果的老项目节点 | 未验证 | 没有真实旧版带视频结果的项目夹具；sampleFacts.test.ts 钉「没来历的视频结果」 |

## 最大摩擦点与决定

- 摩擦：新视频节点落在已有节点左边时，生成框左半截（模型芯片）在画布左缘外，要先把画布往右拖一点才点得到模型（main 上同样，2026-10-27 已另报）；铺开的版本卡随节点整个拖出视口会一起不画。
- 决定：不在本 PR 改画布落点 / 裁剪（不是这条线的概念），报协调另派；走查照真人做法先拖画布再点。
- 协调决定：待协调（通过 / 退回 / 明示延期）

## 没验证的

| 缺口 | owner | 复查条件 |
| --- | --- | --- |
| 真付费跑一次（两步各扣一次、价目与样片号有效期） | 协调会话 | 合并前在专用工作树跑一次，产物标记 I-SD-sample-mode |
| 带视频结果的真实旧版项目 | 协调会话（夹具） | 有带视频结果的旧版项目夹具时补一条打开测试 |
| Windows | 伙伴设备 | Windows 夜跑或伙伴走一遍 sample-mode.walk.mjs |
| 出高清中途关窗 / 重启 / 断网的真窗口链 | 验收线 | 按设计卡 ★5 中途表抽一格 |
| 英文「第二次出高清」确认框标题截断（不符拍板图 E4）：修复另开 PR #1696（弹窗外壳一处「放不下就折行」，同提交删掉 SpendConfirmDialog 的 truncate，用户 11-26 拍板） | 协调会话（已派伙伴机） | #1696 合入 main 后，本分支合一次 main，重跑 sample-mode.walk.mjs second 站英文轨，日志「[量] 二次出高清标题」放得下，由验收线核过再把 sample.confirm-second-hd 翻成 implemented（实现线不自己翻） |

## 证据路径

- docs/evidence/2026-11-26-sample-mode/walk-log.txt
- docs/evidence/2026-11-26-sample-mode/walk-summary.json
- docs/evidence/2026-11-26-sample-mode/zh-light/
- docs/evidence/2026-11-26-sample-mode/en-dark/
- docs/evidence/2026-11-26-sample-mode/main-red/
- docs/evidence/2026-11-26-sample-mode/breaks/breaks.tsv
- docs/evidence/2026-11-26-sample-mode/side-by-side/index.tsv
- docs/evidence/2026-11-26-sample-mode/click-census.md

> 这一页不出总分：机器数、真人数、护栏、未验证各看各的。
