# 方向检查：视频节点「截帧」+ 本机处理失败卡只留「重试」（2026-10-10）

> 触发：`node scripts/fix-churn.mjs` 命中 `NodeVideoFrameToolbar.tsx`（14 天 4 个 fix，本刀是第 5 个）、`narrate.ts`（11 个 / 概念「错误 → 人话与动作」20 个）、`classifyError.ts`（16 个）、`NodeErrorReport.tsx`（5 个）、`BaseGenerationNode.tsx`（8 个）、`assetImportAdapter.ts`（3 个）。
> 设计卡：`docs/plan/2026-10-09-video-node-next.md`（用户 10-09 / 10-10 拍板「设计没问题」；便签 3 点按推荐，其中「本地处理失败卡只留重试」就是本文要回答的类）。

## 0. 一句话根因

失败卡的「下一步」只回答过「是哪一类服务商失败」，**没人回答过「这次失败有没有服务商参与」**：认不出的失败一律归 `unknown`（重试 + 换个模型），于是截帧、提取深度、本地素材复制这种全在本机的失败也被问「要不要换个模型」。

## 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 提取深度失败卡有「换个模型」（设计卡 ★4 已知别扭，vn-11 样张里也有） | 深度失败文案是普通 i18n 句子，分类器认不出 → `unknown` → `RETRY_FIRST`（次动作换模型） | 本机处理失败没有自己的类 |
| 本地素材复制失败（`retryableImport`）卡同理 | 同上 | 同上 |
| 截帧（本片新增入口）失败 | 同上，若不处理会是第三个「各自掉进 unknown」的入口 | 同上 |
| 近 14 天 `narrate.ts` / `classifyError.ts` 的其余 fix | 各是某一个服务商侧的类（限流 / 内容安全 / 取回失败 / 出站策略……）补文案或补动作 | 不同类：它们是服务商侧的细分；本刀加的是「根本没有服务商」这一支 |
| `NodeVideoFrameToolbar.tsx` 近 4 次 | 3 次 feat/chore（提取深度入口、拆解入口、图标），1 次布局；都不是截帧语义 | 文件是热点因为它是「视频卡所有动作」的唯一入口，不是因为同一个 bug 反复 |

## 2. 为什么这一类会一直出现

动作表 `ACTION_BY_KIND` 是按**服务商侧失败的细分**建的；本机步骤出错没有自己的位置，只能落进兜底类。每来一个本机入口（深度、素材复制、截帧、以后的剪辑 / 拆片）就会再多一个「失败卡长了一颗没用的按钮」。铁律对应：⑫ 点了 = 以为的——「换个模型」对一个没有模型的步骤，点了什么都不会变好。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 第二片「剪辑」(ffmpeg 重编码) 失败卡也会带「换个模型」 | 剪辑失败文案不走码 → `classifyGenerationError` 返回 `unknown` |
| 本机处理失败卡的「重试」会被接到「重新生成」上（`confirmAndRunNode`），而不是重做那一步本机处理 | 截帧失败卡点重试 → 走 `confirmAndRunNode`（对图片卡是一次生成） |

## 4. 靶子独立性检查

- 尺子：用户 10-10 拍板原话「本地处理失败卡只留重试」；断言读真窗口里失败卡的按钮文字（`tests/ux/video-frame-capture.walk.mjs` 05），不读实现。
- 探针活着：同文件 04 用同一台像素探针读首帧与 7.2 秒那帧，读数相差 > 7 秒，证明探针在区分时间；`localProcessingError.test.ts` 的对照用例证明没带码的失败仍是「重试 + 换个模型」。
- 没有「修对了反而掉分」的先例。

## 5. P0：这些是我们独有的吗？现成方案有哪些

- 抽帧：ffmpeg，已在用（`electron/video/extractVideoFrame.ts`，主进程早就认任意秒数），不新写。
- 失败分类：沿用 `NOMI_ERR::` 机器码协议（`electron/shared/nomiErrorCodes.ts`，仓库已有的「码不随翻译变」做法），不新造一套标记；错误卡本身不动。
- 撤销：沿用 `runAsSingleUndoStep`（#1133 刚修过同类问题的那一个），不另起事务。
- 连线：沿用 `addDerivedOutput`（评审第 3 轮定的唯一出处边写法），只在规则表加一行 `'video-frame'`，不绕过 store 写边（另一线 I-edgecheck 正在收建边入口）。
- 自写的只有「截帧」这个动作本身（领域：镜头 / 素材）和「本机处理失败」这一类的归类。

## 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 无通用库承载「错误卡该给哪几颗按钮」（这是 Nomi 的产品语义） | — | — | 不适用 |
| 补（给截帧单开特例） | 截帧失败卡里隐藏「换个模型」 | 小 | 第三个特例分支；深度、素材复制仍在，下一个本机入口再来一遍 | 否 |
| 补（按类） | 加一类 `local-processing`（机器码判定、动作只有重试），三个现有本机入口同提交接上；重试走一张表 `localStepRedoOf`，不再在失败卡里堆 `meta.xxx ? a : b` | 中：一个类 + 三个入口 + 一张重试表 | 低：只影响带码的失败，没带码的原样不变 | **推荐** |
| 重写（限一个模块） | 重做错误卡动作表，改成「由 `vendorSide` 派生动作」 | 大 | 现有 28 类里有 `vendorSide=false` 却合理给「换模型」的（模型已下线、类型不符），派生会改变它们 | 否 |
| 删 | 删掉「换个模型」按钮 | 小 | 服务商侧失败需要它 | 否 |

选「补（按类）」而不是「换」：动作表和分类器本身是对的，缺的是「本机处理」这一支；没有旧实现要替。同提交收口的旧东西：失败卡里 `retryableImport ? retryLocalAssetImport : confirmAndRunNode` 的内联分支（改读 `localStepRedoOf`）、设计卡里「失败卡沿用现役、已知别扭」的待办。

## 7. 用户要权衡的核心

用户已拍板（10-10 便签按推荐）：本机处理失败只留「重试」。代价：这一类的失败没有别的出口（也没有「去模型接入」）——对一个没有模型参与的步骤，这是对的；若将来本机步骤会因为缺模型文件失败（如深度权重下载失败），要给它加「去下载 / 去设置」的专属动作，那是另一个类。

## 特征测试清单（动结构前先锁住）

- `src/workbench/generationCanvas/runner/classifyGenerationError.test.ts`、`src/workbench/observability/*.test.ts`（动作表 / 目录穷举，本刀前后全绿）。
- `src/workbench/generationCanvas/adapters/assetImportAdapter.test.ts`（素材复制失败 / 重试，保持）。
- `src/workbench/generationCanvas/nodes/extractVideoFrameProjectContext.test.ts`（换项目即取消，保持并扩成截帧全链路）。
- `tests/ux/node-toolbar-one-row.walk.mjs`（浮条一排，按钮名改「截帧」）。
