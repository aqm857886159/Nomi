# 供应商偏好 · 设计实验室登记（2026-09-06 返工）

## 为什么返工

第一版的「设计证据」是一张手写静态页（`tests/ux/design-lab/vendor-order.html`，本次已删）。
它有两个结构性问题，用户看完当场否掉：

1. **没走现役组件**——页面里的下拉、chip、排序行都是另写的 HTML/CSS，改了生产代码它照样"绿"。
   这正是 2026-09-06 用户拍板「UI 交付 = 实验室截图拍板 + 视觉基线绿」要消灭的那种证据。
2. **没走设计系统**——通篇 hex 色值（`#6c62e8`、`#deded8`…）、任意 px 字号与圆角、自造按钮，
   与 `docs/design/nomi-design-system.md` §2 的 token 表没有一处对得上。

## 现在的证据链

| 层 | 在哪 | 证明什么 |
|---|---|---|
| 实验室屏 | `design-lab.html?screen=vendor-order` | 屏上每一格都是**现役组件**（`NomiSelect` + `buildModelSelectOptions` + `VendorPreferenceOrderSection`）渲染的，夹具只决定目录内容 |
| 走查截图 | `pnpm run design-lab:walk:vendor-order` → `tests/ux/shots/design-lab-vendor-order/*.png` + `_contact-sheet.png` | 人眼逐格看 / 接触表拍板 |
| 真机旅程 | `node tests/ux/vendor-preference-order.walk.mjs` → `tests/ux/shots/vendor-order/journey-*.png` | 真 Electron + 真 IPC + 真生成一次，实验室里那套在真机上确实长这样 |
| 视觉基线 | `pnpm run check:design-lab` | **暂缺，故意的**：`vendor-order` 登记在 `calibration.json` 的 `pendingApprovalScreens` 里。没被人看过的屏没有可回归的对象，现在录一套只会把「今天碰巧长这样」钉成「应该长这样」。孤儿基线不受豁免，照红 |

拍板后的动作：删掉 `tests/ux/design-lab/calibration.json` 里 `pendingApprovalScreens.vendor-order`
那一条，跑 `pnpm run design-lab:update` 录基线。

## 屏上的七个状态

| id | 看什么 |
|---|---|
| `vo-01-picker-preferred` | 有偏好：偏好那家排第一并高亮 |
| `vo-02-picker-no-preference` | 无偏好：按供应商分级排（官方在两家中转前面，**不是**厂商名字母序） |
| `vo-03-picker-hides-unconnected` | 目录里有没接入的家，它们的模型一行都不出现（夹具喂整份目录，筛掉的是生产代码） |
| `vo-04-picker-empty-no-vendor` | 一家都没接入：诚实空态一行「还没接入供应商 · 去接入」，不是空白下拉 |
| `vo-05-picker-selected-row` | 选中行：加粗模型名 + 一排 chip + 最右对勾三样同行不打架 |
| `vo-06-settings-order` | 设置 → AI 策略 → 优先供应商（三家可排序） |
| `vo-07-settings-two-vendors` | 同上，两家：首尾两端的按钮禁用态 |

## 这次修掉的真机问题（现状截图见 PR）

- **模型名被供应商 chip 挤到 0 宽**：真机实测（2026-09-06，画布节点模型下拉）三行只剩
  `[图标] 3 家 (APIMart)(Kie)(RunningHub)`，模型名一个字都不剩。根因是同一件事说了两遍
  （`trailing: "N 家"` + 一排 chip），而模型名没有 `flex-1` 兜底。现在：多家只留 chip、
  单家只留厂商短名附注；模型名 `flex-1` 优先占宽；chip 最多三个，超出收成 `+N`。
- **「优先供应商」放错了 tab**：它是**策略**（在已接好的几家里定默认走哪家），不是**接入**，
  按设计系统 §1.7.2 的分界线归「AI 策略」，与紧邻的「新建卡片默认模型」同族。原先挂在
  「模型」tab 的 `ModelSettingsHome` 里，那是第二个「默认用什么」的家（§1.5.2 一功能一个家）。
- **没设偏好时默认家静默漂移**：新排序函数漏了供应商分级这一级，退化成厂商名字母序，
  同一个模型的默认家会从火山方舟（官方）漂到 apimart，而没有人做过这个决定。
- **目录硬过滤被全局放宽**：为了灰显未配置的家，`getCatalogModelOptions` 的
  「列出来的都能跑」承诺一度被整个拿掉，连 agent 可用模型清单、成本预估、「换到 X」指路
  都跟着拿到没钥匙的家。

## 2026-09-06 用户拍板后的收敛（本次改动）

用户看完这一屏后拍板：**没接入的供应商，它的模型不显示**——不沉底、不灰显、也不「点了跳接入」。
于是上面那条放宽口整个删掉，闸只剩一处：`src/config/modelCatalogCache.ts` 的
`keepRunnableVendorOptions`，接在 `getCatalogModelOptions` 的派生链上。每个选择器都吃它的输出，
没有一个自己再过滤一遍（也就不存在「漏掉的那个」）。

连带删干净的旧实现（P1 加新必删旧）：`MODEL_PICKER_CATALOG_SCOPE` / `CatalogOptionScope` /
`ModelOption.configured` / `NomiSelectOption.sectionLabel` / chip 的 `dimmed`·`disabled` /
`sortModelProviders` 里的「能不能跑」那一级 / i18n 的 `unconfigured`·`unconfiguredGroup`。

新增的是**诚实空态**：一家都没接入时，模型框不是空白，而是一行
「还没接入供应商 · 去接入」（`useDedupedModelSelect.ts` 的 `connectVendorOption`，
走 i18n `generationCommon.parameters.noVendorConnected` / `connectVendorAction`，zh-CN + en 两份），
点它触发全仓同一条 `nomi-open-model-catalog` → 打开设置的模型接入页。

## 入口盘点（2026-09-06 实扫）

| 入口 | 组件 | view-model |
|---|---|---|
| 生成节点模型下拉 | `src/workbench/generationCanvas/nodes/InlineParameterBar.tsx:566` | `useDedupedModelSelect` |
| 分镜行模型 chip | `src/workbench/creation/storyboard/shotRow/StoryboardShotRow.tsx:269` | `useDedupedModelSelect` |
| Agent composer 模型钮 | `src/workbench/ai/AssistantModelPicker.tsx:148` | `useDedupedModelSelect` |
| 画布框选批量 | `src/workbench/generationCanvas/components/CanvasBulkModelSelect.tsx:53` | `BulkModelPicker` |
| 分镜「全部镜头」批量 | `src/workbench/creation/storyboard/StoryboardBulkBar.tsx:125` | `BulkModelPicker` |
| 设置 → AI 策略 → 优先供应商 | `src/workbench/settings/VendorPreferenceOrderSection.tsx` | — |

排序真相源只有一份：`src/config/modelIdentity.ts` 的 `sortModelProviders`。
