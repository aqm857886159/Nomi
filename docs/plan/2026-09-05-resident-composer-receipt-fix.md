# Resident Composer 收据旅程修复

> 状态：✅ 已交付 · 日期：2026-09-05 · PR #507（合并进 main）

## 范围

- 跟随合并后的 Agent UI A 设计，删除旅程对模式弹层审批入口的依赖。
- 用 `nomi_start_generation`（`spend` effectClass）验证默认安全自动模式下的真实审批卡、拒绝和收据保持。
- 为 `ProjectAgentResidentShell.tsx` 增加 validation scope 回归断言，并核对 #504 的实际 CI scope 收据。

## 不动项

- 不恢复模式弹层里的审批/花费选项。
- 不新增介入槽 UI；若审批档位入口仍缺失，只在报告标记。
- 不改生产审批策略或收据实现。

## 验收

- `node tests/ux/resident-composer-receipt-fix.e2e.mjs` 通过。
- `pnpm run test:real-user-journeys:ci`、`pnpm run gates` 通过。
- 分类器断言确认 Resident Shell 变更会选择 journeys lane。
