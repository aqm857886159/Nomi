# tests/ux 启动器收敛 —— 干掉「静默 180s 超时」这类 bug

日期：2026-08-11 · 规则：P1（加新必删旧）/ P2（修根因）/ R4（多文件先写文档）

## 病灶

`tests/ux/` 下 107 个脚本各自手抄一份 `electron.launch` 样板。抄漏 env 就会**静默挂死**——
一张截图不产、无任何提示，干等到 180s 超时，排查时看起来像脚本自己写错了。

两条已知死法，症状**完全一样**（都卡在 `app.firstWindow()`）：

| 漏了什么 | 机制 | 代码依据 |
|---|---|---|
| `NOMI_E2E_ALLOW_MULTI_INSTANCE=1` | 本机 Nomi.app 在跑时 `requestSingleInstanceLock()` 拿不到锁 → app 让出并退出 → 窗口永不出现 | `electron/main.ts:74-75` |
| `NOMI_E2E=1` | COOP/COEP cross-origin isolation 不关 → Playwright CDP target 握手卡死 → 连不上 | `electron/main.ts:684-689`（注释里写明了） |

实测统计（107 个调 `electron.launch` 的脚本）：

- 漏 `NOMI_E2E_ALLOW_MULTI_INSTANCE`：**72**
- 漏 `NOMI_E2E`：**41**
- 至少漏一条 = **72**（只有 35 个是全对的）

而且已经有**三份并行实现**（P1 明确禁止的状态）：

1. `evals/lib/isoApp.mjs` → `launchIsolatedApp` / `isolatedAppEnv`（env 对，但无友好报错）
2. `tests/ux/helpers/electronFixture.mjs` → `isolatedElectronLaunchOptions`（只拼 options，仅 1 个消费者）
3. 100+ 份内联手抄（72 份是坏的）

**为什么这类 bug 能一直复发**：`eslint.config.js:28` 把 `tests/ux/**` 整个 ignore 了 —— 现有五门
**没有任何一道**能看见这里。不加结构保证，改完还会再抄坏。

## 做法

### 1. 单一启动器 `tests/ux/_launchApp.mjs`

导出 `launchNomiApp(options)`，一个函数管完：

- **强制**那套必需 env（`NOMI_E2E` / `NOMI_E2E_ALLOW_MULTI_INSTANCE` 在合并调用方 env **之后**再钉一次，
  调用方不可能覆盖掉 → 不变量在代码层面成立，不靠自觉）
- 临时 `userDataDir` / `settingsDir` / `projectsDir` 三隔离 + 建目录
- 起飞前先查 `dist-electron/main.js` 在不在（没 build 直接说「先 pnpm run build」，不用等超时）
- `launch` 与 `firstWindow` **都**包超时（默认 60s，早于 Playwright 的 180s），超时抛**说人话**的错：
  列出两条已知死因 + 该跑什么命令 + **主进程 stderr/stdout 尾巴**（真正的线索在这里）

### 2. 结构保证：`scripts/check-e2e-launch.mjs` 进 `gates`

扫 `tests/ux/` + `evals/`：除 `_launchApp.mjs` 自己外，**禁止**任何文件直接调 `electron.launch`。
lint 看不见这片地，就自己给它一道门 —— 这是「这类 bug 不再复发」的结构保证（P2），
不是靠「下次记得抄全」。

### 3. 迁移（P1：迁一个删一份，不留新旧并存）

- 107 个 `tests/ux/*.mjs` 全量迁到 `launchNomiApp`，删掉各自的 launch 样板与随之失效的 import
- `evals/lib/isoApp.mjs` 的 `launchIsolatedApp` / `isolatedAppEnv` **改为委托**给新启动器
  （删掉重复的 env 定义；保留 `prepareIsolation`——拷真实 model-catalog 是另一件事，且 evals 调用方 API 不变）
- **删除** `tests/ux/helpers/electronFixture.mjs`，其单测改为覆盖新启动器（`tests/**/*.test.mjs` 已在 vitest include 里）

**不留中间态**：要么全迁完，要么不 commit。

## 不动项

- `electron/main.ts` 的单实例锁与 COOP/COEP 逻辑（那是**正确**的生产行为，不为测试让路）
- `prepareIsolation` 的 catalog 拷贝语义、各脚本自己的断言/截图逻辑
- 各脚本的退出码约定

## 验收门

1. `check:e2e-launch` 通过（0 处直接 `electron.launch`）
2. 每个脚本 `node --check` 过（无语法/无残留悬空引用）
3. **本机 Nomi.app 正在运行**的前提下，实跑 ≥3 个脚本能真起来出图（这条是本次修复的核心验收点）
4. `pnpm run gates` 全绿 → commit + push

## 回滚

单 commit，`git revert` 即可；启动器与门岗是新增文件，删掉即回到原状。

---

## 实做记录（2026-08-11 完成）

### 落地时才发现、方案里没预料到的四件事

1. **`ELECTRON_RUN_AS_NODE` 是同一类死法的第三个入口。** 它一旦被继承进来，electron 退化成纯 node：
   不开窗、不起渲染层 → 又是干等到超时。已在启动器里统一摘掉（`buildNomiLaunchEnv`）。
2. **启动器绝不能清空目录。** 好些走查在起飞前往 `projectsDir` 预埋工程（`toolbar-order` 先写
   `project.json` 再启动）。原设计的 `reset:true` 会把它们的前置条件擦掉——已改成「只建不删」，
   要干净 profile 的脚本自己在调用前 `rmSync`（语义留在看得见的地方）。
3. **有三类脚本不能一刀切隔离**，否则会「跑得起来但结果全错」：
   - `ui-driver.mjs`：注释里写明**故意**用系统 userData（要能打开已有/示例项目）
   - `evals/loop/appBridge.mjs`、`evals/verify-shot-smoke.mjs`：key 是 safeStorage 加密、**绑 app 身份**，
     换隔离 userData 就解不开
   → 加 `isolate:false`（真实 profile）。注意 `NOMI_E2E` 那两条**仍然强制**，逃生口只开在「用哪个 profile」上。
4. **另外两个必要参数**：`executablePath`（`mcp-client-activation` 走的是装好的 `.app`，且打包产物
   不该再传 `'.'`——已按「是不是开发构建」派生）、`waitForWindow:false`（`verify-shot-smoke` 压根不开窗，
   等 firstWindow 只会白等）。

### 门岗范围（诚实标注）

`check:e2e-launch` 只扫 `tests/` + `evals/`。**`scripts/` 下还有 56 个同病的一次性走查脚本没迁**——
本次范围是 `tests/ux/`，把 `scripts/` 一起纳入会当场红门、逼出正要避免的中间态。已单独记为后续项。

### 验收实跑（本机 Nomi.app **正在运行**，PID 13403）

| 脚本 | 结果 |
|---|---|
| `smoke.e2e.mjs` | ✅ 14/14 断言 |
| `vendor-connection-health.walk.mjs` | ✅ 7 张截图，失败断言 0 |
| `dark-mode.walk.mjs`（迁移前缺两个 env） | ✅ 5 张截图 |
| `cold-start.e2e.mjs`（迁移前**完全没设** `NOMI_E2E`） | ⚠️ 能起来并跑过 6 条断言，CS2 卡在**陈旧断言**（它要求「零文本模型」，与内置 seed 的 5 个模型矛盾——`smoke.e2e.mjs` 恰恰断言这些 seed 必须在）。未动该断言。 |
| `toolbar-order.walk.mjs` | ⚠️ 失败，但 **HEAD 版同样失败在同一个 locator** → 既有问题，非本次回归 |

**最有说服力的一条**：`cold-start.e2e.mjs` 的 HEAD 版在 Nomi.app 开着时 **181s 超时、零输出**（正是这次要修的病症）；
迁移后几秒就起来并开始跑断言。

### 静态校验

`tests/ux/**` 被 eslint ignore，所以另跑了一轮 `no-undef` / `no-unused-vars`：
迁移引入的 15 处死代码（含 1 处**真会崩**的 `createRequire is not defined`）已全部清掉；
剩余 9 处经与 HEAD 逐条比对确认是**既有**死代码，未顺手改（不在本次范围）。
