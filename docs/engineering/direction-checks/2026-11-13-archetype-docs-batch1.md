# 方向检查：「档案对文档第一批」（Seedance 2.5 / Seedream 5.0 Pro / 可灵 4.0 Flash / MiniMax H3-Max / Seedream 5.5）

**第一行：近 14 天碰 seedModelIdentity.ts 的提交 9 个（8 个非合并，8 个全是同一类原因：手工表随模型增删；其中带 fix 前缀的 3 个）· 一个新模型要手写登记 7 个文件（H3-Max 实测，另有 8 个生成物文件随档案重生）· 这条 PR 两轮留下的事 9 条 · 推荐：换一种做法（拆开落地 + 登记点收成一处）· 用户已点头「按推荐做」。**

作者：一条只读复盘线（没参与过这条 PR 的两轮）。读的是两轮报告、`origin/main`@767fdccf3、第 2 轮头 b7289afcb、`direction-check-template.md`。
触发：条 1（seedModelIdentity.ts 14 天 3 个 fix，`node scripts/fix-churn.mjs electron/catalog/seedModelIdentity.ts` 原话「近 14 天已有 3 个 fix，这一刀是第 4 个」）；条 4（PR 进第 3 轮）。同一 PR 原来还改了 taskParams.ts，它自己也命中（「近 14 天已有 4 个 fix，这一刀是第 5 个」），写进第 6 节。
自写登记：不适用（`grep -c "seedModelIdentity\|taskParams" docs/engineering/self-written.json` 输出 0）。逃逸账本：本 PR 不是账本结账。

## 0. 一句话根因
「新模型是谁、属哪档」被手抄在好几张互不对账的表里（身份表、旗舰表、能力表、生成物、夹具、样本、快照），其中一张（seedModelIdentity.ts）只在整套门岗里才红，所以每接一个模型都是「写完 → 整套才发现漏一处 → 补一刀 → 钩子判 fix 热点」；缺的是「一个模型一处登记、其余派生或当场报缺」这一层。

## 1. 归类表

### 1a. 近 14 天碰 seedModelIdentity.ts 的 8 个非合并提交（`git log origin/main --since=14.days --no-merges -- electron/catalog/seedModelIdentity.ts`，逐个 `git show -U0`）
| 提交 | 改了什么 | 直接原因 | 类 |
|---|---|---|---|
| 4dcc49990 fix | 删 1 行 deepseek-v3.1-terminus | 上游下线，手工表里留着旧名 | 手工表随模型增删 |
| 155cb9c9b fix | qwen3.8-max-0902 改 qwen3.8-max | 官方文档改名 | 同上 |
| 9207ad9ee fix | 加 muse-image-ext 身份行 + 旗舰行 | 新渠道行漏登记（和本 PR 的 3 行同一种事） | 同上 |
| 736731d23 feat | 加 gpt-image-2.6 两档进旗舰 | 新模型登记 | 同上 |
| 56b1c2f2d feat | 删 Omni-Flash-Ext | 型号退役 | 同上 |
| 451864aae feat | 删 14 行退役条目 | 分档规则改了，批量搬表 | 同上 |
| aa93fd959 feat | 6 增 6 减 | 分档规则改了 | 同上 |
| b6142f13c feat | 加 34 行 | 一批新模型登记 | 同上 |
结论：8 / 8 是同一类（人工在 318 行的查表文件里加、删、改名一个模型）；「fix」只是提交前缀，实质 6 个是 feat。

### 1b. 本 PR 两轮留下的事
| # | 留下的事 | 类 |
|---|---|---|
| 1 | H3-Max 漏登记身份 / 旗舰（channelMerge 测试 2 红，第 1 轮定向跑法没覆盖 src/config/） | 登记点多 + 门岗晚 |
| 2 | 3 行身份补丁被提交钩子拦下 | 其它：钩子按提交前缀判，不看改法 |
| 3 | 可灵 Flash 编辑时长「跟随源视频、无默认值」，能力表校验器报 defaultOutOfRange | 范围定大了 |
| 4 | 6 处排版 / 状态问题（编辑后残留 16:9 / 5s 等） | 其它：界面代码；第 5 条与 #3 同根 |
| 5 | 待定 11 处（文档有、产品没有的控件） | 范围定大了 |
| 6 | 截图只对上 49 / 66 行 | 范围定大了 |
| 7 | 编辑 / 续写 / H3-Max 参考槽上限未验证 | 依赖真素材 / 付费 |
| 8 | taskParams.ts 两处缺陷修复夹带在本 PR | 范围定大了：两条出站路共用的热点文件，与「档案对文档」不是一件事 |
| 9 | 严档设计卡 / 独立验收未填（PR 判档因 taskParams 变严） | 范围定大了（同 #8） |

## 2. 为什么这一类会一直出现
- 登记点：H3-Max（APIMart）手写文件 7 个（apimartVideos.ts、minimaxH3Max.ts、model-generations-media.json、官方夹具、样本表、生成物，加漏掉才红的 seedModelIdentity.ts 两张表）。只有生成物是自动的（`pnpm gen:archetype-defaults`）；archetypeIdentifiers.generated.ts 已把 `MiniMax-H3-Max` 列为识别名，seedModelIdentity.ts 又手写一遍——同一个事实写两份。
- 反方向约束：seedModelIdentity.ts 头注释写「版本级，绝不用 archetype 家族级」（一个档案可含多个变体），所以只能对「一档案一模型」派生，其余仍需显式。可派生的占比未量。
- 门岗：身份合同在 `src/config/modelIdentity.channelMerge.test.ts`，只有整套才跑到。

## 3. 不改结构的话，会冒出什么
| 预测 | 怎么验证 |
|---|---|
| 第二批每个新模型都会再漏 1–2 处身份 / 旗舰 / 夹具，只在整套才红 | 下一个新模型 PR 只跑定向测试后整套是否又红在 src/config |
| seedModelIdentity.ts 的 fix 数继续涨，全是「登记 / 改名 / 下线」 | 月底 `node scripts/fix-churn.mjs electron/catalog/seedModelIdentity.ts` |
| taskParams.ts 在新模型接入 PR 里被顺手再改 | `git log --since=14.days --oneline -- electron/catalog/taskParams.ts` |

## 4. 靶子独立性
能力表合同与逐条对文档原文的测试和档案是同一条线写的，「文档原文」是人工摘录；真正独立的靶子是官方夹具 `tests/fixtures/vendor-official/apimart/*.json`。

## 5. P0
「哪个模型是哪个档、哪家同一模型合并成一条」是领域，自写合理；「手抄表 + 提交钩子 + 整套才红」是通用的注册表一致性问题，现成做法是单一数据源加派生（本仓已有 `scripts/gen-archetype-wire-defaults.ts`）和提前跑的完整性测试。不引新库。

## 6. 三条路
| 选项 | 做什么 | 代价 / 风险 | 推荐 |
|---|---|---|---|
| 沿原方向再补一轮 | 补 3 行身份、改校验器或档案、一个 PR 落完 | 仍带 taskParams + 严档；第 4 轮概率高（估计，无量具） | 否 |
| 换一种做法 | ①拆开：taskParams 缺陷单独走（主线已由「方式参数唯一归属」做掉，见 `2026-11-12-taskparams.md`），本 PR 只留档案 / 能力表 / 截图；②3 行身份按「登记」落，不新增分支；③「一档案一模型」的身份行改由 archetypeIdentifiers 派生（先量占比），同时把 channelMerge 测试提前到快检 | ③派生若误改身份会错合并，须以快照对老值逐条比 | 是 |
| 删掉一部分 | 删待定、截图收尾等 | 用户原话要「对照整个档案体现出来」，删范围会被读成没做完 | 部分：#3 #4 另开线 |
#3（无默认值时长）不在校验器里加特例分支（P1 第三个特例），和排版第 5 条一起另做「跟随源视频」的表示；本轮先在该方式下不声明时长控件、能力表记「待定」。

## 7. 系统哪里没拦住（强弱依次）
| 强度 | 做法 | 本 PR 做了没有 |
|---|---|---|
| 删掉 | 一档案一模型的身份 / 旗舰行改由 archetypeIdentifiers 生成 | 没做（下一批，先量占比） |
| 结构上做不出来 | 目录里有、身份表和档案里都没有的 curated 行加载时报错 | 没做 |
| 门岗自动拦 | channelMerge 身份测试进推送前快检清单 | 做了（快检清单加一行） |
| 写规则文字 | 新模型接入清单列出 7 个手写位 | 写进 PR「系统改进」 |

## 8. 第 3 轮落地记录
- 并最新主线；taskParams.ts 整份取主线（与主线差异 0 行），分支那一刀和只为它存在的注释删掉。
- 身份登记 3 行（APIMart 的 `MiniMax-H3-Max` 身份 + 旗舰），本提交带 `Direction-Check:` trailer。
- 身份合同测试进快检清单。
- 可灵 4.0 Flash 编辑方式不声明时长控件，能力表那一行改「待定」。
