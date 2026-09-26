# 结构评审：画布层反复修的三类问题都缺同一种东西——决定的 owner（2026-09-25）

> 触发：`check:symptom-cluster` —— `src/workbench` 7 天内第三份以上根因合同（本批 `2026-09-25-composer-pinned-below-node`、`2026-09-25-canvas-no-auto-viewport`）。
> 按门岗要求：第三份合同是「这一层结构不对」最便宜的证据，先出结构评审再修。

## 分级总表

| 级 | 问题 | 一句话 |
|---|---|---|
| P0 | 浮框放置 | 矩形由「躲屏幕上所有东西」算出，6 份合同每次加一个要躲的；本批改成只看自己节点 |
| P0 | 视口移动 | 21 个移动入口，多数是程序事后补偿「新东西不在屏里」；本批立落点 owner、删自动移动、名单化剩余入口 |
| P1 | 付费确认判据 | 入口各判各的，来源（Agent）在进漏斗前丢失；本批收成一个纯函数 |

## 横切观察（机制层共因）

三类问题长成同一个形状：**一个本该由某一层回答的问题（「浮框在哪」「新东西落在哪」「这一下要不要问」）没有被任何一层认领，于是每个入口各自回答一遍，再用事后补偿把不一致抹平。**补偿本身又成为下一次修复的对象——浮框的「躲」、画布的「露出」、确认卡的「每次都弹」都是补偿。

对应的结构改法也一样：把问题交给一个纯函数 owner（输入只有它真正该看的东西），入口只报事实；删补偿；对剩下的入口建名单或类级测试，新增入口不进名单即红。

| 问题 | owner（本批） | 输入 | 名单 / 类级守卫 |
|---|---|---|---|
| 浮框在哪 | `nodes/composerCanvasPlacement.ts` | 节点尺寸、缩放 | `composerCanvasPlacement.test.ts`（尺寸 × 缩放全扫 + 源码不许再量屏幕） |
| 新东西落在哪 / 哪些没看见 | `store/canvasVisibleArea.ts`、`components/canvasArrivalModel.ts` | 可见区、分类、store 节点差集 | `canvasViewportMovers.structure.test.ts`（移动入口名单） |
| 要不要弹付费确认 | `spend/spendConfirm.ts` `spendConfirmationRequirement` | 发起方、份数、报价、托管告知 | `spendConfirmPolicy.test.ts`（全组合） |

## 仍在这一层、没在本批解决的

- 分类显示名有 4 份手写（`toolCallSummary.ts`、`CategoryTree.tsx` 两处回落 id、`CategoryItem.tsx` 已收进 `categoryDisplayName`）；剩下两处语义不同（回落 id 而非用户起的名），另开任务收口。
- 辅助平移（中键 / 空格拖）每个 pointermove 仍写一次 `workbenchStore` 视口（`useGenerationCanvasReactFlowPointer.ts`），「画布缩放」概念的第二份副本仍在；本批只去掉了程序动画的逐帧写入。
