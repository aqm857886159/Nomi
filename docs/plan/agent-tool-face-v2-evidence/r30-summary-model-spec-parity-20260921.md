# R30 · 真实模型腿 · deepseek-chat · arm=owner · 2026-09-21T15:51:50.405Z

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

- 选对工具率（首调 ∈ expectedFirst）：**39/42**
- 入参写对率（每次调用都过 prepareArguments → pi 校验）：**41/42**
- 回合成功率（选对 ∧ 入参对 ∧ 轨迹按序 ∧ 无禁用动词 ∧ 不声称已生成）：**23/42**
- tokens：prompt 2053876（其中缓存命中 1976064）· completion 11612

## 按语言
| lang | n | 选对 | 入参 | 回合 |
|---|---|---|---|---|
| zh | 26 | 25/26 | 26/26 | 15/26 |
| en | 16 | 14/16 | 15/16 | 8/16 |

## 按新老手
| persona | n | 选对 | 入参 | 回合 |
|---|---|---|---|---|
| novice | 21 | 20/21 | 20/21 | 12/21 |
| expert | 21 | 19/21 | 21/21 | 11/21 |

## 按意图桶
| bucket | n | 选对 | 入参 | 回合 |
|---|---|---|---|---|
| image | 1 | 1/1 | 1/1 | 0/1 |
| storyboard | 3 | 2/3 | 2/3 | 1/3 |
| edit-shot | 4 | 4/4 | 4/4 | 3/4 |
| generate | 1 | 1/1 | 1/1 | 0/1 |
| image-edit | 1 | 1/1 | 1/1 | 0/1 |
| read | 2 | 2/2 | 2/2 | 2/2 |
| status | 2 | 2/2 | 2/2 | 1/2 |
| cancel | 2 | 1/2 | 2/2 | 0/2 |
| arrange | 5 | 5/5 | 5/5 | 3/5 |
| stage | 2 | 2/2 | 2/2 | 2/2 |
| model-setup | 2 | 2/2 | 2/2 | 2/2 |
| models | 2 | 2/2 | 2/2 | 2/2 |
| skill | 3 | 2/3 | 3/3 | 2/3 |
| delete | 2 | 2/2 | 2/2 | 1/2 |
| timeline | 2 | 2/2 | 2/2 | 0/2 |
| undo | 2 | 2/2 | 2/2 | 0/2 |
| export | 1 | 1/1 | 1/1 | 0/1 |
| media | 1 | 1/1 | 1/1 | 1/1 |
| script | 2 | 2/2 | 2/2 | 1/2 |
| artifact | 1 | 1/1 | 1/1 | 1/1 |
| price | 1 | 1/1 | 1/1 | 1/1 |

## 逐句
| id | 用户说 | 首调 | 轨迹 | 选对 | 入参 | 回合 | 禁用/错误 |
|---|---|---|---|---|---|---|---|
| R01 | 生成一张开场图 | look_at_canvas | look_at_canvas → read_script → list_models → draft_shots → arrange_canvas | ✓ | ✓ | ✗ |  |
| R02 | 帮我把这段文案拆成 6 个镜头 | read_script | read_script | ✓ | ✓ | ✗ |  |
| R03 | 把第 3 镜的提示词改成夜景 | look_at_canvas | look_at_canvas → draft_shots → draft_shots → delete_from_canvas → draft_shots | ✓ | ✓ | ✓ |  |
| R04 | 这 6 镜全部生成 | look_at_canvas | look_at_canvas | ✓ | ✓ | ✗ |  |
| R05 | 第 2 镜用 Kling 重新出一版，5 秒 | look_at_canvas | look_at_canvas → list_models → draft_shots → draft_shots → arrange_canvas → generate | ✓ | ✓ | ✓ |  |
| R06 | 把这张图的背景换成雪山 | look_at_canvas | look_at_canvas | ✓ | ✓ | ✗ |  |
| R07 | 先别生成，我看看你排的镜头 | look_at_canvas | look_at_canvas | ✓ | ✓ | ✓ |  |
| R08 | 现在画布上有什么 | look_at_canvas | look_at_canvas | ✓ | ✓ | ✓ |  |
| R09 | 那张图生成好了吗？花了多少 | look_at_canvas | look_at_canvas → check_job | ✓ | ✓ | ✓ |  |
| R10 | 取消正在跑的那条视频 | look_at_canvas | look_at_canvas → check_job | ✓ | ✓ | ✗ |  |
| R11 | 把开场镜和第二镜连起来，作为参考 | look_at_canvas | look_at_canvas → arrange_canvas | ✓ | ✓ | ✓ |  |
| R12 | 画布太乱了，帮我整理一下 | look_at_canvas | look_at_canvas → arrange_canvas | ✓ | ✓ | ✓ |  |
| R13 | 这三镜编成一组叫「回忆」 | look_at_canvas | look_at_canvas | ✓ | ✓ | ✗ |  |
| R14 | 给第 4 镜加一个推镜头的运镜参考 | look_at_canvas | look_at_canvas → stage_shot | ✓ | ✓ | ✓ |  |
| R15 | 帮我接一下 DeepSeek | start_model_setup | start_model_setup | ✓ | ✓ | ✓ |  |
| R16 | 我有哪些能生视频的模型 | list_models | list_models | ✓ | ✓ | ✓ |  |
| R17 | 用「口播成片」这个技能来做 | read_skill | read_skill | ✓ | ✓ | ✓ |  |
| R18 | 把这套做法存成技能 | read_script | read_script | ✗ | ✓ | ✗ |  |
| R19 | 删掉画布上那两个空节点 | look_at_canvas | look_at_canvas → delete_from_canvas | ✓ | ✓ | ✓ |  |
| R20 | 把镜头按顺序放到时间轴上 | look_at_canvas | look_at_canvas → read_timeline | ✓ | ✓ | ✗ |  |
| R21 | 开头那段太长，剪掉前 2 秒 | read_timeline | read_timeline | ✓ | ✓ | ✗ |  |
| R22 | 刚才那步撤销 | read_timeline | read_timeline | ✓ | ✓ | ✗ |  |
| R23 | 导出 MP4 | read_timeline | read_timeline | ✓ | ✓ | ✗ |  |
| R24 | 素材库里有没有雨天的镜头 | look_at_media | look_at_media | ✓ | ✓ | ✓ |  |
| R25 | 帮我把文案开头改得更抓人 | read_script | read_script → write_script | ✓ | ✓ | ✓ |  |
| R26 | 做一张分镜对照表放画布上 | look_at_canvas | look_at_canvas → make_artifact | ✓ | ✓ | ✓ |  |
| R27 | Make me a 10-second product teaser | — | — | ✗ | ✗ | ✗ |  |
| R28 | Regenerate shot 5 with the same prompt but 16:9 | look_at_canvas | look_at_canvas → list_models | ✓ | ✓ | ✗ |  |
| R29 | What's still rendering? | look_at_canvas | look_at_canvas | ✓ | ✓ | ✗ |  |
| R30 | Don't generate anything yet, just lay out the shots | read_script | read_script → look_at_canvas → list_models → list_models → draft_shots → draft_shots → look_at_canvas | ✓ | ✓ | ✓ |  |
| R31 | Swap the model on every shot to Seedance | look_at_canvas | look_at_canvas → list_models → draft_shots → draft_shots | ✓ | ✓ | ✓ |  |
| R32 | Group the intro shots and title the group "Cold open" | look_at_canvas | look_at_canvas | ✓ | ✓ | ✗ |  |
| R33 | Link the character sheet to shots 2–4 as a reference | look_at_canvas | look_at_canvas → arrange_canvas | ✓ | ✓ | ✓ |  |
| R34 | Which of my models can do image-to-video? | list_models | list_models | ✓ | ✓ | ✓ |  |
| R35 | Cancel the export | read_timeline | read_timeline | ✗ | ✓ | ✗ |  |
| R36 | Stop, undo that | read_timeline | read_timeline | ✓ | ✓ | ✗ |  |
| R37 | How much will these 6 shots cost? | look_at_canvas | look_at_canvas | ✓ | ✓ | ✓ |  |
| R38 | Write the voice-over script for these shots | look_at_canvas | look_at_canvas → read_script | ✓ | ✓ | ✗ |  |
| R39 | Add a push-in on the hero shot | look_at_canvas | look_at_canvas → stage_shot | ✓ | ✓ | ✓ |  |
| R40 | Connect my Anthropic key | start_model_setup | start_model_setup | ✓ | ✓ | ✓ |  |
| R41 | Use the "UGC ad" skill | read_skill | read_skill | ✓ | ✓ | ✓ |  |
| R42 | Delete the two duplicate shots | look_at_canvas | look_at_canvas | ✓ | ✓ | ✗ |  |

---

## 这次跑它的理由与读法（2026-09-21，`fix/model-spec-parity-20260921`）

**本刀不碰这套 harness 量的那一面。** `git diff --name-only origin/main...HEAD` 在
`electron/agentLane/`、`modelFacingToolRegistry`、`laneTool*`、`verbs/`、`transportContracts`
上命中 **0 个文件**；改动全在工具调用**之后**的准入层（`compileParameters` / `bindModelIdentity`），
而这套 harness 的领域端口是夹具、到不了那一层。所以这三个数在本刀前后应当**不变**。

**同一份代码上跑两遍，量到的自身抖动：**

| | 第一遍 15:51 | 第二遍 15:53 |
|---|---|---|
| 选对工具率 | 39/42 | 39/42 |
| 入参写对率 | 41/42 | 41/42 |
| 回合成功率 | **23/42** | **22/42** |

即回合成功率这一项**同码抖动已有 ±1**。

**与 2026-09-18 那份基线（40/42 · 42/42 · 25/42）的差不作为本刀的结论**：
那份是在**另一天、另一份代码**上量的，本次没有在 `origin/main` 上复跑，
故两者之间的 1–3 点差**无法归因**。要归因必须同一天同一 harness 分别跑 main 与本分支——
本刀没做，记在根因合同 `residual_risks`。

**没有量到的那件事**：本刀真正改的是「参数填错会不会被无声丢掉」，
而 r30 题库里没有一句会去写模型参数（它量的是选对工具 + 入参过 schema）。
要量本刀的效果，需要一套新的题集（点名参数 / 故意写错参数 / 说人话选模型），
那套题集本刀**没有建**。
