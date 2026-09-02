# 走查隔离 catalog seed 版本一致性

状态：✅ 已实现并验证（2026-09-02，随 PR #336 交付；先红后绿复现 + 真实 Electron 探针 + 24/24 测试）

## 范围

- 在共享 Electron 走查启动边界识别并隔离高于被测构建的 `model-catalog.json`。
- 让 `evals/lib/isoApp.mjs` 的 `prepareIsolation` 复用同一规则，并把 `NOMI_CAPABILITY_DIR` 纳入隔离返回/启动环境。
- 用测试证明 future seed 被隔离、当前/旧 seed 仍可进入迁移链；提供最小复现的修前红/修后绿证据。

## 不动项

- 不修改 `electron/catalog/catalogStore.ts` 的高版本只读保护。
- 不抬高 `CURRENT_CATALOG_VERSION`，不把 catalog 的版本号重写成猜测值。
- 不改真实用户 catalog，不改变付费/真实模型走查的凭据语义。

## 验收门

1. 一个版本高于被测构建的隔离 seed 不会进入 app；文件被移到隔离目录内的可追溯 quarantine 名称，app 首启自建当前版本 catalog。
2. 当前版本和低版本 seed 不被误伤，低版本仍可由 app 迁移。
3. 所有通过 `launchNomiApp` 和 `prepareIsolation` 的入口共享该边界；能力核使用独立 `NOMI_CAPABILITY_DIR`。
4. 相关单测、`pnpm run check:root-cause-contracts`、typecheck 和最小复现通过。

## 回滚

删除本计划所列新增 helper/测试/合同并恢复启动器调用；quarantine 文件只在调用者提供的隔离目录内生成，可手动恢复，不触碰真实用户目录。
