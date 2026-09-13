# 2026-09-12 sandbox-runtime 打包修复方案

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

## 先查别人

仓库既有 `docs/lessons/sandbox-runtime-not-unpacked-from-asar.md` 记录了 sandbox-runtime 的外部二进制、Java agent 与 Electron `app.asar` 路径陷阱；本次实现沿用其结论，先检查上游显式路径配置，再同时验证 `asarUnpack` 与运行时实际传入的解包路径。打包证据脚本 `tests/ux/packaged-sandbox-active.e2e.mjs` 覆盖 macOS seatbelt 的 `active:true`、解包资产存在及传给子进程的路径均位于 `app.asar.unpacked`。

- `docs/lessons/sandbox-runtime-not-unpacked-from-asar.md:8-15`：asarUnpack 与显式路径必须同时处理。
- `docs/lessons/sandbox-runtime-not-unpacked-from-asar.md:24-37`：Electron `existsSync` 对归档路径的误导及 exec 失败证据。
- `docs/lessons/sandbox-runtime-not-unpacked-from-asar.md:46-58`：macOS seatbelt 与 Windows/Linux/Java 影响面结论。

## 方案与验收

- 在 pnpm 与扁平 node_modules 布局中解包 sandbox-runtime 的 vendor 资产。
- 通过 runtime 的路径配置把真实解包路径交给 Windows/Linux broker 与 Java agent。
- Composer 在 sandbox 不可用时显示可理解的原因；release checklist 要求留下 packaged `active:true` 证据。
- 运行时单元、类型检查及真实 `.app` 探针必须通过。
