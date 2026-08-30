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

**为什么这类 bug 能一直复发**：`eslint.config.mjs:28` 把 `tests/ux/**` 整个 ignore 了 —— 现有五门
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

> ⚠️ 上面这段是**第一批当时**的状态。第二批（见下）已把那 56 个迁完并把 `'scripts'` 加回
> `SCAN_DIRS`，现在门岗扫的是 `tests` + `evals` + `scripts` 三片。

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

---

## 第二批：`scripts/` 下 56 个脚本（2026-08-11 续做）

上一批诚实标注的「后续项」。做完这批，门岗 `SCAN_DIRS` 才能加回 `'scripts'`——
在此之前加就是当场红门。

### 分组依据：**按脚本今天用的是哪个 profile 分**，不按「像不像要真 key」猜

这是一次**纯重构**，判据必须可推导。路径解析事实（`electron/runtimePaths.ts:20-31`、
`electron/settings/settingsRoot.ts`）：

- `settingsRoot` = `NOMI_SETTINGS_DIR` ?? `userData`
- `projectsRoot` = `NOMI_PROJECTS_DIR` ?? 设置里的自定义位置 ?? `~/Documents/Nomi Projects`
- API key 存在 `<settingsRoot>/model-catalog.json`，用 safeStorage 加密；解密身份绑的是
  **app name（keychain）**，不是 userData 路径（`electron/catalog/secrets.ts:45-57`、
  `electron/capabilityCore/host.ts:23-27`）。启动器不改 app name → **隔离 userData 不影响解密**，
  真正决定「读不读得到 key」的是 `settingsRoot` 指哪。

于是判据只有一条：

| 组 | 判据 | 处理 | 数量 |
|---|---|---|---|
| A | 脚本自己设了 `NOMI_SETTINGS_DIR` / `NOMI_PROJECTS_DIR` | 把它算好的目录**原样传进** `launchNomiApp`（`settingsDir`/`projectsDir`/`userDataDir`） | 44 |
| B | 一个目录 env 都没设 = 今天就跑在**真实 profile** 上 | `isolate: false` | 12 |

B 组为什么不能顺手隔离：它们今天读的就是真 catalog 里的真 key（`staging-ab.mjs:66` 直接
upsert apimart key 后真出图）、真项目库（`pose-lab-app-verify.mjs:30` 有卡就点已有项目）。
一刀切隔离 = 「跑得起来但结果全错」，正是上一批第 3 条坑的同款。

A 组的 seeding 顺序必须保住：不少脚本**先**把真 catalog 拷进自己的 settingsDir 再起飞
（`model-panel-shot.mjs`、`retired-model-walkthrough.mjs` 等 9 个从
`~/Library/Application Support/nomi/model-catalog.json` 拷）。启动器**只建目录不清空**，
所以「先拷后起」原样成立——这条在上一批已经改对了，这批直接受益。

### 验收门

与第一批同：`check:e2e-launch`（含 `scripts`）→ `node --check` → 手动 `no-undef`/`no-unused-vars`
（`scripts/**` 同样被 eslint ignore）→ **本机 Nomi.app 开着时实跑 ≥3 个** → `pnpm run gates`。

### 实做记录（2026-08-11 完成）

**门岗加回 `'scripts'` 并做了负向测试**：故意塞一个直接调 `electron.launch` 的探针进 `scripts/`，
门岗当场红（exit 1）并点名行号；移除后复绿。不做这步的话，「门是绿的」证明不了「门能拦住」。
门岗自己那行正则（`/electron\.launch\s*\(/`）不会自伤——它匹配的是字面 `.`，源码里是 `\.`。

**逐文件对账（不只看语法过）**：写了一版比对脚本，把每个文件的 HEAD 版与迁移版并排比：
HEAD 的 env 里每个非必需 key 是否还在、三个目录 env 是否都落到对应 option、`--user-data-dir`
是否从 arg 改成了 option、`isolate:false` 是否**当且仅当** HEAD 没设任何目录 env。56 个全过。
（跑第一版时 6 个误报，根因是我的正则按行首锚定、而那几个 env 对象写在一行里——修正则后归零。
这条值得记：对账脚本本身也会骗人。）

**静态校验**：`scripts/**` 同样被 eslint ignore，故照第一批的做法另跑一轮 `no-undef` /
`no-unused-vars`（临时 flat config）。**迁移引入的死代码 0 处**。剩余告警全是
`win.evaluate()` 回调里的浏览器全局（`CustomEvent`/`FileReader`/`atob`…）与 1 处既有死变量
（`browser-live-capture-sweep.mjs` 的 `MAGIC`，HEAD 版就在，只是行号被 import 删减挪了），未顺手改。

**验收实跑（本机 Nomi.app 正在运行，PID 13403）**

| 脚本 | 结果 |
|---|---|
| `pose-lab-app-verify.mjs`（B 组，迁移前**两条 env 都没设**） | ✅ 2 张截图、跑到底 |
| `project-rename-walkthrough.mjs`（A 组） | ✅ 3 张截图，断言全过 |
| `settings-autosave-walkthrough.mjs`（A 组） | ✅ 4 张截图，断言全过 |
| `token-alpha-walkthrough.mjs`（A 组） | ⚠️ 能起来并跑断言，卡在 `画布手势提示` 这个**陈旧 locator**——已用 HEAD 版实跑复现同样失败，属既有问题、非本次回归，未动 |

**最有说服力的两条**：

1. `pose-lab-app-verify.mjs` 的 HEAD 版在 Nomi.app 开着时**0.5 秒就死**，抛的是
   `electron.launch: Target page, context or browser has been closed`——单实例锁没抢到、主进程自己
   退了，零截图零线索，看起来就像脚本自己写坏了。迁移后同样条件下正常出图跑完。
2. **两种 profile 语义确实是分开的、且都对**：A 组 `project-rename` 的截图里项目库**只有 1 个**
   刚建的项目（干净隔离库），B 组 `pose-lab` 的截图里是用户**真实**项目库里那个 19 节点的真项目。
   要是当初把 B 组一刀切隔离，它会「跑得起来但打开的是空库」——正是这次特意避开的坑。
