# 代码库梳理 2026-05-30

> Status: 待执行
> Total code: 38k LoC (src + electron, excluding node_modules)
> 范围：删冗余 + 合并归档 + 未来优化点

## A. 立即可删/可合并（无需讨论）

| 类目 | 现状 | 动作 | 影响 |
|---|---|---|---|
| `RELEASE_NOTES_v0.6-0.7.9.md` × 12 | 12 个发布说明散在根目录 | `mv -> docs/release-notes/` | 根目录清爽 -12 文件 |
| `docs/plans/` (2 文件) | 与 `docs/plan/` 撞名 | `mv 内容到 docs/plan/`，删 `plans/` | 消除歧义 |
| `docs/onboarding-trials/2026-05-28T14-14~24` × 14 dir | 早期 Kimi 调试时的崩溃 trial（`rounds: 0`） | 删除 | -14 dirs，~5MB |
| `src/workbench/feedback/showUndoToast.ts` (单文件) | 1 个文件的目录 | `mv -> src/utils/showUndoToast.ts`，删空目录 | 结构紧凑 |
| `src/workbench/nomi/NomiAppBar.tsx` (单文件) | 1 个文件的目录 | `mv -> src/ui/app-shell/NomiAppBar.tsx`（与 design 体系靠拢） | 入口找得到 |

执行命令一次性给：

```bash
# release notes
mkdir -p docs/release-notes && git mv RELEASE_NOTES_*.md docs/release-notes/

# plans -> plan
git mv docs/plans/* docs/plan/ && rmdir docs/plans

# 早期失败 trial（保留 attack-A/B/C + kling-3-0 成功 + m4-retest + m5-install）
rm -rf docs/onboarding-trials/2026-05-28T14-{14,15,17,18,19,23,24,36}-*-gpt-image-2-text-to

# 单文件目录归位
git mv src/workbench/feedback/showUndoToast.ts src/utils/
rmdir src/workbench/feedback
mkdir -p src/ui/app-shell
git mv src/workbench/nomi/NomiAppBar.tsx src/ui/app-shell/
rmdir src/workbench/nomi
# 然后 grep 修引用路径
```

## B. 结构性重构（需要计划 + 1-2 天）

### B1. 拆 `electron/runtime.ts`（2,687 行）

这是项目最大的单文件，6 个职责挤一起：

```
runtime.ts (2687)
├── 项目存储 / 资产 / cost     → electron/storage/{projects,assets,cost}.ts
├── 模型 catalog (CRUD + 迁移) → electron/catalog/{schema,store,migrate,encrypt}.ts
├── catalog 导入导出           → electron/catalog/portable.ts
├── 任务执行 / 厂商调用         → electron/tasks/{runner,providers,template}.ts
├── 文档抓取 (catalog 用)       → electron/catalog/docsFetcher.ts
└── runtime.ts 只剩 re-export 兼容旧引用
```

收益：
- catalog 部分本来就该和 `electron/ai/onboarding/` 同源（共享 `Vendor/Model/Mapping` 类型）
- 每个新模块 < 500 行，可测试
- `commitOnboardedModelToCatalog` 应该住进 `catalog/store.ts`

### B2. ModelCatalog 旧管理 UI 砍掉一半

`src/ui/stats/system/modelCatalog/` 共 **3,193 行**：

| 文件 | 行 | v0.8 之后是否还需要 |
|---|---|---|
| `StatsModelCatalogManagement.tsx` | 819 | 砍：保留 list + 删除入口，编辑全走 wizard |
| `ModelCatalogVendorsSection.tsx` | 178 | 保留（厂商表） |
| `ModelCatalogModelsSection.tsx` | 223 | 保留（模型表） |
| `ModelCatalogMappingsSection.tsx` | 386 | **可砍**：mapping 由 wizard 生成，专家才编辑 |
| `ModelCatalogImportSection.tsx` | 634 | 缩到 ~200（保留导入文件，去掉抓 docs 那段——已被 onboarding agent 取代） |
| `modals/VendorEditModal.tsx` | 151 | 保留（专家逃生口） |
| `modals/ModelEditModal.tsx` | 392 | 保留 |
| `modals/MappingEditModal.tsx` | 231 | 保留（专家逃生口） |
| `modals/VendorApiKeyModal.tsx` | 116 | 砍：合并入 wizard 流程 |

预期：3,193 → ~1,800 行，**-44%**。这是 v0.8 M8 的"砍旧 UI"工作。

### B3. `electron/runtime.ts` 里的 `getModelCatalogHealth`

是个把厂商/模型/key 状态混算的大函数。v0.8 后健康检查应改为：
- per-model: `ready / needs-key / needs-test / disabled`
- 不再返回大对象，按 model 渲染
- 可以让 onboarding agent 在 "test" 步直接更新

## C. 跨子系统冗余 / 一致性问题

| 问题 | 文件 | 建议 |
|---|---|---|
| `BillingModelKind` 没 `audio` | `electron/runtime.ts:38` + `src/api/server.ts` | 加上 `"audio"`，让 onboarding agent 能完整流转音频模型 |
| `ProfileKind` 不含音频 task | `electron/runtime.ts:39` | 加 `text_to_audio`, `image_to_audio` |
| onboarding `ModelKind` ≠ runtime `BillingModelKind` | 各自一份 | 共享同一 union，导出到 `electron/types/modelKinds.ts` |
| `RELEASE_NOTES_v0.7.x` 手写 + git tag 没自动化 | 根目录 | 加 `scripts/release.mjs`：从 `package.json` 版本 + git log 自动生成 |
| `docs/plan` 和 `docs/plans` 风格混乱 | 见 A | 统一 |

## D. 未来 6 个月的优化点（按 ROI 排）

| # | 优化 | 估计成本 | 价值 |
|---|---|---|---|
| 1 | onboarding agent 加 `set_model_kind` 工具 + 让 wizard 真正不要求 kind | 2h | 体验闭环（草稿就是这样画的） |
| 2 | `BillingModelKind` 加 `audio` + 端到端音频流 | 1d | 解锁配音 / TTS 模型，市场敏感品类 |
| 3 | `electron/runtime.ts` 拆 6 模块（B1） | 1d | 维护 + 测试可达性 |
| 4 | 砍旧 modelCatalog UI（B2） | 0.5d | UI 负债 -44% |
| 5 | onboarding fixtures 库扩到 15-20 个（v0.8 M4 原计划） | 0.5d / 个 | 回归保护新厂商；营销时可放 "已支持 N 家" 数字 |
| 6 | catalog 备份 / 还原 UI | 0.5d | 用户换电脑 / 误删能恢复，降低客服 |
| 7 | onboarding agent config 设置面板 | 0.5d | 把 env vars 替成 UI |
| 8 | 节点级 "本模型能不能跑" 即时校验 | 1d | 避免用户在节点上看到不可用模型 |
| 9 | model usage 统计（哪些常用 / 哪些躺尸） | 0.5d | 引导后续 fixture 优先级 |
| 10 | onboarding trial 完成可一键 "再添加这个模型的另一个 endpoint" | 0.5d | 多端点厂商（kie.ai 风格）体验提升 |

## E. 不动的部分

明确不动：
- `src/design/` — 设计系统是项目护城河，结构已稳
- `src/workbench/generationCanvas/` — 大块但内部分得清楚（model / nodes / store / runner / agent / components），别为了"看着乱"重构
- `electron/ai/onboarding/` — v0.8 新建的，干净
- `electron/export/` — 25 个文件听起来多，但导出流程客观就这么多步骤
