结论：通过 · 验收线：fc1-verify · 验收 HEAD：aaf4c978632db0fe840d9d67f2aee5fa65e4cb19

- 验收线：`fc1-verify`
- 实现线：`fc-declared-provider-and-wan-handles`
- 对应设计卡：`docs/plan/2026-11-24-fc-declared-provider-and-wan-handles.md`
- 对应根因合同：`docs/fixes/2026-11-24-fc-declared-provider-and-wan-handles.root-cause.json`

## 1. 范围、隔离边界与隐私核查

- **改动范围（`origin/main...ca6be3e8ba597db6b67d4f4f11354770faa17995`，20 个文件）**：
  - **`#975` G1（免密声明适配器正式生成就绪）**：`electron/capabilityCore/generationProviderBootstrap.ts` 与 `apimartGenerationProvider.ts` 统一复用目录凭据健康判据（放行 `authType: "none"` 且不发多余 `Authorization` 头）。
  - **`#975` G2（`inline-base64` 参考素材正式生成交付）**：新增单一共享交付判据 `electron/capabilityCore/generationProviderReferenceValue.ts`，由 `productionReferenceUrls.ts`（封存与重算）与 `apimartGenerationProjection.ts`（请求投影）共同消费；保留 20 MiB 上限与损坏/非媒体/未声明通道拒收。
  - **`NF-1119-0001`（通义万相 `wan-3.0 / wan-2.7-r2v` 句柄与变体解析）**：`electron/shared/agentCapabilities/modelHandle.ts` 通过 `wireSelectionFor` 统一查档案声明的 `variants`（限基线行解析）与 `modes`（`mode.modelEnum`），并经 `generationPlanPatch.ts`、`semanticGenerationCandidate.ts`、`draftShotsProjection.ts`、`wan27Image.ts`、`wan30Apimart.ts` 贯穿规划与投影；家族短名仅给启用目录候选，不替创作者私选付费档。
- **并行零冲突**：全部 20 个改动文件位于 `electron/capabilityCore/`、`electron/shared/`、`docs/plan/`、`docs/fixes/`，与挂起中的 `#1617` 零文件重叠。
- **隐私与路径泄露核查**：`git diff origin/main...HEAD` 全部改动及本验收单均含 `0` 处本机绝对路径、临时目录路径或工作树前缀泄露；全程未触发真实外部付费请求。

## 2. 定向门岗与单测独立实跑（全部 `EXIT=0`）

| 检查项 | 结果 | 关键摘要 |
|---|---|---|
| `pnpm run check:filesize` | PASS | 全部文件在行数红线/棘轮内（`apimartGenerationProvider.ts` 瘦身至 822 行） |
| `pnpm run check:root-cause-contracts` | PASS | `55/55` 单测与 schema 校验通过 |
| `pnpm run check:self-written` | PASS | 177 领域目录 · 68 项登记 · 新增代码文件 1 个（`0` 未认领） |
| `pnpm run check:boundary-owners` | PASS | `27/27` 自测通过，声明 2158 条全部在位/已登记 |
| `pnpm run check:model-availability` | PASS | 单测与全仓可用性边界扫描全绿 |
| `pnpm run check:model-identity` | PASS | 档案与目录模型身份自解析全绿 |
| `NOMI_BASE_REF=origin/main node scripts/lint-changed.mjs` | PASS | 改动文件 `0` 错误 |
| `./node_modules/.bin/tsc -p electron/tsconfig.json --noEmit` | PASS | `0` 类型错误 |
| `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit` | PASS | `0` 类型错误 |

6 套核心 Vitest 套件（`VITEST_MAX_WORKERS=2`）独立实跑合计 **151/151 PASS（`EXIT=0`）**：
- `electron/capabilityCore/modelOnboarding/declaredProviderProduction.test.ts`（7/7：含 `image_to_video` 与 `image_edit` 免密内联参考回环全链路）
- `electron/capabilityCore/productionReferenceUrls.test.ts`（27/27）
- `electron/capabilityCore/generationProviderBootstrap.test.ts`（24/24）
- `electron/capabilityCore/modelNameModeParity.test.ts`（58/58）
- `electron/shared/agentCapabilities/modelHandle.test.ts`（25/25）
- `electron/shared/agentCapabilities/modelHandle.structure.test.ts`（10/10）

### 门岗收尾增量复验（`ca6be3e8b..aaf4c9786`，全部 `EXIT=0`）
- 审阅 3 处收尾改动：`electron/shared/agentCapabilities/modelHandle.test.ts:149` 补 `vendorKey: null` 消除 `TS2345`、新增逃逸账本结账记录 `tests/ux/full-walk/escapeLedger/USER-20261124-fc-declared-provider-and-wan-handles.json`、`docs/plan/2026-11-24-fc-declared-provider-and-wan-handles.md` 补全出口路径引用；增量 diff `0` 本机路径泄露。
- 独立实跑全绿（`EXIT=0`）：
  - `VITEST_MAX_WORKERS=2 npx vitest run electron/shared/agentCapabilities/modelHandle.test.ts`：PASS（25/25）
  - `pnpm run check:escape-ledger`：PASS（174 条校验通过，含新增 `USER-20261124-fc-declared-provider-and-wan-handles` `status: "fixed"`）
  - `pnpm run check:test-types`：PASS（6/6 单测 + `agent-runtime` 0 错 + `src/` 0 错，存量 10 条棘轮零增长）

## 3. ★9 真实故障变异验证（3/3 运行时必红 → 还原 32/32 必绿）

在隔离验收工作树中分别注入 3 处运行时故障变异（非语法错误），均当场触发精准测试失败，随后 `git checkout --` 彻底复原：

| 编号 | 破坏目标与注入方式 | 运行时红灯结果 | 还原验证 |
|---|---|---|---|
| M1 | `electron/capabilityCore/productionReferenceUrls.ts:50`：将交付校验退回仅收 `/^https?:\/\//`，拒收 `data:image/png;base64,...` | `EXIT=1`：`declaredProviderProduction.test.ts` **2/7 失败**（`image_to_video` 与 `image_edit` 免密内联参考均抛 `generation_reference_url_unavailable`） | `git checkout --` 后复跑 **7/7 PASS** |
| M2a | `electron/shared/agentCapabilities/modelHandle.ts:105`：屏蔽 `profile.modes` 线上 `modelEnum` 查表 | `EXIT=1`：`modelHandle.test.ts` **4/25 失败**（`wan2.7-r2v`、`wan-2.7-r2v`、`wan2.7-r2v@apimart` 与跨商唯一性均跌为 `unknown`） | `git checkout --` 后复跑 **25/25 PASS** |
| M2b | `electron/shared/agentCapabilities/modelHandle.ts:102-104`：屏蔽 `profile.variants` 档案变体查表 | `EXIT=1`：`modelHandle.test.ts` **2/25 失败**（`preserves a separately declared archetype variant` 对 `wan/3-0-video@kie` `prime` 返回 `ok: false`） | `git checkout --` 后复跑 **25/25 PASS** |

## 4. 诚实未验证边界

- 本次验证均在 macOS 本机 Node 回环与项目夹具环境下完成；原报告中的 Windows 客户端环境、真实第三方线上服务商账号及真实付费生成链路记为 `unverified`。
