t8-verify：通过

- 验收线：t8-verify
- 验收 HEAD：1ebe50c15836cca616902a41e9a18cf846969fe6
- 验收对象：PR `#1627`（`feat/t8-structural-guards-and-discovery` · 第 1 轮评审 1–7 条修改 + 3 项合前实证全量落实，基于 `origin/main` `6881dc673`）

---

## 一、评审 1–7 条逐项独立核查（7/7 全通过）

1. **删自建基线 → 统一 ESLint 原生 `eslint-suppressions.json`**：
   - 已核 `scripts/t8-structural-guards-baseline.json` 与 `scripts/renderer-sync-ipc-baseline.json` 均已删除；
   - `scripts/lint-changed.mjs` 相对 `origin/main` 为 **0 diff**；
   - 独立调用 `scripts/lib/coordApprovals.mjs#suppressionApprovalSubject` 重算确认：上涨 `44` 条 file × rule / `83` 处，`fingerprint` 精确为 `673bdf31c4d6b3bf1294370058af891ca1c560e3bf61611dc5d0d7900bf38e84`。
2. **真删 4 道旧门岗（本地 + CI 总数真正净减 4 道）**：
   - 已核 `scripts/check-main-console.mjs`、`scripts/check-renderer-sync-ipc.mjs`、`scripts/check-builtin-vendor-literals.mjs`、`scripts/check-prior-art.mjs` 及旧测试/旧基线均已删除，并从 `package.json` `scripts` 与 `gates:contracts` 移除；
   - `pnpm run check:gates-chain`（21/21）、`pnpm run check:rule-aliases`、`pnpm run check:workflow-script-refs` 均 0 错通过，总门岗数由 111 净减至 107。
3. **堵死短档两口子（删手写词法器 + 四入口必传改动文件源）**：
   - 已核 `semanticTokensOf` 已从 `scripts/` 彻底删除；命中界面候选文件一律 `changed: true` 落标准档，缺改动文件源一律 `known: false` 落标准档；
   - 四入口接线契约单测与 `process-tier-mutation.node-test.mjs` 全绿。
4. **`CLAUDE.md` 严格只改拍板那一句**：
   - 独立运行 `git diff --word-diff origin/main..HEAD -- CLAUDE.md` 确认仅替换 `（门岗判，见` → `（短档由门岗从改动本身算出没碰用户可见界面，不以 PR 自报为准，见`，其余一字未动；`pnpm run check:agents-sync` 通过。
5. **`vendor-failure-one-home` 不再豁免 `generationFailureDetect.ts`**：
   - 已核 `electron/shared/generationFailureDetect.ts` 已按条数冻入 `eslint-suppressions.json`，唯一豁免主人只剩 `electron/shared/vendorFailure.ts`。
6. **`generic-retry-loop` 报错只指 `p-retry`**：
   - 已核 `scripts/t8-structural-guards.mjs:73` 报错文案仅指向 `p-retry`。
7. **`docs/engineering/design-card.md` 候选路径明示 + 历史回放**：
   - `## 短档` 已写明界面候选路径与暂未纳入范围；`CLAUDE.md` 与 `rules.json` 保持 0 处具体文件扩展名/目录名泄露。

---

## 二、独立复跑清单（全部 0 报错通过）

| 检查项 | 命令 | 结果 |
|---|---|---|
| 全仓 ESLint（CI 口径） | `pnpm run lint:ci` | **通过**（`0 errors`，`0 unused suppressions`） |
| 6 条规则/门岗一致性链 | `check:gates-chain`、`check:rule-aliases`、`check:workflow-script-refs`、`check:agents-sync`、`check:claude-hooks`、`check:filesize` | **6/6 全通过** |
| 5 套核心与契约 node-test | `node --test scripts/t8-structural-guards.node-test.mjs scripts/process-tier.node-test.mjs scripts/process-tier-mutation.node-test.mjs scripts/check-boundary-owners.node-test.mjs scripts/check-quality-gate-workflow.node-test.mjs` | **96 passed / 0 failed**（含四入口接线契约、`PR Body runs without node_modules`、`台账只有一个读口`） |
| PR 正文判据（合并档） | `NOMI_PR_BODY_FILE=... node scripts/check-pr-judgement.mjs --pr --stage=merge` | **通过**（受保护文件全部点名，仅输出预期的 `⚠ eslint-suppressions.json` 待协调 `coord-approve --suppressions`） |

---

## 三、独立破坏变异复核（破 → 红，复原 → 绿）

- **实时实验（冻结文件内新增违规）**：在已在 `eslint-suppressions.json` 冻结 1 处裸 `rename` 的 `electron/downloads/verifiedAssetCache.ts` 末尾再加 1 处 `fs.renameSync("a", "b")`，实跑 `pnpm exec eslint electron/downloads/verifiedAssetCache.ts` → 当场 **exit 1（2 errors：`171:11` + `213:42` `generic-raw-rename/no-restricted-syntax`）**，还原后立即恢复 `0 errors`。

---

## 四、验收结论

**`t8-verify：通过`**（基于终版实现提交 `1ebe50c15836cca616902a41e9a18cf846969fe6`，0 处阻断项；合入前由协调按 `fingerprint` `673bdf31c4d6b3bf1294370058af891ca1c560e3bf61611dc5d0d7900bf38e84` 执行 `node scripts/coord-approve.mjs --pr 1627 --suppressions` 即可）。
