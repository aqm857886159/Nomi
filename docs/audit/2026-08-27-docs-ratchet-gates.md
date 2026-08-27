# 文档棘轮门岗执行与验收报告

## 范围

- 新增 `check:docs-index`：扫描 `docs/plan/**/*.md` 与 `docs/superpowers/plans/**/*.md`，禁止新增未被文档索引链接的方案。
- 新增 `check:doc-status`：要求上述方案在开头带既有五类状态标记，并要求 `⛔` 状态给出替代文档指向。
- 将两道门接入 `package.json` 的 `gates` 链，并修正两个索引入口的已知事实错误。
- 给 `docs/plan/agent-merge-architecture.md` 只加一行过期提示，不改历史正文。

## 不动项

- 不批量修改存量方案文档；现有违规全部进入具体文件身份 baseline。
- 不删除或移动任何文档。
- 不修改 `CLAUDE.md`、`docs/ARCHITECTURE-NOW.md`、`docs/GLOSSARY.md`。
- 不运行与本任务无关的 `test` 或 `build`。

## 回滚策略

本任务只新增门岗与 baseline，并对索引入口和一篇已知过期文档作最小修正；若需回滚，可按文件逐项撤销，不涉及数据迁移。

## 验收门

1. 两道门分别用临时违规文档验证 RED，原样记录输出。
2. 删除临时违规文档后，两道门分别恢复 GREEN，原样记录输出。
3. 最终运行 `check:docs-index`、`check:doc-status`、`check:gates-chain`、`check:filesize`、`check:i18n`。

## RED / GREEN 原始输出

### `check:docs-index` RED

违规样例 `docs/plan/__docs-index-gate-red-sample.md`：

```markdown
# 文档索引门岗 RED 样例

> 📋 方案待拍板

该文件故意不进入任何索引，用于证明 `check:docs-index` 会拦截新增失联方案。
```

原始输出：

```text
 WARN  Unsupported engine: wanted: {"node":">=22.19.0"} (current: {"node":"v22.15.0","pnpm":"10.8.1"})

> nomi@0.21.0 check:docs-index C:\Users\23732\Nomi-docs
> node ./scripts/check-docs-index.mjs

文档索引覆盖：433 篇方案；76 篇已收录；357 篇未收录（基线 356）
✖ 文档索引回归：1 篇新增未收录方案
  docs/plan/__docs-index-gate-red-sample.md
  → 在 docs/README.md 或某个 docs/**/INDEX.md 中用 Markdown 链接收录，不能抬高 baseline
 ELIFECYCLE  Command failed with exit code 1.
 WARN   Local package.json exists, but node_modules missing, did you mean to install?
```

### `check:docs-index` GREEN

删除上述样例后，原始输出：

```text
 WARN  Unsupported engine: wanted: {"node":">=22.19.0"} (current: {"node":"v22.15.0","pnpm":"10.8.1"})

> nomi@0.21.0 check:docs-index C:\Users\23732\Nomi-docs
> node ./scripts/check-docs-index.mjs

文档索引覆盖：432 篇方案；76 篇已收录；356 篇未收录（基线 356）
✅ 文档索引棘轮通过（只减不增）
```

### `check:doc-status` RED

违规样例 `docs/superpowers/plans/__doc-status-gate-red-sample.md`：

```markdown
# 方案状态门岗 RED 样例

该文件故意不带状态标记，用于证明 `check:doc-status` 会拦截新增无状态方案。
```

原始输出：

```text
 WARN  Unsupported engine: wanted: {"node":">=22.19.0"} (current: {"node":"v22.15.0","pnpm":"10.8.1"})

> nomi@0.21.0 check:doc-status C:\Users\23732\Nomi-docs
> node ./scripts/check-doc-status.mjs

方案状态：433 篇；缺状态 425（基线 424）；⛔ 无替代指向 0（基线 0）
✖ 方案状态回归：1 篇新增文档在开头 12 行内没有状态标记
  docs/superpowers/plans/__doc-status-gate-red-sample.md
  → 沿用：✅ 已落地 ｜ 🚧 进行中/待实施 ｜ 📋 方案待拍板 ｜ ⛔ 已撤销/废弃 ｜ 📎 交接/日志
 ELIFECYCLE  Command failed with exit code 1.
 WARN   Local package.json exists, but node_modules missing, did you mean to install?
```

附加反向控制：有 `⛔`、但没有替代指向。

```text
 WARN  Unsupported engine: wanted: {"node":">=22.19.0"} (current: {"node":"v22.15.0","pnpm":"10.8.1"})

> nomi@0.21.0 check:doc-status C:\Users\23732\Nomi-docs
> node ./scripts/check-doc-status.mjs

方案状态：433 篇；缺状态 424（基线 424）；⛔ 无替代指向 1（基线 0）
✖ 废弃文档回归：1 篇新增 ⛔ 状态没有替代文档指向
  docs/plan/__doc-status-deprecated-red-sample.md
  → 在状态同一行或紧邻行写明由哪篇现行 .md 取代，且目标必须真实存在
 ELIFECYCLE  Command failed with exit code 1.
 WARN   Local package.json exists, but node_modules missing, did you mean to install?
```

### `check:doc-status` GREEN

删除上述样例后，原始输出：

```text
 WARN  Unsupported engine: wanted: {"node":">=22.19.0"} (current: {"node":"v22.15.0","pnpm":"10.8.1"})

> nomi@0.21.0 check:doc-status C:\Users\23732\Nomi-docs
> node ./scripts/check-doc-status.mjs

方案状态：432 篇；缺状态 424（基线 424）；⛔ 无替代指向 0（基线 0）
✅ 方案状态棘轮通过（只减不增）
```

## 存量基线

- 未收录：356 篇（`docs/plan/` 322；`docs/superpowers/plans/` 34）。
- 缺状态：424 篇（`docs/plan/` 389；`docs/superpowers/plans/` 35；按最终“真实状态行”判据实扫）。
- `⛔` 无替代指向：0 篇。

## 最终检查原始输出

### `pnpm.cmd run check:docs-index`

```text
 WARN  Unsupported engine: wanted: {"node":">=22.19.0"} (current: {"node":"v22.15.0","pnpm":"10.8.1"})

> nomi@0.21.0 check:docs-index C:\Users\23732\Nomi-docs
> node ./scripts/check-docs-index.mjs

文档索引覆盖：432 篇方案；76 篇已收录；356 篇未收录（基线 356）
✅ 文档索引棘轮通过（只减不增）
```

### `pnpm.cmd run check:doc-status`

```text
 WARN  Unsupported engine: wanted: {"node":">=22.19.0"} (current: {"node":"v22.15.0","pnpm":"10.8.1"})

> nomi@0.21.0 check:doc-status C:\Users\23732\Nomi-docs
> node ./scripts/check-doc-status.mjs

方案状态：432 篇；缺状态 424（基线 424）；⛔ 无替代指向 0（基线 0）
✅ 方案状态棘轮通过（只减不增）
```

### `pnpm.cmd run check:gates-chain`

```text
 WARN  Unsupported engine: wanted: {"node":">=22.19.0"} (current: {"node":"v22.15.0","pnpm":"10.8.1"})

> nomi@0.21.0 check:gates-chain C:\Users\23732\Nomi-docs
> node ./scripts/check-gates-chain.mjs

✅ 门岗链完整：25 个 check:* 全部可达（蓄意豁免 1 个：check:audit）
```

### `pnpm.cmd run check:filesize`

```text
 WARN  Unsupported engine: wanted: {"node":">=22.19.0"} (current: {"node":"v22.15.0","pnpm":"10.8.1"})

> nomi@0.21.0 check:filesize C:\Users\23732\Nomi-docs
> node ./scripts/check-file-sizes.mjs

✓ 文件体积门岗通过：上限 800 行，巨壳白名单 2 个（棘轮只减不增）。
```

### `pnpm.cmd run check:i18n`

本 worktree 没有 `node_modules`，扫描器未能启动。原始输出：

```text
 WARN  Unsupported engine: wanted: {"node":">=22.19.0"} (current: {"node":"v22.15.0","pnpm":"10.8.1"})

> nomi@0.21.0 check:i18n C:\Users\23732\Nomi-docs
> node ./scripts/check-i18n-visible-text.mjs

node:internal/modules/package_json_reader:268
  throw new ERR_MODULE_NOT_FOUND(packageName, fileURLToPath(base), null);
        ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'typescript' imported from C:\Users\23732\Nomi-docs\scripts\check-i18n-visible-text.mjs
    at Object.getPackageJSONURL (node:internal/modules/package_json_reader:268:9)
    at packageResolve (node:internal/modules/esm/resolve:768:81)
    at moduleResolve (node:internal/modules/esm/resolve:854:18)
    at defaultResolve (node:internal/modules/esm/resolve:984:11)
    at ModuleLoader.defaultResolve (node:internal/modules/esm/loader:780:12)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:704:25)
    at ModuleLoader.resolve (node:internal/modules/esm/loader:687:38)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:305:38)
    at ModuleJob._link (node:internal/modules/esm/module_job:137:49) {
  code: 'ERR_MODULE_NOT_FOUND'
}

Node.js v22.15.0
 ELIFECYCLE  Command failed with exit code 1.
 WARN   Local package.json exists, but node_modules missing, did you mean to install?
```

随后尝试 `pnpm.cmd install --offline --frozen-lockfile --ignore-scripts`；本机 store 缺少 `@ai-sdk/anthropic@1.2.12` tarball，离线安装失败。未联网安装，未修改锁文件；失败安装创建的部分 `node_modules` 链接已清理，可由正常 `pnpm install` 重建。

## `git status --short`

```text
 M AGENTS.md
 M CLAUDE.md
 M docs/README.md
 M docs/plan/INDEX.md
 M docs/plan/agent-merge-architecture.md
 M package.json
?? docs/ARCHITECTURE-NOW.md
?? docs/GLOSSARY.md
?? docs/audit/2026-08-27-docs-ratchet-gates.md
?? scripts/check-doc-status.mjs
?? scripts/check-docs-index.mjs
?? scripts/doc-status-baseline.json
?? scripts/docs-index-baseline.json
```
