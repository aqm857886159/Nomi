# 证据目录 · Agent 工具面 v2（2026-09-14）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

| 文件 | 内容 |
|---|---|
| `r17-verb-transport-red.txt` | 门岗 `laneVerbTransport.test.ts` 对着 #777 手写白名单跑：draft_shots / generate / check_job / cancel_job 四条红 + 阳性对照红（先验会红，R17） |
| `r30-bank.json` | 42 句题库（设计正本 §4：zh 26 / en 16，新老手各半），每句 expectedFirst / expectedTrajectory / forbiddenVerbs |
| `r30-results.json` / `r30-summary.md` | 真实模型跑一轮的逐句结果与汇总（`npx tsx tests/system/agent-tool-face-real-model.mjs`，DeepSeek 官方端点 `deepseek-chat`，temperature 0） |

## R30 两条腿

**零额度 loopback（CI）**：`tests/agent-runtime/lane-tool-accuracy.test.mts` 首调 8/8 · 回合 8/8 · 审批臂 8/8（对照臂 2/8 · 8/8）；MCP 臂 `mcpToolAccuracy.test.ts` 8/8 · 8/8（对照 1/8）；生成链 loopback：`agentPanelSpendConfirm.e2e.test.ts` / `generationTransportAdapters.test.ts` / `lane-storyboard-review.test.mts`（draft_shots 落草稿不出卡 → generate isError+STOP）。

**真实模型（deepseek-chat，2026-09-14T03:48:54.049Z，42 句，工具层真实 + 领域端口夹具）**：

| 数 | 值 |
|---|---|
| 选对工具率（首调 ∈ expectedFirst） | **37/42** |
| 入参写对率（每次调用过 prepareArguments → pi 校验） | **42/42** |
| 回合成功率（严格：选对 ∧ 入参对 ∧ 轨迹按序 ∧ 无禁用动词 ∧ 不声称已生成） | **20/42** |
| 调了禁用动词（如为报价去调 generate） | 0 句 [] |
| 调了 generate 却声称「已开始生成」 | 0 句 |
| 先读再做（首调是读、随后轨迹完整） | 4 句 ['R01', 'R07', 'R18', 'R26'] |
| 未完成轨迹但没选错、没碰禁用动词、没编事实（多为夹具世界缺对象：时间轴为空、没有「hero shot」、无分组 op，模型如实反问） | 17 句 |

按语言：zh 22/26 选对 · en 15/16；按新老手：novice 19/21 · expert 18/21。逐句表见 `r30-summary.md`。

**读法**：严格回合成功率 20/42 低于设计 §8.1 的 90% 目标；但拆开看，选错工具的只有 5 句（其中 4 句是「先 read_script 再做」），0 句碰禁用动词、0 句把卡说成已生成——设计要抓的两类错误（第 37 句反例、`generate` 后声称已开始）一次没出现。其余「未完成」是模型对夹具世界如实反问（空时间轴无可剪/无可撤/无可导出、无分组 operation、无图生图模型），这类回合按设计的口径（终态匹配 ∧ userSees 事实）应单独计，不算工具面失误；下一轮把夹具世界补全（时间轴带片段、hero shot 命名、分组 op）再量。

**花费**：prompt 1,258,766 tokens（缓存命中 1,230,592）· completion 10,215；按 DeepSeek 公开价目估算（miss ¥2/M · hit ¥0.2/M · out ¥8/M）≈ ¥0.38/轮，本刀跑了 2 轮（第一轮夹具画布不合 `canvasReadResultSchema`，作废重跑）≈ ¥0.77。

---

## 2026-09-18 · 工具层改名 + 投影原型的 A/B（R13 第三档）

同一天、**同一个 runner、同一份 42 句题库、同一个模型**（`deepseek-chat`，temperature 0），
两轮只差被测源码：一轮是 `origin/main`（`192922bd1`）的 `electron/` + `src/`，一轮是
`feat/tool-projection-20260918`。跑法与上面一致（`npx tsx tests/system/agent-tool-face-real-model.mjs`）。
结果：`r30-summary-before-tool-projection.md` / `r30-results-before-tool-projection.json`（before）
与 `r30-summary.md` / `r30-results.json`（after）。

| 数 | before（origin/main） | after（本分支） |
|---|---|---|
| 工具名写对率（首调 ∈ expectedFirst） | 39/42 | **40/42** |
| 参数一次就对（每次调用过 prepareArguments → pi 的 ajv） | 41/42 | **42/42** |
| 回合成功率（严格口径同上） | 25/42 | 25/42 |
| storyboard 桶（= 「调到 `draft_shots`」那一族） | 选对 2/3 · 入参 2/3 | **3/3 · 3/3** |

**模型真的改用了新名字**（从逐句 `toolArgs` 里数出来，不是推断）：

| 字段 | before 出现次数 | after 出现次数 |
|---|---|---|
| `draft_shots.shots[].modelKey` → `…modelId` | 16 | **0 → 18** |
| `draft_shots.draftId` → `…operationId` | 3 | **0 → 1** |
| `generate.draftId` → `generate.operationId` | 1 | **0 → 1** |
| `check_job.jobId` / `cancel_job.jobId`（保留不改） | 2 / 1 | 3 / 1 |

**两轮里被 pi 的 ajv 拒过的参数：0 次。** before 那一格 41/42 不是参数写错——R27
（"Make me a 10-second product teaser"）那一轮模型**一个工具都没调**（它反问了产品信息），
harness 把「零次调用」记成 `argsOk=false`。所以两轮的真实读数都是「没有任何一次参数被拒」。

**回合成功率 25 → 25，逐句差异 3 升 3 降，三降全是模型多问了一句**（R05 指出镜 2 是静帧、
问要不要改成图生视频；R28 指出两个视频模型都不暴露画幅参数、问走项目画幅还是导出处理；
R39 问画布上哪一个才是 "hero shot"）——都与字段名无关，是温度 0 下仍然存在的模型方差。
三升是 R01 / R29 / R38。**结论：没有可归因于本次改动的回归。**

**这一腿量不到「落到画布」**：本 harness 的领域端口是夹具，`draft_shots` 的返回是固定事实。
交接文档里「落画布 14/23」那张表来自一次真机整机走查，它的脚本不在仓库里
（`docs/plan/2026-09-18-tool-layer-findings-inventory.md` §4 只留了数字）。要接上那一列，
得先把那次走查的剧本落进 `tests/ux/`——本刀没做，明记在这里。

**花费**（按上面同一组公开价目估算：miss ¥2/M · hit ¥0.2/M · out ¥8/M）：
before prompt 2,007,945（命中 1,913,472）· completion 11,416 ≈ **¥0.66**；
after prompt 2,008,725（命中 1,912,448）· completion 11,681 ≈ **¥0.67**；**两轮合计 ≈ ¥1.33**。
