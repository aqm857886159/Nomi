# 目录只读态可观测化 —— 让走查假绿与产品哑控件同时消失

> 状态：✅ 已交付（三处边界改动 + 类级回归 + 真机带阳性对照核验；残余风险见文末，未声称已闭合）
>
> 2026-09-01。纪律说明：R4 要求多文件改动**先**写本文档，本次是**边查边改、事后补记**——顺序上没守住，记在这里不粉饰。
> 根因合同（R21）：`docs/fixes/2026-09-01-catalog-read-only-silent-in-walkthroughs.root-cause.json`。

## 一句话

`writeCatalog` 的高版本 fail-closed 守卫是**对的**，问题是「目录现在只读」这件事**只以异常的形式存在**——
谁都得先尝试写一次、catch 到、才知道。于是不 catch 的地方静默退化，catch 的地方把主进程英文
`Error.message` 原样甩给用户。本次把这个状态**在它产生的地方变成结构化数据**，两类消费者各自炸响。

## 症状与真实机制（别照抄报障时的因果链）

报障描述是「目录只读 → 切换节点模型不生效」。实际链条要多一环，值得写清楚，否则下一个人会去错的地方找：

1. `evals/lib/isoApp.mjs:33` `prepareIsolation` 把用户**真实档案**的 `model-catalog.json` 整份拷进隔离 profile。
2. 种子的 schema 版本 = 用户真实档案的版本（现在 v12），与**被测构建**的 `CURRENT_CATALOG_VERSION` 完全解耦。
   这台机器二十几个 worktree 各在不同版本，而真实档案总被最新的那个升上去 → 偏移是常态，不是意外。
3. 种子比构建新 → `electron/catalog/catalogStore.ts` `writeCatalog` 拒绝一切写回（防静默降级，**行为正确**）。
4. 走查往目录里**播种**的 `upsertVendorApiKey` / `upsertModel` / `upsertVendor` 全部失败
   （如 `tests/ux/canvas-control-clarity.walk.mjs:173`、`tests/ux/archetype-modebar.e2e.mjs:109`）。
5. 于是模型压根没进目录 → 模型选择器没有对应选项 → 「切换节点模型」点了没有可选项 → 节点保持原样。

注意第 5 步：节点切模型这个动作**本身不写 catalog**
（`InlineParameterBar` → `useDedupedModelSelect` → `NodeParameterControls` → `canvasNodeActions.updateNode`，
只改 project/node 状态）。它是被上游**播种失败**饿死的。修的是上游，不是这条链。

## 改了什么（三个共享边界，各修一层）

| 边界 | 文件 | 职责 |
|---|---|---|
| 状态产生处 | `electron/catalog/catalogHealth.ts` | health 新增 `writable` / `diskVersion` / `appVersion` 与 `catalog_read_only_version_skew` issue。只读从「异常」变成「可读状态」 |
| 产品消费处 | `src/config/modelCatalogStatus.ts` | 新增 `catalog_read_only` 状态，**排在所有其他判定之前**；文案走 i18n（`runtime.modelCatalog.readOnlyVersionSkew`，zh-CN + en） |
| 走查消费处 | `tests/ux/_launchApp.mjs` | `assertCatalogWritable`，由 `launchNomiApp` 在交出窗口前调用；命中即关 app 抛错 |

配套类型：`src/workbench/api/modelCatalogApi.ts`（DTO + issue code union）。

**为什么只读要排在 `catalog_empty` / `incomplete` 前面**：目录写不进去时，「空」「不完整」「没有某类模型」
全是它的**下游表现**。报那些会把用户引去「再配一次」——而配了也存不上，是最坏的误导。

**为什么不逐个 call site 加 catch**：2026-08-31 的合同（`docs/fixes/2026-08-31-codex-local-toggle-version-skew...`）
就是这么做的——分类写了 `recurring`、`kind` 写了 `centralized-boundary`，但 `enforcement_path` 是**单个 React 组件**。
结果这次从另一个入口原样复发。实测渲染层约一半的 catalog 写入点根本没有 catch
（`src/api/desktopClient.ts` 的七个导出、`AddComfyuiInstanceButton.tsx`、`antigravityCardModel.ts`、
`ComfyuiWorkflowSettingsPage.tsx`），逐点加 catch 关不住这个类。

## 不动的东西

- **`writeCatalog` 的守卫一行不改。** 缺陷从来不是「它拒绝写」，而是「拒绝得没人看得见」。放松它 = 重新引入静默降级。
- `prepareIsolation` 默认仍拷真实档案。本次只让偏移**变响**，没有消除偏移本身（见下）。
- 2026-08-31 在 `CodexLocalImageCard.tsx` 加的 catch 保留，作为普通局部错误处理，不是新边界的重复实现。

## 验收门（已跑）

- `electron/catalog/catalogReadOnly.test.ts` — health 必须报出结构化只读 issue 并带两个版本号；可写时不误伤。
- `src/config/modelCatalogStatus.test.ts` — 报 `catalog_read_only` 而非 `incomplete`；文案带版本号、含「更新」、
  **不含** `refusing to write`；只读判定压过 `catalog_empty`。
- `tests/ux/_launchApp.test.mjs` — 偏移必抛且报错说得清出路；可写/无关 issue/读不到 bridge 均放行（不造假红）。
- **真机核验（带阳性对照）**：真起 Electron，v99 种子 → 抛错中止；v12 同版本种子 → 照常放行。两边都实跑过。

## 回滚

三处改动互相独立，可单独 revert：
- 只回滚 `tests/ux/_launchApp.mjs` → 走查恢复到「带只读目录静默跑完」（即本次要修掉的假绿）。
- 只回滚 `src/config/modelCatalogStatus.ts` + locale → 产品恢复到泛化 `incomplete` 文案。
- 回滚 `catalogHealth.ts` 需连同上面两处一起回（它们读它新增的字段）。

## 已登记的残余风险（不算完成的部分）

1. `assertCatalogWritable` 读不到 bridge 时**放行**（不制造假红）。读不到 ≠ 只读，但确实留了一条不设防的缝。
2. `waitForWindow: false` 的主进程脚本（如 `evals/verify-shot-smoke.mjs`）没有渲染层可问，不受闸门保护；
   它们也不做模型选择器断言——但这是**看代码看出来的**，没有测试钉住。
3. 偏移本身仍在：把剩余「拷真实档案当种子」的走查改成合成 catalog 是后续工作，本次不声称已做。
4. 产品侧只读文案由单测证明，**没有在真实偏移构建上肉眼看过**——要复现得跑一个
   `CURRENT_CATALOG_VERSION` 低于真实档案的构建。这条按 P3 明说：不算「走查过」。
