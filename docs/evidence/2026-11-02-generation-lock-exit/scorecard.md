# 体验成绩单：批量生成锁退出：部分验收

- 改动：批量生成锁退出：部分验收
- 验收 head：`925bfdadadff60f89542e42b742252e064038e3b`（implementation was still uncommitted during these observations; this is not a release receipt）
- 场景 id：`browse-away-during-long-task`
- 谁验：Codex implementation（self-check; not independent acceptance）
- 日期：2026-11-02

**用户这次能完成：**列表批量入口可派发，三页可显示并释放未知结果；合同要求的完整付费确认闭环未完成。

**能力变化：**新增：无；改变：三页共享失败判据和恢复面、本机拒绝单独分类、排队状态读队列；去掉：重复的整方案作者守卫、单行永久 retrying

## 结果

- 机器：完成 **2 / 12**（失败 10 条，原样列在下表，不丢）
- 首次尝试成功：null（未采集：需要真人首次操作，AI 不代填）

| 尝试 | 结果 | 说明 | 证据 |
| --- | --- | --- | --- |
| baseline free rehearsal | **失败** | Expected five dispatched items; only two asset requests were made. |  |
| fixed free rehearsal 1 | **失败** | creation page had no canvas test bridge; not a product-regression receipt |  |
| fixed free rehearsal 2 | **失败** | fixture omitted authored anchor bindings; not a product-regression receipt |  |
| fixed free rehearsal 3 | **失败** | build freshness rejected changed source tests; not a product-regression receipt |  |
| three pages 1 zh-CN | **失败** | navigation helper expected canvas while list was persisted |  |
| three pages 1 en | **失败** | navigation helper expected canvas while list was persisted |  |
| three pages 2 zh-CN | **失败** | single-user generation skipped the required confirmation |  |
| three pages 2 en | **失败** | single-user generation skipped the required confirmation |  |
| three pages 3 zh-CN | **失败** | nine functional checks passed but confirmation remained missing |  |
| three pages 3 en | **失败** | nine functional checks passed but confirmation remained missing |  |
| independent list entry zh-CN | 通过 | Three functional checks passed; process exit 1 solely from quiet-walk foreground detection, allowed by the task. |  |
| independent list entry en | 通过 | Three functional checks passed; process exit 1 solely from quiet-walk foreground detection, allowed by the task. |  |

## 机器测的

来源：walk-log
设备 / 窗口 / 语言：macOS arm64 / 1280×860 offscreen isolated Electron / zh-CN / en / light。边界：fake providers and a local two-request proxy; no billing

| 主指标 / 指标 | 现状 → 当前 | 单位 | 样本数 | 口径 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 完整分镜资产与镜头 POST | 2 → null | requests | 1 | 未采 | baseline expected five; fixed full rehearsal stopped after three setup failures |
| 独立列表入口每语言 POST | null → 6 | requests | 2 | 脚本计数（真事件，非采集器） | three initial requests (one rejected), then three serial requests; five forwarded |
| 列表中文窗口响应最长等待 | null → 49 | ms | 31 | 脚本计数（真事件，非采集器） | one-second probes; only this independent list journey |
| 列表英文窗口响应最长等待 | null → 53 | ms | 32 | 脚本计数（真事件，非采集器） | one-second probes; only this independent list journey |
| 合同要求的单卡付费确认 | null → 0 | dialogs | 2 | 脚本计数（真事件，非采集器） | both languages follow the existing skip-confirmation policy |

## 真人给的（和上面分开记）

- SEQ（1–7）：null（未采集）
- 误点：null · 回退：null · 求助：null · 首次尝试成功：null

## 护栏

| 护栏 | 结果 | 证据 / 说明 |
| --- | --- | --- |
| 不自动重发结果不明的请求 | 通过 | host tests and three-page refused-click counts |
| 改一镜只拒这一镜 | **失败** | confirmedProjectContinuation changed-node case executes once instead of twice |
| 失败重试与放行先弹付费确认 | **失败** | three-page checks spendConfirmation=false in both languages |
| 整窗冻结复现 | 未验证 | no greater-than-two-second probe in the independent list journey; complete four stages not measured |

## 最大摩擦点与决定

- 摩擦：用户已核对，现有单卡策略直接重发；完整分镜修后演练未拿到成功收据。
- 决定：保留失败，不以独立列表绿灯替代整轮验收；付费入口禁止运行，待合同差异处理。
- 协调决定：待协调（通过 / 退回 / 明示延期）

## 没验证的

| 缺口 | owner | 复查条件 |
| --- | --- | --- |
| 完整四段真实场景和修后免费演练 | implementation and coordinator | resolve contract differences and the stopped rehearsal item |
| Windows and real billing | independent acceptance | a green shared four-stage rehearsal and explicit paid execution by coordinator |
| 真人 SEQ / 操作观察 | human review | real participant session |

## 证据路径

- docs/evidence/2026-11-02-generation-lock-exit/verification.json
- tests/ux/shots/generation-lock-exit/en-list-small-queued-readable.png
- tests/ux/shots/generation-lock-exit/zh-CN-unknown-list-detail-light.png
- tests/fixtures/old-user-data/runs/v0.24.0-canvas-unknown/manifest.json

> 这一页不出总分：机器数、真人数、护栏、未验证各看各的。
