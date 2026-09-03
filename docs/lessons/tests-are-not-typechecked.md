# 测试文件不进主 typecheck

> 📎 教训 · 首次记录 2026-08-24 · 状态：✅ 已固化（由 `check:test-types` 门岗接管）—— 但「`pnpm typecheck` 看不见测试」这一半**仍然成立**
> **触发场景**：你想在测试文件里放一道编译期护栏（`Record<keyof T, …>` 之类），或者读到「typecheck 绿」就打算断言「测试的类型没问题」。

**结论**：测试文件的类型由 **`pnpm run check:test-types`**（走 `tsconfig.test.json`，已进 `gates:contracts` 链尾）负责。**`pnpm run typecheck` 依然看不见任何测试文件**——它只跑 `tsconfig.app.json` + `electron/tsconfig.json` + `electron/tsconfig.pi.json`，前两份都还 `exclude` 着 `*.test.ts`。所以「typecheck 绿」≠「测试类型没问题」，要看的是 `check:test-types` 那道。

**现状（已核实，2026-09-02）**：

- `package.json` 的 `typecheck` = `tsc -p tsconfig.app.json && tsc -p electron/tsconfig.json && tsc -p electron/tsconfig.pi.json --noEmit`——**三份都不含测试**。
- `tsconfig.app.json` 的 `exclude`：`["src/**/*.test.ts", "src/**/*.test.tsx", "src/vendor/tablerIcons.ts"]`；`electron/tsconfig.json` 的 `exclude`：`["**/*.test.ts"]`（352 个文件）。两份 tsconfig 顶部现已写上注释说明「别把这里的绿灯读成整个 src 类型没问题」。
- `check:test-types` = `node ./scripts/check-test-types.mjs`，在 `gates:contracts` 链的最末尾（`… && pnpm run typecheck && pnpm run check:test-types`）。
- 棘轮基线 `scripts/test-types-baseline.json`：**32 个文件 / 78 个存量错，`src/` 条目已清零**（上线时是 114，已减）。只减不增，`--update-baseline` 重记账。`src/` 清零 = 新增任何 src 测试类型错**当场报红**。

**同族的第二个洞：走查用的 `.mjs` 连「能不能解析」都没人管（2026-09-02 补，已固化）**

`check:test-types` 管的是 `.ts` 测试。而 `tests/ux/`、`evals/`、`scripts/` 下的 `.mjs`/`.cjs` **一道门都照不到**：`typecheck` 只编 `.ts`；`check:test-types` 走 `tsconfig.test.json`，同样只管 `.ts`；`eslint.config.mjs` 的 `ignores` 里明写着 `'tests/ux/**'`、`'evals/**'`、`'scripts/**/*'`（实测 `pnpm exec eslint tests/ux/mcp-l1-handshake.e2e.mjs` 回 `File ignored because of a matching ignore pattern`、exit 0）。

**代价已付**：一次解冲突在 `tests/ux/mcp-l1-handshake.e2e.mjs` 里留下重复的 `const READ_ONLY_TOOL_NAMES` —— 硬 SyntaxError、加载即崩，五门全绿照样放行，直到有人**手动跑** E2E 才炸。走查按风险面触发、平时不在每次 push 的验证面上，所以「坏了但没人跑」能活很久。

**已固化**：`check:mjs-parse`（`scripts/check-mjs-parse.mjs`，在 `gates:contracts` 链里，夹在 `check:vocabularies` 与 `check:e2e-launch` 之间）对这三片的每个 `.mjs`/`.cjs` 跑 `node --check`，**硬零、无基线**（上线时 545 个文件全部可解析，不欠债）。并发跑 ~2s（串行要 ~18s）。**语义边界**：它只保证**能解析**，不保证类型对、不保证逻辑对——`import` 的目标存不存在它一概不知。它挡的是「加载即崩」这一类。

**上线时的阳性对照**（没做过阳性对照的闸不算闸，同 [`walkthrough-assertions-need-a-real-signal`](walkthrough-assertions-need-a-real-signal.md)）：把那行重复的 `const READ_ONLY_TOOL_NAMES` 原样塞回去 → 门岗 `exit 1` 并逐字点名 `SyntaxError: Identifier 'READ_ONLY_TOOL_NAMES' has already been declared`；恢复后回绿。另有个自嘲级实证：**门岗第一次运行就抓住了它自己**——它的 JSDoc 里写了 `config.mjs` 的通配符路径，其中的 `*/` 提前闭合了块注释。

**为什么用 `node --check` 而不是把三片纳入 eslint**：解析是最小充分条件，零配置、零存量债，且用的就是运行时那个解析器（`.mjs` 按 ESM、`.cjs` 按 CJS，两边的重复声明都抓得住）。把三片纳入 eslint 是另一个量级的工程（大量存量风格债要还），这道门今天就能硬零。哪天真把它们纳入 eslint 了，这道门可以退休（`no-redeclare` 与解析错都会在 lint 里冒出来）。

**为什么会踩**：

2026-08-24 把「加字段必须登记落点」的编译期闸写进 `workbenchAiClient.test.ts` 的 `Record<keyof T, …>`，自以为上了保险；**探针一打就现原形**——给类型加 `testOnlyProbe?: string`，`tsc -p tsconfig.app.json` 照样全绿。当时那个 `exclude` 和「覆盖整个 src（含测试）」的注释是**同一次提交**写下去的，从第一天起就自相矛盾。

2026-08-25 补门岗时实跑一次，挖出 **83 个 src 存量错**，含真漂移：`canvasEventReplay` 的 `Op` 联合漏了 `lock` 变体（生成器和处理分支都有它）、`DesktopBridge` 桩用 `as never` 盖掉 6 个必填口子。门岗上线当天就抓到 main 新引入的 `ProjectLeaseV1` 夹具漂移。

**为什么两个 exclude 不能直接删**（不是懒，是有代价的）：`tsconfig.app.json` 的定位是「app 构建面」，测试不属于它；`electron/tsconfig.json` 删了会因测试 import `src/` 下的东西（违反 `rootDir: "."`）+ 用 ESM 顶层 await（与 `module: CommonJS` 冲突）炸出 **112 个纯配置形状错**（TS6059 / TS1378 / TS1343），全是噪音。

**怎么用**：

- 编译期保证**优先放源码里**，让「清单在源码受 typecheck 管、测试 import 它逐项验上了 wire」。放测试里现在**也会**被检查，但它离「构建面」远一层，源码侧仍是更稳的落点。（当初的正面样例 `WORKBENCH_AI_REQUEST_FIELDS` 所在的 `src/workbench/ai/workbenchAiClient.ts` 已随 pi SDK 迁移移除，此处只留手法不留指针。）
- 想验一道类型闸生不生效，**别读 tsconfig 猜——加探针字段实跑一次**。没做过阳性对照的闸不算闸，同 [`walkthrough-assertions-need-a-real-signal`](walkthrough-assertions-need-a-real-signal.md)。
- 仓库根的 `tsconfig.json` 只 include `src/main.tsx`，拿它跑 `tsc` 等于什么都没查。真正在用的是：`tsconfig.app.json`（渲染层）、`electron/tsconfig.json`（主进程）、`tsconfig.test.json`（测试）、`tsconfig.base.json`（共同底座）。
- **排除测试不是为了快**——实测放进来耗时无差异（~9s vs ~9s）。以后谁再拿「怕慢」当理由，这条可以直接反驳。

**出处**：`package.json` `typecheck` / `check:test-types` / `gates:contracts`；`tsconfig.app.json`、`electron/tsconfig.json` 顶部注释；`scripts/check-test-types.mjs`；`scripts/test-types-baseline.json`。
