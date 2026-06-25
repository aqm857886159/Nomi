# 模型接入面板重构：已接入 / 可接入 分层 + 方案2 分组折叠 + 自适应默认

> 日期：2026-06-25 ｜ 分支：main ｜ 文件：`src/ui/onboarding/OnboardingDrawer.tsx` 及同目录卡片
> 样张：本轮对话 `model_onboarding_connected_vs_available_split` + `onboarding_fold_variants_compare`（方案2 + 自适应默认，用户拍板）

## 1. 问题（用户反馈，2026-06-25）

「模型设置」面板供应商太多、太复杂。多轮收敛后定位根因 + 拍板方案：

- **不是"家数多"**：用户真实持有的是**一小撮、各异的组合**（即梦+中转 / 魔搭+火山），没有"唯一正解"可钦点。
- **不是"重新分类"**：把"文本模型/各家供应商/编程助手"搅进一个大选择器是**更糟的拆法**（异质、不在一个层级）。用户原话：原来的拆法没问题。
- **真缺的只有一层**：把「已经接入」和「可以接入」分开——接好的浮顶一眼可见，没接的归到下面、不打扰。
- **折叠**：可接入那一坨要能折叠，否则老用户仍被一长串选项淹没。

## 2. 拍板结论

1. **保留原分组**（接入生成模型 / 有即梦会员？/ 接入编程助手·可选），一个不动。
2. **最外层套「已接入 / 可接入」两段**。
3. **可接入 = 方案2「分组折叠」**：每个原分组是一个可折叠组头，带数量（`接入生成模型 · 5`），点开才露该组卡片。
4. **自适应默认**：有任一已接入的家 → 各组默认收起；一家都没接的新用户 → 自动展开第一组「接入生成模型」（那一刻他就是来接模型的，收起反而挡路）。
5. 软推荐保留但只当软提示（聚合中转/apimart 一个微标，不钦点、不占 C 位）——**本期可不做，列入 §8 后续**（用户重心在分层+折叠）。

## 3. 目标布局

```
模型设置
你现在已经能生成： [图片][视频][文本][配音 未接]   ← 不变，能力概览条

已接入                                          ← 新增段（仅当有已接入项时显示）
  〈连通的卡，跨类扁平排：连通的 vendor / 即梦(已登录) / 编程助手(已接)〉

可接入                                          ← 新增段
  接入生成模型 · 5            ▸  （折叠组头，带数量）
    └ 展开：未连通 vendor 卡 + 「添加模型 / 中转站」
  有即梦会员？ · 1            ▸
    └ 展开：DreaminaMemberCard
  接入编程助手 · 可选 · 1     ▸
    └ 展开：ConnectAssistantCard
```

新用户（零已接入）：无「已接入」段；「可接入」首组默认展开。

## 4. 架构决策（根因层，P2）

### 4.1 连接状态单一来源（核心）

分桶/计数必须 derive 自统一的"连没连"，不 hardcode。三类连接状态当前分布：

| 类 | 连接判定 | 现状真相源 |
|---|---|---|
| 生成 vendor | `vendor.hasApiKey` | ✅ 父组件已有（`vendorMeta`）|
| 即梦 | `dreamina.status().installed && loggedIn` | ❌ 只活在 `DreaminaMemberCard` 内部（异步）|
| 编程助手 | `capability.mcpInfo()` 任一 `clients[k].installed` | ❌ 只活在 `ConnectAssistantCard` 内部（异步）|

**决策：把即梦/编程助手的连接状态上提到 `OnboardingDrawer`**，与 `hasApiKey` 并列成统一的 onboarding 连接快照；两张卡改为**受控**（status 经 props 下传，不再各自 fetch），变更后调 `onChanged()` 冒泡 → 父组件重查 → 重新分桶。

- 为何不在父组件"另 fetch 一份只为分桶"：会出现两份真相、IPC 翻倍、登录后父组件不知道要重新分桶（违 P1）。
- 受控化后：单次 fetch、登录/退出后 `onChanged` 触发父组件重查、分桶自然跟随。

### 4.2 重排不重挂（保 OAuth 流不丢态）

即梦卡登录中（设备码轮询）属于"未接入→可接入组内"。连接状态翻转只发生在**登录成功的那一刻**（流程已结束），此时卡从「可接入」移到「已接入」会 remount——**可接受**（流程已完成，无进行中态可丢）。真正危险的"流程中 remount"不会发生，因为流程中 status 仍是未连通、卡留在原组。验收门里要**真机复跑即梦登录流**确认无回归。

### 4.3 折叠组件（方案2）

新增一个轻量「可折叠组」外壳 `AvailableGroup`（或直接复用模式）：组头（标题 + 数量徽 + chevron）+ 受控 `expanded`。与现有 `FoldableModelCard`（单卡折叠）区分：这是**组级**折叠，body 里塞多张卡。

- 自适应默认：`expanded` 初值 = `首组 && 无已接入项`。
- 计数 = 该组未接入项数（derive）。

### 4.4 派生分桶（derive 不 hardcode）

父组件算一份 `entries`：每条 `{ kind: 'vendor'|'dreamina'|'assistant', connected: boolean, render: ReactNode }`。

- 已接入段 = `entries.filter(connected)`，扁平排。
- 可接入段 = 按原分组归 `entries.filter(!connected)`，每组一个 `AvailableGroup`。
- 顺序、计数、段是否出现，全 derive，无写死。

## 5. 改动文件

| 文件 | 改动 |
|---|---|
| `src/ui/onboarding/OnboardingDrawer.tsx` | 重排为「能力条 + 已接入段 + 可接入段(方案2分组折叠)」；上提即梦/编程助手连接状态；派生分桶 + 自适应默认 |
| `src/ui/onboarding/DreaminaMemberCard.tsx` | 受控化：status 经 props 下传（父 fetch），变更走 `onChanged`；移除/收口内部独立 fetch（单一来源）|
| `src/ui/onboarding/ConnectAssistantCard.tsx` | 受控化：`mcpInfo` 经 props 下传，install/uninstall 后走 `onChanged` |
| `src/ui/onboarding/AvailableGroup.tsx`（新）| 组级折叠外壳（标题+数量+chevron+受控 expanded），≤120 行 |

`VendorOnboardCard` / `FoldableModelCard` / `ModelChipGroups`：**不改**（复用）。
若 `OnboardingDrawer` 逼近体量上限再抽 `partitionOnboarding` 纯函数；预计仍远低于 800 行（R9）。

## 6. 不动项（明确不碰，防范围膨胀）

- 后端 `electron/catalog/*`、`seedBuiltins.ts`、所有 IPC：**一行不碰**。
- 三套 vendor 名单（`KNOWN_VENDORS` / `PROVIDER_PRESETS` / seed）：**不合并、不去重**（那是另一个治本议题，本期只重排呈现）。
- `OnboardingWizard`（添加模型/中转站模态）：不改，仍挂在「接入生成模型」组内的添加按钮。
- 不做"可搜索选择器"、不做"四类重分类"——已被用户否决。
- 软推荐微标：本期不做（§8）。

## 7. 回滚

纯前端、改动集中在 4 个文件。回滚 = `git revert` 该 commit（或还原这 4 文件）。无数据迁移、无后端、无持久化结构变更，零存量风险。

## 8. 后续（不在本期）

- 聚合中转「新手推荐」软提示微标。
- 三套 vendor 名单单一来源合并（治本，碰 seed，单独 plan + 单独验）。

## 9. 验收门（报完成前必过，P3/R11/R13）

**五门**：`pnpm run gates`（filesize→tokens→lint→typecheck→test→build）全绿。

**R13 真机走查（Playwright 截图人眼判断，非 expect）**：
1. **新用户空态**：零已接入 → 无「已接入」段；「可接入」首组（接入生成模型）默认展开，其余收起。
2. **已接 1 家**（填一个 vendor key）→ 该卡浮到「已接入」段；「可接入」各组默认收起；能力条对应点亮。
3. **即梦登录流不回归**：走查设备码登录流程（发起→轮询态→取消），确认受控化后流程态不丢、登录成功后卡移入「已接入」。
4. **编程助手 install 不回归**：一键接入/撤销后状态正确、分桶跟随。
5. **分组折叠**：点组头展开/收起，数量徽正确。
6. **暗色**：天黑自动暗下两段 + 折叠组头 token 正常翻转。
7. 与样张 `model_onboarding_connected_vs_available_split` + `onboarding_fold_variants_compare`（方案2 列）逐项对账。
