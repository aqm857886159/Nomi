# 付费卡参考图一个主人：卡上看到的 = 发出去的 = 画布节点上摆着的

> 状态：已实现未推送（2026-10-07，分支 `fix/spend-card-references-one-owner`）。根因合同：`docs/fixes/2026-10-07-spend-card-references-one-owner.root-cause.json`。

```
改动名：付费卡参考图一个主人     线/负责人：实现线 L-refs     类别：[花钱][其他]
```

## 用户那几幕（在最新 main 上逐条复现过）

| # | 那一幕 | 最新 main 上 | 复现方式 |
|---|---|---|---|
| ① | 卡上打 @，本项目画布上已出图的节点一张都列不出来，弹「没有可引用的素材」 | **还在** | 卡的写入面没有连线权能 → `useNodeMentionSource` 把「画布」组整组藏掉；素材库里同一张图又因「画布优先」被去重掉。矩阵第 4 行在旧行为下红（列表里没有 `canvas:<id>`） |
| ② | @ 别的项目的图，点生成被拒，提示却说「可以改一下再按一次」 | **还在** | @ 的素材库组列全部项目的素材，直接把别的项目的地址落进卡；宿主 `resolveSpendReferenceInputs` 只认本项目素材（`generation_reference_asset_unsupported`，没发起、没花钱）；`spendActionFailureCopy` 不看语义码，落到「改一下再按」。loopback 测试复现：宿主回 `reason=generation_reference_asset_unsupported`，供应商 0 次请求 |
| ③ | 画布上接进「参数图槽」的参考没并进付费卡 | **部分已修**：带档案的模型，连线进首帧 / 参考格的那一张卡上有、也发出去（#947 系列的 `canvasReferenceInputs`，main `3362f0f7c` 上复现为不再出现）。**还在**：画布占位节点「首帧」那一格里直接选的素材（没有连线）卡上没有、也不发——画布自己生成会带它，付费生成出的是不带它的图 | 矩阵第 3 行：旧行为卡上 0 张、宿主 0 张，画布解析出 1 张 |
| ④ | 在卡上带参考生成后，画布节点的参考槽是空的，只剩提示词里的 @ 芯片 | **还在** | 主进程落地报文 `candidateWire` 只带标量参数，候选里钉住的参考从来没过这条线；渲染层重绑定只写提示词和模型。loopback 测试：确认之后落地报文里这一镜没有参考 |

## 9 格

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当 Agent 起草了一镜、付费卡摆在面前时，我想让卡上那几张参考图就是画布上这一镜摆着的那几张，点生成时发出去的就是它们，生成完画布节点上还看得见它们。步骤：① 画布上给占位节点连一张图 / 往「首帧」那一格选一张素材；② 卡上看到它；③ 卡上打 @ 再加一张本项目画布上的图，或别的项目的图；④ 点「生成这张」；⑤ 画布节点参考槽里有这几张。**不做什么**：不改卡的样子、不加新按钮；卡上拿掉画布上那张仍只改卡、不动画布（付费卡第 8 行，原样保留）。**已知坑**：自己接入、没有 Nomi 档案的模型声明的图片参数（如 NewAPI 兼容视频的 `image_url`）在 Agent 付费路径上仍不支持，见下「残余」。**真实任务**：A. 画布上猫的定妆图连进视频镜头首帧，Agent 起草后在卡上点生成；B. 卡上 @ 画布上已有的场景图再生成；C. 卡上 @ 另一个项目里的角色图再生成。主指标：卡上 / 出站 / 回写三处参考地址集合一致（矩阵全绿）；护栏：别的项目的图不进本项目之外的地址、宿主拒收时 0 次供应商请求 | `src/workbench/ai/v4/spendCardReferenceOwner.matrix.test.ts`；`electron/capabilityCore/agentPanelSpendReferences.e2e.test.ts`；`tests/ux/full-walk/escapeLedger.json` |
| ★2 谁说了算 | 「这次生成带哪些参考」→ 宿主候选 `candidate.references`（真正发出去的）。卡是它点生成前的编辑器：默认 = 候选 ∪ 画布占位节点会自己带上的（连线 + 它自己参考槽里的值），只经 `placeSpendReferences` 一处读画布；节点上「一条参考 ↔ 哪一格」只有 `referenceInputSlots` 一张表；@ 怎么落只问 `planMentionInsert`；别的项目的素材只经素材库那道关口 `materializeAssetLibraryItems` 进项目；候选 → 画布只经落地 `buildMaterializeShotsPayload` → `planReferenceProjection`。碰了一个概念 | `node scripts/door-map.mjs placeReferenceInputs`（以及 `placeSpendReferences` / `planReferenceProjection` / `planMentionInsert` / `resolveSpendReferenceInputs`），门表在根因合同 `doors` |
| ★3 一致与复用 | 复用：槽位解析 `resolveReferenceSlots`、模式对齐 `resolveModeForConnectedReferences`、跨项目复制关口 `materializeAssetLibraryItems` / `copyProjectAsset`、宿主钉参考 `resolveSpendReferenceInputs`、落地链 `materializeShots`。没有第二份：原来卡里的 `applySpendReferences` / `slotRole` 搬进画布模型层 `referenceInputSlots`（卡和落地共用），`canvasReferenceInputs` 删掉（只剩测试在用）。自己写的只有「候选参考 → 画布节点补什么」这一个规划函数（领域：画布节点与镜头候选的对应） | `git grep applySpendReferences` = 0；`check:self-written` |
| ★4 全状态 | 卡上有参考：摆在卡自己的参考槽里（和以前一样）；@ 列表：当前参考 / 画布 / 素材库三组，两个宿主一样；@ 别的项目的图：先复制进本项目，复制完 chip 落在复制品上（一般毫秒级，不出新界面）；复制失败：沿用已有那句「N 个素材没能复制到本项目」；放不下（槽满 / 模型不收）：沿用连线那几句；宿主拒收（素材不在本项目 / 文件已不在）：卡上那句点名是参考图、给「拿掉它再按 / 用 @ 重选」两条真能走的路（卡改不了时仍是「点 × 关掉告诉 Nomi」那一句）；落地回写：节点上已有的不重复、不删；能力不可用：不适用——这一轮不涉及要模型或外部资源才能做的新动作 | 设计实验室 `v4-spend-mention-canvas(-en)`、`v4-spend-reference-not-in-project(-en)`；`check:i18n` |
| 5 中途表 | 卡上 @ 别的项目的图复制中：关卡 / 翻页 → 复制照完成，chip 插不进已关的编辑器（`isDestroyed` 判过），复制品留在本项目素材库，不扣费；断网：本地复制不受影响；重启：复制要么落盘要么没有，卡上没有半张；连点：每点一次走一次关口，重复的同一张由槽位去重。点生成后：宿主拒收 = 没发起、0 次供应商请求（loopback 测试断言）；落地回写是 best-effort，失败只记 warn，生成照跑 | `agentPanelSpendReferences.e2e.test.ts`；`multiShotCanvasLanding.ts` 头注释 §1 |
| 6 外部数据与失败 | 外部来源只有用户的素材文件：别的项目的素材按 `copyProjectAsset` 校验源项目与真实路径后复制；读不到 / 不是本项目的地址 → 宿主拒、卡上点名；不涉及供应商 API 形状变化 | 不适用：没有新的供应商接口 |
| 7 性能预算 | 卡每次重算多读一次占位节点自己的参考槽（一个节点，O(槽数)）；落地只对新建 / 重绑定的镜补参考（不在跟随者每一拍重放）。不阻断，只记录 | 人工：矩阵测试单格 < 50 ms |
| 8 真实条件 | Windows ✓（本机跑）；英文界面 ✓（实验室 en 两格）；真付费：`unverified`——按规矩不花钱，由协调会话事后亲自抽检（建议一张图片镜头、带一张画布参考，最小量 1 次）；干净安装 / 真规模：`unverified` | 截图见 PR 正文；本机看过 |
| ★9 验收与回滚 | 验收（另一条线）：跑 `pnpm exec vitest run src/workbench/ai/v4/spendCardReferenceOwner.matrix.test.ts electron/capabilityCore/agentPanelSpendReferences.e2e.test.ts src/workbench/generationCanvas/model/referenceInputSlots.test.ts src/workbench/ai/v4/spendCardFailure.test.ts`；按「真实任务 A/B/C」在真 App 里各走一遍（真付费由协调会话做）；变异：去掉占位节点自己槽位的读取 / 恢复藏画布组 / @ 不走复制关口 / 落地报文不带参考 / 失败文案不看语义码，各自必红（已在本线跑过）。回滚：revert 本 PR 的提交即可，无数据迁移 | PR 正文 `## 独立验收`（待填） |

### 功能分类
- [x] 花钱
- [x] 新界面 / 改交互（只是卡上 @ 列表多出「画布」组、失败那句换成说真话的；没有新元素）
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式

## 残余（不在这一轮改，已报协调会话）

- 自己接入、没有 Nomi 档案的模型（如 NewAPI 兼容视频）声明的图片参数（`image_url`）：画布上接进去的参考，付费卡既摆不出、宿主（引擎 B）也没有对应的投递通道。要么让卡带上参数声明 + 宿主按参数键投递，要么在卡上明说「这种模型的参数图 Agent 付费路径暂不支持」。属产品取舍，交协调会话定。
- 本改动之前已落地的占位节点，要等它的候选下一次换版（重绑定）时才补回参考。
