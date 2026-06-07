# 模型接入面板重设计 · 实施文档（方案 A 折叠摘要卡）

日期：2026-06-07
样张：`docs/design/mockups/onboarding-panel-A.html`（已用户拍板，方向 A）
对应规则：R4（执行前写文档）/ R8（样张已批 + 实现后逐项对账）/ R2（极简）/ R9（模块化）/ P4（通用第一）/ P1（加新删旧）

---

## 1. 背景与目标

**问题（用户反馈 + 设计师走查）**：打开「模型设置」面板（右上角浮卡）就是一面「模型墙」——
已知供应商卡（`VendorOnboardCard`）一连通就把该家**每个模型铺成一行**、每行重复「已连通/未连通」，
多家叠起来要滚很久。用户来这屏的真实目标只有两个：① 填一次 key 把某家接上；② 确认「接上了、能用」。
逐个模型清单在已连通后没有行动价值（不能逐个开关、点了不跳转）= R2 的 0 权重信息。

**目标**：首屏从「模型墙」变「几行供应商摘要」。每家供应商默认折成一行，想看清单点开。
统一「预置供应商 / 其他模型 / 添加模型」为同一套折叠卡语言。

**非目标**：不改后端 catalog / IPC / 模型数据；不改「添加模型」的向导流程本身（`OnboardingWizard`），只挪入口位置。

---

## 2. 现状（grounded，file:line）

- 浮卡壳：`src/ui/onboarding/OnboardingFloatingPanel.tsx`（320px 右上角浮卡，body = `<OnboardingDrawer/>`）。**不动。**
- 面板内容：`src/ui/onboarding/OnboardingDrawer.tsx:44`
  - 头部：`模型设置` + 右上「添加模型」按钮（`OnboardingDrawer.tsx:115-125`）→ 打开 `OnboardingWizard`。
  - 已知供应商卡：`KNOWN_VENDORS` × catalog 派生 → `VendorOnboardCard`（`:129-139`）。
  - 其他模型：非已知供应商的模型，按 kind 分组、逐行 + 删除（`:142-187`）。
  - 空态（`:189-194`）。
- 供应商卡：`src/ui/onboarding/VendorOnboardCard.tsx`——头部（logo+名+状态胶囊）+ key 区（`editing=!hasApiKey`）+ **全量模型逐行清单**（`:222-273`，密度问题根因）+ 推广位。
- 数据：`bridge.modelCatalog.listModels()/listVendors()`（`OnboardingDrawer.tsx:54-55`），`KNOWN_VENDORS`（`src/config/knownVendors.ts`，仅 apimart / kie）。**不新增数据源。**

---

## 3. 设计（方案 A v3，已对齐设计系统）

面板 = 单一列表，三种卡同一套折叠语言：

```
模型设置
─────────────────────────
预置供应商                         ← grouplabel（micro 11 / ink-40）
[A] APIMart   12 个模型可用  ●已连通 ▾   ← 折叠卡（连通→默认折叠）
[K] KIE.AI    填 key 解锁    ○待接入 ▾   ← 折叠卡（未连通→默认展开 key 输入）
其他模型
[▤] 其他模型  2 个自定义模型 ●已连通 ▾   ← 折叠卡（默认折叠）
┌╴＋ 添加模型 ╶ 接入不在上面的自定义模型 ┐ ← 虚线卡（末尾，排在一起）
```

点任意卡头 → 就地展开：
- 预置供应商展开：key 状态（已保存·更换/断开 或 key 输入框）+ 接入地址 + 模型 **chip**（按 kind 分组，组标题带数量，不再逐行重复状态）。
- 其他模型展开：自定义模型 chip（带 × 删除）。

### 设计师走查改动（对照 `docs/design/nomi-design-system.md`）

| 设计要求（出处） | 改动 |
|---|---|
| One visual hierarchy · 少加 border（§1 原则） | 组标签靠字号/字重分层不加框；模型由「逐行 + 边框」改紧凑 chip |
| R2 极简 · 好产品不靠解释（§R2） | 组标签砍到「预置供应商」「其他模型」；collapsed 副标题只留「N 个模型可用」；删多余 hint |
| 图标只用 Tabler，禁 emoji/字形（§6） | `IconChevronDown` / `IconPlus` / `IconKey` / `IconX` / `IconStack2`(其他模型 logo) |
| 间距 4 的倍数（§2.2） | 统一 `p-3`/`gap-3`/`gap-2`，去除 9/11px |
| 颜色 token / 状态（§2.1 / §5.5） | success 用 `workbench-success(-soft/-ink)`；中性走 `nomi-ink-*` |
| 圆角 token（§2.4） | 卡 `rounded-nomi`(10)、logo/input `rounded-nomi-sm`(6)、pill/chip `rounded-full` |

---

## 4. 组件架构（P4 通用 / P1 单一来源）

抽一个**折叠卡外壳**，预置供应商卡与「其他模型」卡共用同一壳（一种折叠语言，不写两套）：

```
FoldableModelCard（新，presentational 壳）
  props: glyph(ReactNode) / glyphTone('ink'|'soft') / name / subtitle
         status('ok'|'todo') / defaultExpanded / children(body)
  渲染: 边框卡 + 可点 header 行(logo+名/副标题+状态胶囊+chevron) + 可折叠 body(children)
  状态: 内部 expanded(初值 defaultExpanded)；header 点击 toggle

VendorOnboardCard（改）= FoldableModelCard
  status = hasApiKey?'ok':'todo'；defaultExpanded = !hasApiKey
  body = key 区(已保存·更换/断开 | key 输入+解锁) + 接入地址 + <ModelChipGroups>(按 kind)

OtherModelsCard（新，薄）= FoldableModelCard
  glyph=IconStack2(soft)；name='其他模型'；subtitle='N 个自定义模型'；status='ok'；defaultExpanded=false
  body = <ModelChipGroups> 带 onDelete(×)

AddModelCard（新，薄）= 虚线卡（非折叠）→ onClick 打开 Wizard

ModelChip / ModelChipGroups（新，薄）
  chip: 状态点 + labelZh + 可选 ×(IconX)；按 kind 分组、组标题「图片 6」
```

OnboardingDrawer 改为：grouplabel「预置供应商」+ knownCards.map(VendorOnboardCard) +
（otherModels>0 ? grouplabel「其他模型」+ OtherModelsCard）+ AddModelCard。**删头部「添加模型」按钮**（P1，入口只留虚线卡一个）。

---

## 5. 实现规范（精确 token / DOM / 状态 / 数据）

### 5.1 FoldableModelCard
- 容器：`border border-nomi-line rounded-nomi bg-nomi-paper overflow-hidden`
- header（button，整行可点）：`flex items-center gap-3 p-3 w-full text-left hover:bg-nomi-ink-05`
  - logo：`w-7 h-7 rounded-nomi-sm grid place-items-center`；ink 态 `bg-nomi-ink text-nomi-paper`，soft 态 `bg-nomi-ink-05 text-nomi-ink-60`；字 `text-bodySm font-semibold`
  - meta：`flex-1 min-w-0`；name `text-bodySm font-semibold text-nomi-ink truncate`；sub `text-caption text-nomi-ink-40 truncate`
  - 状态胶囊：`inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full text-micro font-semibold`
    - ok：`bg-workbench-success-soft text-workbench-success-ink` + 点 `w-1.5 h-1.5 rounded-full bg-workbench-success`
    - todo：`bg-nomi-ink-10 text-nomi-ink-60` + 点 `bg-nomi-ink-30`
  - chevron：`IconChevronDown size=16 stroke=1.8 text-nomi-ink-40`，展开时 `rotate-180`，`transition-transform duration-[var(--nomi-transition-fast)]`
- body：`border-t border-nomi-line-soft p-3 flex flex-col gap-3`
- a11y：header `aria-expanded`、`aria-controls`；body region `role` 可省，给 id。

### 5.2 ModelChip / ModelChipGroups
- group：`flex flex-col gap-2`；组标题 `text-micro font-semibold text-nomi-ink-60`，数量 `font-normal text-nomi-ink-40`
- chips 容器：`flex flex-wrap gap-2`
- chip：`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-nomi-line text-caption text-nomi-ink-80`
  - 状态点：`w-1.5 h-1.5 rounded-full`（ok `bg-workbench-success` / 未连通 `bg-nomi-ink-20`）
  - 删除：`IconX size=12`，`text-nomi-ink-30 hover:text-workbench-danger`（仅 OtherModelsCard 传 onDelete）

### 5.3 AddModelCard
- `flex items-center gap-3 p-3 border border-dashed border-nomi-ink-20 rounded-nomi bg-nomi-paper w-full text-left`
- hover：`hover:border-nomi-accent hover:bg-nomi-ink-05 hover:text-nomi-accent`
- 左 icon 盒：`w-7 h-7 rounded-nomi-sm bg-nomi-ink-05 grid place-items-center`，`IconPlus size=16`
- 文案：title `text-bodySm font-semibold text-nomi-ink`「添加模型」；sub `text-caption text-nomi-ink-40`「接入不在上面的自定义模型」

### 5.4 grouplabel
- `text-micro font-semibold text-nomi-ink-40 pt-2 px-0.5`：「预置供应商」/「其他模型」

### 5.5 数据绑定（不变）
- knownCards：`KNOWN_VENDORS` filter(有 vendorMeta) → {directory, meta, vendorModels}（同现 `OnboardingDrawer.tsx:97-106`）
- otherModels：`models.filter(!isKnownVendor)`（同现 `:109`），按 kind 分组喂 OtherModelsCard
- key 解锁/断开：复用 `VendorOnboardCard` 现有 `handleUnlock/handleDisconnect`
- 删除自定义模型：复用 `OnboardingDrawer.handleDelete`，下放给 OtherModelsCard 的 onDelete
- 添加：`AddModelCard.onClick = () => setWizardOpen(true)`（复用现有 Wizard）

---

## 6. 文件改动清单

| 文件 | 改动 |
|---|---|
| `src/ui/onboarding/FoldableModelCard.tsx` | **新增**：折叠卡外壳（§5.1）|
| `src/ui/onboarding/ModelChipGroups.tsx` | **新增**：按 kind 分组的 chip 列表（§5.2，可选 onDelete）|
| `src/ui/onboarding/AddModelCard.tsx` | **新增**：虚线添加卡（§5.3）|
| `src/ui/onboarding/VendorOnboardCard.tsx` | **改**：套 FoldableModelCard；body 用 ModelChipGroups 替换逐行清单；删推广位逐行依赖（推广位保留在 body 底，可选）|
| `src/ui/onboarding/OnboardingDrawer.tsx` | **改**：grouplabel + OtherModelsCard + AddModelCard；**删头部「添加模型」按钮**（P1）；其他模型逐行 → OtherModelsCard |
| `tests/ux/design-fidelity.e2e.mjs` | **加**：本面板折叠/展开 + 无头部 add 按钮 + add 卡存在的断言 |

预计净增 ~2 个小文件、VendorOnboardCard/OnboardingDrawer 各净减逐行清单代码。全部 < 800 行（R9/R12）。

---

## 7. 不动项（明确不碰）

- 后端 catalog / IPC（`modelCatalog.*`）、模型数据、key 存储。
- `OnboardingWizard`（添加流程本体）——只换触发入口。
- `OnboardingFloatingPanel`（浮卡壳：位置/尺寸/点外关闭）。
- 推广位（promo）逻辑——保留（可移进展开 body 末尾）。

---

## 8. 回滚策略

改动集中在 `src/ui/onboarding/`，单一 commit。回滚 = `git revert` 该 commit；
新增文件随之移除，VendorOnboardCard/OnboardingDrawer 回到逐行清单形态。无数据迁移、无 schema 改动，零副作用。

---

## 9. 验收门（P3：全绿 ≠ 完成）

1. 五门：`check:filesize` → `lint:ci` → `typecheck` → `test` → `build` 全绿。
2. `design-fidelity.e2e.mjs` 新断言：① 连通供应商卡默认**折叠**（body 不在 DOM）；② 点 header → body 出现且含 chip；③ 头部无「添加模型」按钮；④ AddModelCard 存在且点击打开 Wizard；⑤ 状态胶囊每卡仅 1 个（不再逐模型重复）。
3. R13 真机走查（`ui-driver`）：开面板 → 截图见「2 行供应商 + 其他模型 + 添加模型」而非模型墙 → 展开 APIMart 见 chip → 点添加模型见 Wizard。**人眼对账样张 v3 逐项**（几何实测不被裁/不溢出，浮卡内滚动正常）。

---

## 10. 待定决策（已选默认，可改）

1. **其他模型展开**：默认**按 kind 分组**（与预置卡一致）。若自定义模型通常很少，可改平铺——默认分组。
2. **待接入预置卡（KIE）**：默认**展开 key 输入**（= 现 `editing=!hasApiKey` 行为，更快上手）；连通卡默认折叠。
3. **推广位**：保留，移到展开 body 末尾（折叠态不显，减噪）。

> 以上默认若 OK 即按此实现；要调在开工前说。
