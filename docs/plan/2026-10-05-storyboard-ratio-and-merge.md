# 分镜比例按模型落键 + 文稿方案改一镜只改点名的 · 设计卡（★5 格）

```
改动名：①文稿方案改一镜按键合并（与宿主改草稿同一个函数）②分镜整片 / 行级比例按模型的真实比例键落地
        ③修订时参数以外那几格的语义写清楚
线/负责人：L-aspect（Opus）        类别：[其他]（不新增花钱语义、不新增界面；批量条「不支持」的提示只在真落不下时出现）
前置：#1023（语义比例）、#1024（改草稿合并）
概念：用户说什么就改什么，其他一律不动
```

## 0. 一句话

分镜编辑器与文稿方案里，比例住在一个叫 `aspect_ratio` 的槽里，落画布时只认同名控件：整片设成 16:9，落到 Z-Image（比例键叫 `size`）上被当未知键丢掉，表上还标「不支持」。文稿方案让 Agent 改一镜时，参数又是整份替换。这一刀让落画布、写回节点、批量条三处都用 #1023 的同一份比例判据（`electron/shared/aspectRatioValue.ts`）翻成真实键（像素档同规则），文稿方案改一镜用 #1024 的同一个合并函数。

## ★1 用户怎么用

当我在分镜编辑器里把整片画幅设成 16:9、有几镜用的是 Z-Image，我想那几镜落到画布上就是 16:9、表上不报「不支持」；当我让 Agent「把文稿方案第 2 镜改成竖屏」，我想只有比例变。步骤：①批量条设整片 16:9（或行级覆盖）②落画布 / 写回节点：比例槽的值按这一镜模式的比例控件翻成真实键（Z-Image → `size`，Agnes → `ratio`，Runway 像素档 → `1280:720`）③这个模式真没有这一档（Z-Image 要 21:9、图生视频跟着首帧走）→ 不发、批量条照实说「不支持」④Agent 改文稿方案一镜：点名的参数并进原有参数（`null` 删键），比例收进比例槽。**不做**：规划器（`storyboardStrategy` 的建议面）对比例键的判断（只读建议，不落参数，见残留）；分镜行上的比例胶囊（本来就没有生产调用方，旧的按字面键找控件的函数删了）。**已知坑**：#1023 之后、本刀之前由 Agent 建的文稿方案，比例可能住在真实键（如 `size`）里；它们下次被 Agent 改到参数时会被收进比例槽，没被改过的照旧以真实键落地（行为与今天相同）。真实任务：(a) 文稿方案 6 镜混用 Z-Image 与 Nano Banana 2，整片设 16:9 落画布；(b)「第 2 镜改竖屏」；(c) Runway Veo 3.1 一镜整片 9:16。 | 真 App 本线 `unverified`，交协调会话

## ★2 谁说了算

- 「比例意图落到这个模式的哪个键、哪一档」：`electron/shared/aspectRatioValue.ts`（#1023 的 `resolveAspectRatioChoice`，本刀加 `placeAspectRatio` = 落地那一层的入口、`aspectRatioControlKey`）。宿主准入、落画布、写回节点、批量条四处读它。
- 「分镜方案里比例住在哪」：`electron/shared/storyboard/storyboardShotScope.ts`（FILM_DEFAULTS 的比例槽 `aspect_ratio`；本刀加 `foldRatioIntoSlot`：起草与改一镜时把语义键 / 真实比例键收进比例槽；`shotModeControls`：一镜的模式控件，只读档案）。
- 「修订一镜的参数怎么并」：`electron/shared/generationParameterPatch.ts` `mergeNamedParameters`（从 #1024 的 `resolvePlanPatch` 里抽出来，宿主改草稿与文稿方案改一镜同一个函数）。
- 证据：`node scripts/door-map.mjs placeAspectRatio`（`plannedNodeMeta.ts` 落画布、`storyboardProjection.ts` 写回节点、`storyboardShotScope.ts` 批量条判据）；`node scripts/door-map.mjs mergeNamedParameters`（`generationPlanPatch.ts`、`storyboardSubjectAdapter.ts`）。

## ★3 一致与复用

- 比例判据只有一份（#1023 搬到 shared 的那份），本刀的三个落地点都调它；像素档同档规则原样复用。
- 合并只有一份：`mergeNamedParameters`（JSON Merge Patch 在一层参数对象上的语义）。
- 删掉的旧判据：`unsupportedFilmDefaultKeys` 里「控件键 == `aspect_ratio`」的字面判断；`shotRowModel.aspectControlOf`（按字面键找比例控件，生产零调用方）。
- 分镜门岗（`check:storyboard-owner`）的判据一个没动：落地路径照旧只经 `resolveShotParams` / `resolveKeyframeParams` 拿参数，翻译发生在它们之后、写进节点之前。

## ★4 全状态

不新增界面、不改文案。批量条「N 镜不支持画幅」：以前凡是比例键不叫 `aspect_ratio` 的都算；现在只算真落不下的（没有比例选择、或没有这一档）。节点：比例落在模型真实的键上，不多出一个它不认的 `aspect_ratio`。

## §3 修订时参数以外那几格（第 3 件）

| 格 | 今天的行为 | 改后 | 理由 |
|---|---|---|---|
| 参数 `parameters` | 宿主：#1024 起按键合并、`null` 删键。文稿方案：整份替换 | **两边同一个 `mergeNamedParameters`** | 本刀第 1 件 |
| 模型 `modelId` / `providerId` | 标量，点名才改；换模型时原有参数按新模型清残留并上报 | 不变 | 本来就是「只改点名的」；残留清理是换模型的必然结果，不是替换 |
| 模式 `mode` / `modeId` | 标量，点名才改；换模式时种类跟着走、原有参数按新模式清残留 | 不变 | 同上：模式定了参数表，旧模式的参数在新模式上发不出去，清掉并上报是唯一诚实的做法 |
| 变体 `variantId` | 标量；换模型时没点名的变体清掉 | 不变 | 变体属于模型，换了模型旧变体没有意义；**必须**清 |
| 参考 `references` | 点名就整列表替换 | **不变（刻意）** | 模型面给的就是完整列表（`references: string[]`），没有「加一张 / 删一张」的写法；RFC 7396 对数组同样是整体替换。改成按项合并要给模型面加增删操作，属于新能力、另立一刀 |
| 文稿方案参考 `referenceBindings` | 点名就整份替换（由参考列表算出的槽表） | 不变 | 它是参考列表的投影，跟着列表走 |
| 提示词 / 标题 / 时长 | 标量，点名才改 | 不变 | 已经是「只改点名的」 |

测试钉住：`generationPlanPatchMerge.test.ts` 「参数以外那几格」两条。

## ★9 验收与回滚

验收：另一条线按 ★1 三条任务在真 App 上看节点参数与批量条提示。单测：`src/workbench/generationCanvas/agent/storyboardRatioIntent.matrix.test.ts`（⑩ 矩阵 22 条：落画布 × 6 个模型、写回节点、批量条 × 6、文稿改一镜 × 5）、`storyboardShotScope.test.ts`（不支持判据 5 条）、`generationPlanPatchMerge.test.ts`。变异（先备份单文件）：文稿改一镜整份替换 4 红；起草不收比例槽 1 红；落画布不翻 6 红；不支持按字面键判 3 红；写回节点不翻 1 红；null 不删 2 红。回滚：revert 本 PR 提交（数据无迁移）。

## 方向检查（RW）

`fix-churn.mjs`：`generationCanvas/agent/` 目录第 7 个 fix、`creation/storyboard/exec/` 第 5 个、`generationPlanPatch.ts` 第 6 个、概念「一份补丁怎么并进这一镜的候选」第 11 个。

**0. 一句话根因**：同一个语义（比例、参数修订）在宿主与分镜两边各有一份写法——宿主按模式翻键、分镜按字面键；宿主按键合并、分镜整份替换——每修一边，另一边就以同一个症状冒出来。

**1. 归类**：#1023（宿主不翻比例）、#1024（宿主整份替换）、本刀（分镜不翻比例、分镜整份替换）——同一类：「一个语义两份实现」。

**2. 为什么一直冒**：分镜方案住在渲染层、宿主候选住在主进程，两边的参数都是一个 `Record<string, unknown>`，没有共享的「语义 → 真实键」与「修订怎么并」，各自写最顺手的那一版。

**3. 不改结构会冒什么**：①清晰度（`resolution` 取值写法各家不同）在分镜与宿主两边各错一次（验证：分镜整片清晰度设 2K 落到 Wan 上）；②参考素材的修订语义如果哪天改成按项合并，两边又会各写一份。

**4. 靶子独立性**：矩阵测试断言的是节点上真正会发出去的键与值、批量条的判断、方案里存下的参数，不是本刀的中间值；变异全红。

**5. P0**：合并 = RFC 7396；比例语义 = AI SDK 约定。两者都照标准，不引库（一层对象的合并就是一个展开）。

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 合并照 RFC 7396、比例照 AI SDK 约定，判据与合并各留**一份**放 `electron/shared`，两边都调它 | 本刀 | 低 | **是** |
| 补 | 分镜那边再写一份「按字面键 + 别名表」 | 第三份判据 | 下一次又漂开 | 否 |
| 重写 | 分镜方案改成直接存宿主候选形状 | 大改分镜存储与 UI | 高 | 否 |

**7. 用户要权衡的核心**：是否接受「分镜方案里比例只住比例槽、落地时再翻」这条规矩（今天分镜 UI 本来就只读这个槽）。推荐接受。

## 先查别人

- 合并语义：JSON Merge Patch，RFC 7396 https://www.rfc-editor.org/rfc/rfc7396 （对象按键合并、null 删除、数组整体替换——§3 参考那一格的依据）。
- 比例语义：Vercel AI SDK `generateImage({ aspectRatio })`（`node_modules/ai/dist/index.d.ts:3178`），#1023 照它的名字与格式。
- 仓库里：落画布的唯一写口 src/workbench/generationCanvas/agent/plannedNodeMeta.ts:77（`buildPlannedNodeMeta`，三条落地路径共用）；分镜比例槽 electron/shared/storyboard/storyboardShotScope.ts:109（FILM_DEFAULTS）。
