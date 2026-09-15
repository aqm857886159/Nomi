# 证据目录 · Agent 工具面 v2（2026-09-14）

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
