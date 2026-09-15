# 品牌图与预置模型清单收成单一登记处 —— 先查别人（PR #788）

> 状态：✅ 已交付

本份是 PR #788（`fix/provider-logos-and-preset-model-list-20260914`）的 R27「先查别人」报告。
两件事要动手前先查了一遍：① 「哪张图代表哪个品牌」该怎么收口；② 「已预置多少模型」的列表该用什么渲染。
结论都是**复用仓内既有的形状，不新造机制**。

## 先查别人

- 仓库里已有（同族门岗已经把这条不变量机器化了，照它的思路做）：`scripts/check-icon-semantics.mjs:3` 的「一个动作只能有一个图标」门岗，头注释写的正是本次 §④ 的同一条病理——「设计系统只管形制，语义那一半靠一张登记表和自觉；自觉记不住，于是同一个动作在不同界面长出不同图标，用户每换一个面就得重新学一遍」。品牌图是它的**资产实例**：四份互不认识的「哪张图代表哪个品牌」（`src/config/knownVendors.ts`、`src/config/modelProviderIdentity.ts`、`src/ui/onboarding/onboardingDrawerConnections.ts`、设计实验室夹具）正是「靠自觉」的结果，所以收成 `src/assets/vendor-logos/index.ts:16` 一张表 + `src/design/vendorLogoImage.tsx` 一个渲染口。
- 仓库里已有（可直接照抄的「唯一真相源」写法）：`src/design/actions.tsx:234` 的「变体/尺寸 = 工作区按钮的唯一真相源」——一张常量表 + 一个组件把读它的地方全收掉。本次 `VENDOR_LOGOS` + `VendorLogoImage` 是同一形状的第二次应用，不是新机制。
- 仓库里已有（列表不必新写组件）：`src/ui/onboarding/ModelChipGroups.tsx:58` 已经在「AI 策略 → 允许的模型」渲染同一份完整清单（143 个权限复选框就是它）。§③ 的正解因此不是写第二个列表组件，而是把**同一个** `ModelChipGroups` 用到接入页上，并删掉只传 `.length` 的 `modelCount` prop——数字与列表同源。
- 依赖/生态里有没有现成的？品牌图这件事没有可复用的第三方判据，判定为**领域约束**：每家的官方 icon 在什么 URL、是「深色笔画 + 中性浅底」还是「彩色底板」，只能逐家去官方站点实取（本 PR 正文那张表逐行给了官方来源 URL 与像素尺寸）。「深笔画浅底」那三家（APIMart / ElevenLabs / Runway）暗色下必须反相，这一判据也只能自己登记（`MONOCHROME_LOGO_NAMES`，`src/assets/vendor-logos/index.ts:44`），并且只有一处读它。
- TikHub 自媒体来源：本次没用 TikHub —— 要查的是「每家官方 icon 的一手出处」，一手出处就是各家官网本身；自媒体转载的图无法当作品牌资产的依据（这正是即梦被并进豆包那类错误的来源）。

结论：**用已有形状，收口而不是新造**。`VENDOR_LOGOS` 一张表、`VendorLogoImage` 一个渲染口、四处旧写法同 commit 删掉（P1）；列表复用 `ModelChipGroups`，`modelCount` prop 同 commit 删除。
不新增框架，不改供应商 API 契约。

## 范围与不动项

- 动：品牌图资产登记与渲染口、`NomiIdentityIcon` 的兜底顺序（图挂了才换字形）、未接入供应商的 `models` 透传、接入页的清单渲染、zh/en 文案。
- 不动：供应商适配器与请求路径；「AI 策略 → 允许的模型」那一面的既有形态（它是这份清单的另一个消费者，本次只是不再让接入页另写一份）。
- 连带删除：`identityIconUtils.ts` 及其单测、旧 i18n 键（`adaptedHint` → `adaptedHintWithCount` / `adaptedHintNoModels`）。

## 验收门

见 PR #788 正文：logo 对照表（改前 / 官方来源 URL / 改后，含像素尺寸）、两种主题下的实拍放大验证、真机隔离 profile 的改前改后同视角截图。
