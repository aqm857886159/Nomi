# 审片未校验单镜与多镜行内短文案收口统一（`ReconcileDeviationCard`）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

改动名：`ReconcileDeviationCard` 未校验行内按钮短文案统一并删除重复词条  
实现线：`k-qa-copy-impl`  
验收线：`k-qa-copy-verify`  
类别：`[新界面][其他]`（在 `#1630` 已合入双图基础上的轻量行内按钮文案收口统一）

## ★0 先查别人

- `docs/engineering/direction-checks/2026-11-22-qa-verdict-honesty.md:1` 与 `src/workbench/generationCanvas/components/ReconcileDeviationCard.tsx:378` · `#1630` 在多镜未校验行与混合偏差行已经采用紧凑双动作 `recheckShort` / `acceptShort`（`重审` / `照用`、`Re-check` / `Use`），仅在纯未校验单镜分支多写了一套 `recheckOne` / `acceptOne`（`重新审片` / `照用此镜`、`Re-check` / `Use shot`） · **改了** `ReconcileDeviationCard.tsx:266`：去掉 `isMultiUnverified` 文案与内边距分叉，单镜行与多镜行统一使用 `recheckShort` / `acceptShort`，同提交删除 `recheckOne` / `acceptOne`。
- `docs/design/nomi-design-system.md:1`（§1.8 控件文案契约，`scripts/check-control-contract.mjs:1`） · 行内操作按钮以最精炼动词表达确定动作，同一动作在单行与多行列表内保持同一名字，不让创作者为同一件事认两套标签 · **确认了**将行内单镜动作统一收口为 2 字 / 1 词短文案（`重审 / 照用`、`Re-check / Use`），而底栏整卡批量动作保留 `全部重审 / 照用这 N 镜`（`Re-check all / Use all N`）以明确区分单行与整批范围。
- `https://primer.style/product/ui-patterns/button-usage/` · GitHub Primer 按钮文案规范要求列表行级重复动作使用同一简短动词（如 `Retry` / `Use`），仅在批量汇总栏加范围限定词（`Retry all` / `Use all N`），避免单行态与多行态切换时按钮宽度跳变 · **确认了**单镜行同步采用 `px-2.5` 与短词条，给左侧镜头标题留出更宽的单行可读空间。
- 出口：`src/workbench/generationCanvas/components/ReconcileDeviationCard.tsx:265` · 未校验镜头仍提供「`重审`（重跑单镜审片，在途防重转圈）」与「`照用`（立即解除未校验提示、继续创作）」两条原样出口，多镜额外保留底栏「`全部重审` / `照用这 N 镜`」 · **确认了**本次仅收口按钮文案与冗余 i18n 键，不新增、不扩大任何挡人保护。

## ★1 用户怎么用

- **用户故事**：当创作者在生成画布完成 1 镜或多镜生成、但审片未完成（`unverified`）时，画布右侧 Nomi 面板内的未校验卡在每一镜行尾都一致呈现简短清晰的「`重审` / `照用`」（英文 `Re-check` / `Use`），不再出现 1 镜叫「`重新审片` / `照用此镜`」、2 镜以上突然改名叫「`重审` / `照用`」的分裂体验。
- **操作步骤（5 步）**：
  1. 在生成画布完成 1 镜生成，若视觉审片未完成，Nomi 面板出现 `1 镜没审成，不代表已通过  查看原因`；
  2. 看到镜头行右侧紧凑排列 `重审` 与 `照用`（英文 `Re-check` / `Use`），长镜头标题获得更充足的展示宽度；
  3. 点击 `查看原因` 按需查看白话原因，或点击 `重审` 仅重跑该镜审片；
  4. 点击 `照用` 立即采纳当前画面并收起卡片；
  5. 当一次存在多镜未校验时，每行依然是同样的 `重审` / `照用`，底栏额外给出 `全部重审` / `照用这 N 镜` 区分整卡动作。
- **不做什么 + 已知坑**：不改 `shotVerifyStore` 动作语义、不改多镜底栏批量按钮文案（`全部重审 / 照用这 N 镜`、`Re-check all / Use all N` 保留）、不在测试文件里硬抄中英文词典字面量（遵守 `check-test-copy-literals.mjs`）。
- **真实任务与指标量具**：
  1. 单镜未校验卡中英双语亮暗四态渲染：目标「单镜与多镜行内动作命名 100% 一致且零冗余键」→ 信号「单镜行渲染 `recheckShort` / `acceptShort` 且 `recheckOne` / `acceptOne` 已删除」→ 指标「单测与真窗口四态核验通过率 100%」，量具：`src/workbench/ai/resident/useShotVerifyFeedback.test.ts`、`pnpm run check:i18n`。
  2. 控件文案长度与契约护栏：目标「行内按钮紧凑不撑爆」→ 信号「中文 2 字、英文 1–2 词」→ 指标「控件契约违规 0 新增」，量具：`pnpm run check:controls`。
- **★1b 连带界面**：仅收口 `ReconcileDeviationCard` 未校验单镜行内两颗按钮文案；`ProductionDetails` 任务中心进度、Agent 工具回执、通知与错误卡均无变化。
- **★1c 老用户**：不适用：纯前端界面词条收口删除（`generationCommon.reconcile.recheckOne` / `acceptOne` 从未落盘到项目文件或用户配置），老项目打开即显示统一短文案。

## ★2 谁说了算

- **唯一概念与主人**：审片三态结论归 `production.qa-verdict`（`docs/engineering/concept-owners/production.qa-verdict.json`），对账未校验卡片渲染归唯一组件 `src/workbench/generationCanvas/components/ReconcileDeviationCard.tsx`，词条归唯一命名空间 `src/i18n/locales/generationCommon.ts`（`reconcile.recheckShort` / `reconcile.acceptShort`）。
- **门表核对（`git grep recheckOne|acceptOne`）**：全仓仅 `generationCommon.ts`（中英各 2 行定义）、`ReconcileDeviationCard.tsx`（2 处三元分支）与 `useShotVerifyFeedback.test.ts`（2 行断言）引用；删除 `recheckOne` / `acceptOne` 后，行级未校验动作在全仓只剩 `recheckShort` / `acceptShort` 唯一一对键，由 `check-i18n-key-parity.ts` 与 `check-i18n-key-refs.ts` 机器守住。

## ★3 一致与复用

- **前序拍板与选路**：复用 `#1630` 已上线的行内短词条 `generationCommon.reconcile.recheckShort` / `acceptShort` 与紧凑按钮样式 `shrink-0 px-2.5`，按 P1「加新必删旧」同提交删掉单镜特例三元分支与 `recheckOne` / `acceptOne` 两个重复词条（词条总数 `-2`）。

## ★4 全状态

- **默认收起态（单镜未校验）**：顶栏 `1 镜没审成，不代表已通过  查看原因`，行内 `<镜头名>  [重审] [照用]`（英文 `1 shot not checked, not confirmed as passing  Why` + `<Shot>  [Re-check] [Use]`），无底栏批量区。
- **展开原因态**：点击 `查看原因 / Why` 后在镜头行下方展示创作者白话原因，行内按钮保持 `[重审] [照用]`。
- **重审加载态（`retryingVerify=true`）**：所点 `重审 / Re-check` 按钮显示品牌转圈并禁用同行按钮防重。
- **多镜未校验态（`count > 1`）**：每行仍为 `[重审] [照用]`，底栏右对齐显示 `[全部重审] [照用这 N 镜]`（`[Re-check all] [Use all N]`）。
- **空 / 全部通过 / 已照用态**：卡片不渲染（`null`）。
- **能力不可用态**：当当前文本模型不支持看图审片（`vision_unavailable`）时，展开原因显示 `当前模型不支持看图审片` / `Current model cannot inspect images`，创作者可直接点行内 `照用 / Use` 继续流程，或在面板底栏切换支持视觉的模型后点 `重审 / Re-check`；界面文案不涉及任何计费断言（`check:i18n` 通过）。
- **超长标题边界**：镜头标题设 `min-w-0 flex-1 truncate`，按钮 `shrink-0 px-2.5`，文案从 4 字缩为 2 字（英文 `Use shot` → `Use`）后给标题再多让出约 `24px` 宽度。

## 5 中途表

| 状态 \ 打断 | 用户停手 | 关窗 | 断网 | 重启 | 连点按钮 |
|---|---|---|---|---|---|
| 单镜未校验待决态 | 卡片静默保持，不自动消散 · 不扣费 · 面板原位可见 | 正常关窗 · 不扣费 · 无额外回执 | 本地点击「照用」照常生效 · 不扣费 · 卡片收起 | 会话级提示重置，原镜头产物完好 · 不扣费 · 画布节点可见 | 「照用」幂等移除该镜；「重审」置 `retryingVerify` 立即禁用防重 · 不扣生图费 · 按钮转圈反馈 |

## 6 外部数据与失败

- 不新增外部数据源；审片失败原因枚举仍由 `formatQaUnverifiedReason`（`src/workbench/generationCanvas/agent/shotVerify.ts`）统一映射为 5 条中英白话词条。

## ★7 性能

- 不适用：仅删除 `ReconcileDeviationCard.tsx` 1 个布尔三元分支与 `generationCommon.ts` 2 个冗余词条 key，零新增状态订阅、零新增 DOM 节点或布局计算。

## 8 真实条件

- [x] macOS 真隔离 Electron 窗口单镜未校验态中英 × 亮暗 4 张实拍截图 + `before-vs-after.png` 对照图（`docs/evidence/2026-11-24-k-qa-short-copy/`，全部亲眼 `read_file` 核验）
- [ ] Windows 真机：`unverified`（纯 i18n 短文案收口，无平台差异逻辑）
- [ ] 真付费：不适用（不涉及计费或生图请求改动）

## 拍板图清单

- 在 `#1630` 用户已批双图（单镜未校验 + 多镜未校验，`docs/evidence/2026-11-22-qa-verdict-honesty/`）基础上的单元素行内按钮短文案收口统一（PR 正文认领 `single-element-restyle` 例外并附 `before-vs-after.png` 对照）。

## ★9 验收与回滚

- **动手前写定的验收清单与反例**：
  1. **正例 1（单镜中英双语短文案一致）**：`useShotVerifyFeedback.test.ts` 在 `zh-CN` 与 `en` 下断言单镜未校验卡渲染 `>重审<` / `>照用<` 与 `>Re-check<` / `>Use<`，且不含 `data-reconcile-unverified-batch`。
  2. **正例 2（冗余旧键彻底删除）**：`i18n.exists('generationCommon.reconcile.recheckOne') === false` 且 `acceptOne === false`，生产代码 `git grep -E "recheckOne|acceptOne" src/ -- ':!*.test.ts'` 为空。
  3. **反例 1（单镜误出底栏批量按钮）**：若把 `isMultiUnverified` 错改成 `unverified.length >= 1` → `useShotVerifyFeedback.test.ts` 单镜 `not.toContain('data-reconcile-unverified-batch="true"')` 立即变红。
  4. **反例 2（行内按钮退回旧键或漏译）**：若组件仍引用已删的 `recheckOne` → `check-i18n-key-refs.ts` 与 `useShotVerifyFeedback.test.ts` 双双变红。
- **门岗命令**：
  - `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit`
  - `./node_modules/.bin/tsc -p electron/tsconfig.json --noEmit`
  - `node scripts/check-test-types.mjs`
  - `./node_modules/.bin/vitest run --maxWorkers=2 src/workbench/ai/resident/useShotVerifyFeedback.test.ts src/workbench/generationCanvas/agent/shotVerifyStore.test.ts src/workbench/generationCanvas/agent/shotVerify.test.ts src/workbench/production/ProductionRunTaskCard.test.ts`
  - `pnpm run check:i18n`（含 `check-test-copy-literals.mjs`）
  - `pnpm run check:controls`
  - `pnpm run check:tokens`
  - `node scripts/check-design-lab.mjs --mirrors-only`
  - `pnpm run check:filesize`
  - `NOMI_BASE_REF=origin/main node scripts/lint-changed.mjs`
- **回滚**：`git revert <merge-sha>` 即可独立回退。

### 功能分类
- [x] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [x] Agent 行为
- [x] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [x] 新增功能 / 性能
