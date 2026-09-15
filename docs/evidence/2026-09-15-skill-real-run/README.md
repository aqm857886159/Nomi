# 2026-09-15 · 技能面真实模型腿 + 「做事原则」假设验证

| 文件 | 是什么 |
|---|---|
| [`prompts.md`](prompts.md) | 22 句题库（先写完才跑）、三组的分工、证据标记怎么选、已知局限 |
| [`skill-bank.json`](skill-bank.json) | 题库本体。登在 `tests/system/agent-tool-face-usecases.json` 的 `banks` 里，门岗核 `skillKey` 真装着 |
| [`principles-hypothesis.md`](principles-hypothesis.md) | 用户 09-14 那个假设的验证报告（结论：**部分成立**）+ 做事原则三层方案 |
| `skill-summary.md` / `skill-results.json` | 现在这条线的逐句结果 |
| `skill-summary-raw.md` / `skill-results-raw.json` | 2026-09-14 基线（`NOMI_R30_SKILL_ARM=raw`） |
| `shots/` | 真机走查截图（`tests/ux/skill-import-real-use.walk.mjs`） |

## 数字（同一份题库，两条臂，deepseek-chat temperature 0）

S03 那一句两臂之一 `fetch failed`，成对比较时整句剔除，所以下面分母是 21 / 11。

| 指标 | 2026-09-14 基线 | 现在 |
|---|---|---|
| 回复里看得出技能被用（选了技能的 11 句） | **7/11** | **9/11** |
| 技能规定的参数真的写进入参（同 11 句） | 9/11 | 9/11（没动，见下） |
| 选对工具率（21 句） | 16/21 | 15/21 |
| 入参写对率（21 句） | 21/21 | 21/21 |
| 回合成功率（21 句） | 13/21 | 11/21 |
| 视觉锚（`reference-mode`，6 句直接出片） | 0/6 | 1/6 |
| 自己去查技能（`skill-consulted`，4 句） | 2/4 | 2/4 |

`skillVisible` 7/11 → 9/11 在**三轮独立 owner 臂里三次一致**（翻正的是 S02 / S04 / S10）。

**回合成功率的回落如实解释**：逐句看是 S07（`read_script` 和 `look_at_canvas` 谁先读）与
S10（整轮只读没写）这两种**顺序抖动**，两句拿到的信息和答案质量一样。这份题库的
`回合成功率` 被「先读哪个」主导，技能维度要看 `skillVisible`。

**`skillParamOk` 没动（9/11）**：两格未命中是 S02 / S09 整轮只做了读，没调 draft/arrange，
那是「没发生」不是「没做到」。真要保证「技能规定的参数落进入参」需要工具面守卫，
方案在 [`principles-hypothesis.md`](principles-hypothesis.md) 第 ② 层，本次只出方案。

**D05 是最硬的那一格**（唯一真的把镜头建出来的「直接出片」句）：
基线 4 镜全 `text_to_video`、零锚、零参考边；现在先建 `role:"anchor"` 定场图、
`arrange_canvas` 连 4 条 `role:"first_frame"` 边，还主动说「纯空镜无人物，所以没建角色卡」。
三轮一致。

## 花费

DeepSeek 官方端点，7 轮（含 2 轮被仪器修正作废的早期轮）。每轮 prompt ≈1.2–1.5M token
（缓存命中 ≈90%）、completion ≈1.3–1.6 万 token。按官方价折算 **≈¥4**，远低于 ¥30 上限。
未动任何付费生图/生视频额度（`paidCalls: 0`，走查用 loopback 夹具）。

## 真机截图（P3）

| 截图 | 看的是什么 |
|---|---|
| `shots/01-skill-panel-entry.png` | 技能库「我的技能」空态说得出「别人发来的技能怎么进来」 |
| `shots/02-two-skills-imported.png` | zip 与技能文件夹两条真实输入都导进来了 |
| `shots/03-legacy-manifest-rejected.png` | 没有 SKILL.md 的旧包给出说得出下一步的失败回执 |
| `shots/04-agent-skill-menu.png` | 刚导进来的两个技能出现在 Agent 的技能菜单里 |
| `shots/05-skill-chip-attached.png` | 选中后 composer 上出现技能 chip |
| `shots/06-agent-answered-with-skill.png` | **用户气泡上挂着技能 chip、回复头上写着「已使用技能：walk-hermes-zip」**——同一轮的出站报文里，交代文案在、SKILL.md 的 frontmatter 不在 |

## T-AG-05「一次只能选一个技能」：**记账，不在本次放开**

不是一行开关。`creationActiveSkill` 是单值，改成多值要连带动五处，而且缺一条产品裁决：

| 要动的地方 | 现状 |
|---|---|
| `src/workbench/workbenchStore.ts:118` | `creationActiveSkill: { key; name } \| null` |
| `electron/agentLane/laneDesktopInput.ts:30` | `skillKey: z.string().max(256).optional()`（线协议单值） |
| `electron/shared/agentLane/laneContracts.ts:47` | 转录里 `readonly skillKey?: string`——**已落盘的历史转录是单值** |
| `electron/shared/agentLane/laneProjection.ts:235` | chip 投影按单值取 |
| `src/workbench/ai/lane/laneViewModel.ts:336` | 渲染按单值取；`skillOfTurn` 是 `Map<turn, string>` |

**缺的裁决**：两条技能的方法互相冲突时谁优先（例如 `brand-promo` 写「画幅默认问、不默认横屏」，
`curated-film-storyboard` 写「使用宽屏面板」——同时挂上，模型该听谁）。
这不是实现细节，是产品取舍，得用户拍。在那之前放开多选，等于把冲突丢给模型每次随机裁决一遍。

## T-AG-07 技能触发机制：调研结论已捞回

远端分支 `research/skill-trigger-mechanism-20260912`（41b9102）的一句话结论：
**触发机制本身与标准一致（description 驱动 + `read` 正文），没坏。**问题是三件事叠在一起——
① 整片默认画幅到不了画布（**本次核实已在基线上修掉**：`storyboardShotScope.ts` 的 v6 resolver +
`FILM_DEFAULTS` 登记表 + `check:storyboard-owner`）；② 技能正文本来也管不到画幅，只能「劝」模型填参数
（本次加了那句劝，`skillParamOk` 没动，所以第 ② 层守卫方案才是它的正解）；
③「用没用上」不可观测（基线的 chip + 「已使用技能」回执已经补上了这一半，见 `shots/06`）。
它还独立地点出了与本次同一个根因：`skill.body` 裸拼、而带交代的那份实现零生产调用者。
