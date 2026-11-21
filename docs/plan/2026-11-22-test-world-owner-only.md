# 测试世界只从主人取（D-1121-test-world-owner-only）

> 设计线 D-test-world-owner-only，2026-11-22。依据：用户 11-21 拍板「产品拥有的东西只从主人取；夜跑红有主人有到期日、到期没修就删；不试点、直接全面迁移；每类迁完同提交删手写版本并配写不出来的机制」。研究：协调仓 `coord-handoff/reports/R-test-world-root.md`（下称 R）。本卡只写设计，不迁移。
> 普查都在 HEAD `efd775a06` 上跑。脚本和原始输出在协调仓 `/Users/aoqimin/Nomi-coord/tmp/D-test-world-owner-only/`（下称 E），每个数字后面括号里写着出自哪个脚本、哪份输出。一次性探针跑完已删，没有提交。
> 证明用的词按 D-1121-retro-rules-adopt 分档：**去料**（别处拿不到原料）、**只认主人**（用的那一步只认主人发的）、**出口对拍**（各出口真看到的结果一致）。这三档才算「写不出来」。**运行时拦**指的是用的那一刻自动报错，但门不止一扇。**提示**指按写法扫描。**做不到**照实写。

## ★0 先查别人
- [SWE at Google ch13 Test Doubles](https://abseil.io/resources/swe-book/html/ch13.html) · 原文：「the team that owns the real implementation should write and maintain a fake」；假的要有自己的测试，证明和真的接口一致 · **确认了**：假桥只留一份，由桌面接口主人维护（`tests/world/bridge.ts`），并配一份对真 preload 的一致性测试。
- [SWE ch12 Shared Values](https://abseil.io/resources/swe-book/html/ch12.html) · 辅助函数只写自己在意的值，其余给合理默认 · **改了**：走查不再共享大样板，只声明「和默认世界哪里不同」（`buildWorld(spec)`），默认值由主人产出。
- [Fowler ObjectMother](https://martinfowler.com/bliki/ObjectMother.html) · 原文：「many tests will depend on the exact data in the mothers」 · **确认了**：8 个 TestUtils 和 ux-local 样板都是这种「母本」，改一处牵一片 → 宿主类走装配第 2 刀，不另设计。
- [Fowler ContractTest](https://martinfowler.com/bliki/ContractTest.html)、[SelfInitializingFake](https://martinfowler.com/bliki/SelfInitializingFake.html)、[VCR re-record](https://raw.githubusercontent.com/vcr/vcr/master/features/cassettes/automatic_re_recording.feature) · 假的要对真跑契约，录下的真回答要带重录周期 · **改了**：假供应商只能放录制回答，每份带出处和重录期；现在只有请求侧 29 份（`tests/fixtures/vendor-official/apimart/`），回答侧 0 份，所以这一类判「还没做到」。
- [Playwright Best practices](https://playwright.dev/docs/best-practices) · 用用户看得见的名字定位，「Only test what you control」，前提状态经接口准备 · **确认了**：界面文字仍按用户看见的名字找，只是这个名字从词典主人取（`ui('key')`），不手抄字面。
- [Fowler Eradicating Non-Determinism](https://martinfowler.com/articles/nonDeterminism.html) · 隔离区「only allow 8 tests in quarantine」，每条「no longer than a week」 · **确认了**：丙的已知红名单上限 8 条，每条最多 7 天。
- `vitest.config.ts:37` · 仓库里已有的先例：`OTHER_LANES` 每条不在默认车道的测试样式都必须写 runner，有单测核对 script 真存在，「登记了却没人跑」过不了 · **改了**：把「哪里都不跑」收进同一种机制，每个走查 / e2e / probe 要么被夜跑选中，要么在排除表里写出 runner，没有第三种。
- `electron/parity/officialWire.matrix.test.ts` + `officialWire.known-red.json` · 已知红「两头冻结」：新红进不来，变绿了必须从名单删 · **确认了**：已知红名单和「还没迁」名单都照这个两头冻结。
- 出口：[Fowler Eradicating Non-Determinism](https://martinfowler.com/articles/nonDeterminism.html) · 隔离不是终点，到期要么修好、要么删掉，隔离期间测试照跑 · **改了**我们的出口：被锁拦住的测试作者只有三扇合法门（主人造世界 `buildWorld`、旧版真实数据 `seedOldUserData`、坏数据 `damageWorldFile`），报错原文直接点名该走哪一扇。这个锁只挡测试代码，不碰创作者界面。

## ★1 谁在什么时刻要做完什么

当产品主人改了数据形状或规则（例如 #1560 改上架规则、10-31 目录升版），我想测试不用跟着改、红的只有真坏了的，以便改规则的线把时间花在功能上，红灯又重新有人信。

**步骤**：①写新测试的人调 `buildWorld(spec)`，只声明和默认世界的差别；②主人函数产出存盘文件、桥和装配；③要测老用户升级，就调 `seedOldUserData(id)`，只读 `tests/fixtures/old-user-data/`；④要测坏数据，就调 `damageWorldFile(world, file, kind)`，只能动主人已经产出的文件，坏法只能从具名清单里挑；⑤绕开这三扇门手写的，在写的那一刻报错，报错点名该走哪扇；⑥夜跑出红：名单里的红按到期日处理，名单外的新红 24 小时内要有人认；⑦到期没修好，夜跑自动开 PR 把它删掉。

**不做什么**：不改产品行为；不碰外部供应商的真回答，录制回答要不要花钱另外定；不改创作者界面。

**已知坑**：
- 一个类型能一次锁住所有家，但一刀切之后还在路上的分支会成批变红（见 ★1c）。
- 写盘锁看不见子进程（python、shell 的 cp），也分不清 app 运行期间别的进程写的文件（见「做不到」）。

**真实任务**（都是已经发生过的，不是合成的）：
1. #1560 上架规则：同形状 9 份走查 8 份红，其中 3 份当晚由绿翻红（R:33，引 `R-ux-local-unavailable.md`；8/9 这个数我没复核）。
2. 10-31 `bd40dc0b5` 为目录升 v14 改了 13 个走查文件（`git show --stat bd40dc0b5`：13 files），当晚 `5b4bfeb70` 全部改回。
3. 反馈日志尾巴逃逸：`buildFeedbackReport` 收 `deps.readLogTail`，单测和走查都注入了假读者，真读者的裸文件名 bug 一直没被测到（`docs/fixes/2026-11-01-feedback-log-tail.root-cause.json`）。

| 指标 | 基线（量具） | 目标 | 量具 |
|---|---|---|---|
| 主：测试代码自己写主人存盘文件的单测份数 | 84 = 第一帧就是测试的 81 + 测试直接拿存盘原语写的 3（E/world-probe2.out，按 A 表的「直接调用者」规则） | 0，「还没迁」名单只减 | 批 1 把探针做成写盘锁的记录模式，名单长度由它算 |
| 主：走查侧自己写主人存盘文件的份数 | 217，静态粗判，只算提示（E/walk-world-writers.out） | 0 | 同一把锁装在走查进程里的记录模式 |
| 主：主人改规则导致的走查翻红 | #1560 是 8/9；升版要改 13 个文件 | 回放 0 红，0 个文件要改 | 批 1 回放：免费走查前后各跑一遍（★9） |
| 质量：夜跑名单外新红 24 小时内有主人的比例 | 0/133，人回 0 条（R:42–43） | 100% | 夜跑汇总对名单做差（丙） |
| 质量：已知红名单长度 / 过期条数 | 没有名单 | ≤8 / 0 | 夜跑作业：超上限或有过期就红 |
| 质量：30 天内夜跑全绿的晚数 | 0/31（R:41） | 未验证：缺量具（名单落地前定不出可信目标） | `gh run list` 夜跑作业结论 |
| 护栏：哪里都不跑的测试 | 走查 36 + e2e 68 + probe 4 = 108（E/runs-nowhere.out；e2e 拆开是没人提 20 + 只在名册和基线里 46 + 本机工具点名 2，见 E/e2e-mentions.out） | 0 | 选择表单测（照 `OTHER_LANES`） |
| 护栏：锁误拦只经主人写的测试 | 写盘 0/49（测试驱动产品代码、由产品自己去写的）；假桥对照 0/32；mock 锁对照 0/28（另 2 份是静态正则漏掉的真 mock）；spyOn 锁对照 0/5；冻结主人命名空间：碰桥的 32 份 686 条、`electron/catalog` 186 份 4498 条，0 红 | 0 | 探针（E/world-probe2.out、E/bridge-probe.out、E/mock-probe/record.out、E/mock-probe/spy.out、E/mock-probe/freeze-on-*.log） |
| 护栏：锁带来的单测墙钟开销 | 未验证：缺量具（探针跑过 248 份 178 秒，但没有同批不加锁的对照） | ≤5% | 批 1 用同一批文件加锁 / 不加锁各跑 3 次 |

### ★1b 连带界面
不适用：没有可见差异。碰到的产品代码：①4 处直接读 `window.nomiDesktop` 的地方改走 `getDesktopBridge()`；②渲染端入口认领一次桥对象；③`src/desktop/bridge.ts:425` 的 `getDesktopBridge` 改成只返回认领过的对象，不再每次现读 window；④`Window` 全局声明删掉 `nomiDesktop`（只是类型）；⑤每个主人模块加一个标记导出，声明「我是主人」（设计，没探：探针认主人用的是手写导出名单）。冻结主人命名空间由测试时的转换插件注入，不进产品构建。

### ★1c 老用户
- **创作者**：不适用，产品行为不变。preload 暴露的对象不变（`electron/preload.ts:21`），4 处直读改走 `getDesktopBridge()` 后拿到的还是同一个对象；没有桥的环境照旧拿到空。上面 ③ 让桥在页面启动时就定下来，页面运行中途才出现的桥不再被认（Electron 里 preload 先于页面脚本跑，今天没有这种情况）。
- **在路上的分支（这件事里真正的「老用户」）**：锁上线那一刻，新写的手抄测试会在 CI 红，报错点名新入口。冻结名单只收锁上线那一刻已在 main 上的文件，不收分支上新写的，在路上的分支要按新入口改。已知一份：`feat/cost-step1-estimate` 上新建的 `composerBridgeTestUtils.ts`，是第二个假桥的家。协调 11-22 定：照常合入，批 3 在 `desktopBridgeForTest` 的同一个提交里删掉。
- **已有、还没迁的测试**：进「还没迁」冻结名单（见下），照常跑。名单只许减，由记录模式自动生成，不手写。最后一批同提交删掉名单。
- **旧版真实数据**：`tests/fixtures/old-user-data/` 不动，成为唯一的「测老版本迁移」出口。手写的旧数据名册（`tests/ux/uiDriverOptions.mjs:25`）删掉，改由目录派生。这份名册今天盘上 4 份只登记了 2 份（R:37），正是手抄名册的病。
- **退回上一版**：每批是一个 PR，锁是 `tests/setup/world/` 下的独立文件，revert 就退。

## ★2 谁说了算（主人、全部家、「1」靠什么保持）

**主人**（逐个打开核过）：
- **模型目录**：`electron/catalog/catalogStore.ts`。读 `:87 readCatalog`；写 `:388 upsertModelCatalogVendor`、`:445 …VendorApiKey`、`:495 …CustomCallConfig`、`:534 …Model`、`:615 …Mapping`、`:663 importModelCatalogPackage`；`:768 mutateCatalog` 是通用改口；`:198` 原子落盘。另有内置种子 `electron/catalog/seedBuiltins.ts:563 applyBuiltinSeeds`，以及「添加其他」接入的 `electron/catalog/declaredProviderRegistration.ts:133 registerDeclaredProvider`。
- **项目**：`electron/projects/repository.ts`，`:199 createProject`、`:213 readProject`、`:231 saveProject`。工作区：`electron/workspace/workspaceRepository.ts:249`、`workspaceManifest.ts:644`。
- **设置**：`electron/settings/*` 共 11 个 write 函数（例：`modelBoxPreferenceSettings.ts:8`）。
- **存盘原语**：`electron/jsonFile.ts:54/:97`、`electron/configFileStore.ts:108/:231`。
- **桌面接口**：`electron/preload.ts:21` 暴露；`src/desktop/bridge.ts:152` 是类型，`:424` 是 `getDesktopBridge()`。
- **生成装配**：`createGenerationDomain`（#1590 分支 `generationDomain.ts`），今天的入口是 `electron/capabilityCore/liveGenerationRuntime.ts:57`。
- **界面文字**：词典，走查侧读口是 `tests/ux/full-walk/invariants.mjs:121 uiText` 和 `:131`、`:163`。
- **供应商事实**：`tests/fixtures/vendor-official/<vendor>/`，带原文和出处。

**主人文件名单**：27 个文件名，从 `model-catalog.json`、`project.json` 到 `vendor-preference.json`（E/census.sh 的 NAMES）。批 1 改成由各主人模块导出、锁读同一份，不再手写第二份。另有一份一致性测试：在探针里跑产品全部写路径，产品写了名单外的 JSON 就红。

**全部家**（工具出，命令见 §普查命令）：

| 家 | 今天几份 | 「1」靠什么保持 |
|---|---|---|
| 测试手写主人存盘文件 | 单测 84 份；走查侧 217 份（提示级） | 只认主人：写的那一刻核调用栈 |
| 假桥 | 换模块 66 份；装假 `window.nomiDesktop` 13 份，且探针漏 8 份；设计实验室 14 份；产品直读 4 处；另有约价线的一份共享假桥 | 只认主人：`getDesktopBridge` 用的那一刻核；换掉桥模块这条路归 C' |
| 换掉主人导出（mock / spyOn / 直接改命名空间） | vi.mock 132 份是静态下限（E/vimock-owner.out）；vi.spyOn 5 份（E/spyon-owner.out）；直接 `Object.defineProperty` 改命名空间 0 份已知，但探针证实能绕 | spyOn 和直接改命名空间：结构上做不出来（冻结主人命名空间，探针验过）；`vi.mock` / `vi.doMock`：只剩一扇门，运行时拦（探针验过） |
| 静态模型表 | 109 张、217 份文件写了手写行 | 做不到，见下 |
| 测试专用宿主 | 8 个 TestUtils、102 份引用 | 只认主人，靠 #1590 的发证登记（装配第 2 刀） |
| 注入自己的读写函数 | 26 个产品端口、123 份文件、279 处；宿主和走查层 19 份；走查换 ipc 3 份；`mainRequire` 预载 20 份 | 走查和宿主层只认主人；单测层做不到 |
| 假供应商 | 自建 http 146 份、stub fetch 54 份、手写回答的夹具 1 套 | 出口对拍，缺录制回答；自建服务冒充做不到 |
| 界面文字定位 | 字面定位 365 份 | 运行时拦一部分；位置定位做不到 |

没有靠「东西不见了」去猜意图：锁只看写的人是谁，不看内容。

## ★3 以前定过什么、三条路

**以前定过的，都还算数**：
- D-1121-test-world-owner-only：本卡依据。
- D-1121-retro-rules-adopt：证明只认三种，扫描只算提示。
- D-1116-unwritable-first：先让第二个家写不出来，再收。
- D-1117-homes-in-parallel、D-1116-pause-and-full-inventory：全部家用工具普查。
- D-1031-old-users：旧版真实数据是合法出口。
- D-1121-1573-structural：入口只收主人读口，是同类机制先例。
- D-1121-assembly-test-copies-cut2：TestUtils 归第 2 刀，本卡只引用。
- D-1030-release-cadence：不单独发版。
- D-1118-creator-view-testing。
- D-1121-board-pause：#1586 不发东西。

**三条路**：
- **沿原方向修**：红一份改一份。两次成批事件证明这条路一定返工：13 份改了又撤；9 份红了 8 份，三条线去查（R:33）。
- **换一种做法：世界由主人造 + 写的那一刻拦（选这条）**：主人一改，世界自动跟上；新手抄写不进去。
- **删掉**：只适合没人认领、到期的红（丙），全删会丢覆盖。

所以选「乙为主干 + 丙」，和 R 的推荐一致。

**复用，不新写**：
- #1590 的发证登记：品牌类型 + WeakSet + 测试只在 setup 里开发证口。
- `_mcpL2Fixture.mjs:122` 已经用 `applyBuiltinSeeds` 造目录，但最后还是自己落盘，要改成主人落盘。
- 旧数据生成器 `tests/fixtures/old-user-data/generators/`。
- `officialWire.known-red.json` 的两头冻结。
- `vitest.config.ts:37 OTHER_LANES` 的「登记必有 runner」。
- 夜跑汇总已有的逐条状态（`scripts/nightly-walk-summary.mjs`）。
- 开工雷达的夜跑行（`scripts/daily-radar-session.mjs:141`）。

**自写**：锁是测试设施，不进产品；通用部分（fs 打补丁、Proxy）都是标准库能力，不引新依赖。

## ★4 全状态（对写测试的人和看夜跑的人）
- **空**：新测试什么都不声明，`buildWorld({})` 给出默认世界：内置种子、一个空项目、默认设置。
- **成功**：主人造出世界，锁放行。
- **被拦**：报错第一行是错误码加文件名，第二行点名该走的门（原文见 §新测试入口）。
- **还没迁**：文件在冻结名单里，锁对它只记不拦。名单比记录模式的结果多了或少了，CI 都红。
- **夜跑**：
  - 全绿。
  - 红但在名单里：不吵，到期前照跑。
  - 名单外新红：作业当晚就红，汇总点名，开工雷达行显示，24 小时内要被认领（进名单或修）；第二晚没人认，自动开空 owner 的进名单 PR，不填人合不进。
  - 过期：作业红，并自动开删除 PR。
  - 超上限：作业红。
  - 名单里的变绿了：作业红，提示从名单删。
- **能力不可用**（缺真素材 / Key / 登录）：不进夜跑，必须在排除表里写 runner 和周期，没写就选择表单测红。
- **取消中 / 部分成功**：夜跑批被掐（R:41 有 4 次 90 分钟超时），这时汇总按「没跑」算，不算恢复。今天的汇总会把掉的批算成恢复（R），丙一起修。

## 各类表（删什么、谁顶替、写不出来的机制、反例、不误伤样本、合法出口）

### A 存盘格式：模型目录、项目、设置等 27 个主人文件；单测侧和走查侧同一把锁
| 项 | 内容 |
|---|---|
| 删什么 | 单测里 84 份自己写主人文件的手写世界：第一帧就是测试的 81 份（model-catalog 38、project 31、provider-adapters 6、project-location 3……，E/world-probe.out），加上直接拿存盘原语写的 3 份（`electron/durability.test.ts`、`electron/runtimePaths.test.ts`、`electron/parity/modelListingParity.test.ts`，E/world-probe2.out）；走查侧 217 份里的手写 JSON（目录 83、项目 158，提示级）；`_mcpL2Fixture.mjs` 自己落盘那一步；`launchNomiApp` 的 `settingsDir`、`projectsDir` 参数（`tests/ux/_launchApp.mjs:668`）；`uiDriverOptions.mjs:25` 手写的旧数据名册 |
| 谁顶替 | `tests/world/buildWorld(spec)`：调主人函数造世界，返回世界句柄；`launchNomiApp({ world })` 只收句柄 |
| 机制 | **只认主人**：单测 setup 和走查启动器都给 `node:fs` 的写 API 打补丁，并调 `syncBuiltinESMExports`，覆盖 write、append、copy、cp、rename、promises 各型。写到主人文件名时核调用栈，看的是「谁调进了产品」（直接调用者规则）：从写的那一帧往外走，先是一段连续的产品帧，再往外那一帧就是调用者。拦三种情况：①第一帧就是测试代码（测试自己写）；②调用者是测试，产品段最外层是存盘原语 `jsonFile.ts` 或 `configFileStore.ts`（测试拿原语写手写内容）；③调用者是测试，产品段最外层是这个文件的主人写口，而测试既不在 `tests/world/` 也不在主人自己目录（越过造世界入口直调主人）。另外放行旧数据和坏数据两个出口。测试驱动 IPC、服务、迁移这类产品代码、由产品自己去写的，一律放行。每个文件名的主人写口不手写，由记录模式算：哪个产品模块调了原语写它。探针里 `project.json` 由 `electron/workspace/workspaceManifestTransaction.ts` 写，`model-catalog.json` 还有 `electron/settings/sideBySideInstallSeed.ts` 这第二个产品写入者（E/world-probe2.out 那次统计）。**去料**：启动器不再收目录参数，测试拿不到「自己指一个手写好的目录」的原料。启动和重启时还核一份哈希清单，造完世界后到启动前有人改过文件，就拒绝启动 |
| 证明档 | 手造文件这条路：只认主人 + 去料。换掉主人导出这条路归 C'（mock 掉 `readCatalog` 的测试根本走不到写盘锁）：spyOn、改命名空间结构上做不出来，`vi.mock` / `vi.doMock` 是运行时拦。按开头的分档，整类只差 `vi.mock` 这一扇门，不算完整的写不出来 |
| 反例 | `fs.writeFileSync(.../model-catalog.json)` → 拦；`writeJsonFileAtomic` 直调 → 拦；`cpSync` 一个含 `project.json` 的目录 → 拦（cp 补丁递归核目的树）；非主人目录的测试调 `mutateCatalog` → 拦（最近的测试侧帧不合格） |
| 不误伤样本 | 按直接调用者规则离线重判 248 份：放行 49 份，例 `electron/catalog/catalogPackagePortability.test.ts`、`electron/settings/assetRelaySettings.test.ts`（E/world-probe2.out）。上一版只看第一帧时放行 52 份，多出的 3 份就是上面直接拿原语写的。初稿规则要求「最近的测试帧必须在主人目录」，会误拦主人目录外驱动产品代码的集成测试，已弃 |
| 合法出口 | (a) `seedOldUserData(id)`：只读 `tests/fixtures/old-user-data/<id>`，那里的数据是旧版真函数生成的（README 和 generators 为证）；仓库里旧数据目录以外提交的主人文件名 JSON 是 0 份（`git ls-files` 核过）。(b) `damageWorldFile(world, file, kind)`：只收主人已经产出的文件，坏法只能从具名清单挑（截断、坏 JSON、删字段、改类型、空文件、BOM），不收内容参数。两个出口都由锁按函数帧认，在别处调没用：锁只认这两个帧。会被拦的 84 份里，提到旧数据或迁移的 11 份是出口候选，逐份核，只有真读旧数据的才走 (a) |
| 做不到 | 子进程写（python、shell 的 cp），以及 app 运行期间别的进程写：单测侧没有清单兜底，只能扫描提示。主人目录下的测试仍可调 `mutateCatalog` 改出主人正常流程造不出的形状，因为主人自己的测试本来就要测这个口，这一处只能靠评审 |

### B 假桥：`window.nomiDesktop` 和 `desktop/bridge` 模块
| 项 | 内容 |
|---|---|
| 删什么 | 换掉桥模块的 66 份；装假 `window.nomiDesktop` 的 13 份，加上探针漏掉的 8 份；产品里 4 处直读（`src/ui/app-shell/shell/ShellFrame.tsx:30`、`src/ui/app-shell/shellGeometry.ts:19`、`src/utils/startupDiagnostics.ts:50`、`src/workbench/generationCanvas/components/useCanvasShortcuts.ts:419`；研究里算的第 5 处 `extractVideoFrameToNode.ts:2` 只是注释）；设计实验室自己装假桥的 14 份（`git grep -l nomiDesktop -- 'src/devlab/*'`，都用 `window as unknown as` 强转，删全局声明拦不住它们，要改用 `desktopBridgeForTest`）；`src/desktop/bridge.ts:425` 每次都现读 `window.nomiDesktop` 的那一行；`src/workbench/generationCanvas/nodes/composerBridgeTestUtils.ts`（今天还在 `origin/feat/cost-step1-estimate` 上，按字符串键回答，不受 `DesktopBridge` 类型约束）。它今天被 3 份测试引用，共 6 处（`git grep -c composerBridgeTestUtils origin/feat/cost-step1-estimate`：`composerKeepsAspect`、`composerMountBudget`、`composerOriginNeedsVideo`），合入前可能还会变多，批 3 开工时重数一次 |
| 谁顶替 | `tests/world/bridge.ts` 的 `desktopBridgeForTest(world, overrides)`，用 `satisfies DesktopBridge` 写出，再配一份对真 preload 对象的一致性测试；设计实验室也用它 |
| 机制 | **只认主人**：`getDesktopBridge()` 每次被调都核对象是否在「已发证」WeakSet 里。登记不能放在 preload：`exposeInMainWorld` 交给页面的是隔离世界复制过来的对象，preload 的 WeakSet 页面看不见。所以照 #1590 在渲染端入口 claim-once：入口第一行把 `window.nomiDesktop` 认领为唯一发证对象，之后 `getDesktopBridge` 只返回认领过的对象，不再现读 window。同一对象每次读是否同一引用：未验证，批 3 在真窗口核一次。测试 setup 先占住发证口，产品入口就认领不了，测试只能经 `desktopBridgeForTest` 拿桥。**去料**：`Window` 的全局声明里删掉 `nomiDesktop`（`src/desktop/bridge.ts:419`），产品代码类型上读不到它，只剩 `getDesktopBridge` 一扇门。模块 mock 由 C' 的 mock 锁拦 |
| 证明档 | 只认主人 + 去料 |
| 反例 | 测试直接 `window.nomiDesktop = {…}` → 第一次用时抛 `desktop_bridge_not_issued`；`vi.mock('@/desktop/bridge')` → 登记那一刻抛错（探针 3/3）；`vi.spyOn(bridge, 'getDesktopBridge')`（今天 `src/workbench/taskCenter/taskCenterSettings.test.ts:13` 就这么写）→ 抛错（探针 2/2）；`Object.defineProperty(bridge, 'getDesktopBridge', …)` → 冻结前能绕、消费方拿到假的，冻结 `bridge.ts` 命名空间后抛错、消费方仍拿真的（E/mock-probe/freeze-off.json、freeze-on.json），归 C'；产品新写 `window.nomiDesktop.x` → tsc 红 |
| 不误伤样本 | 只 stub window、不碰桥的 32 份，0 误认（E/bridge-probe.out） |
| 合法出口 | 只有 `desktopBridgeForTest`。故障注入走 `overrides` 里具名的 `fault(kind)`，不收任意函数 |
| 做不到 | 本类自身无。探针漏的 8 份正说明「看装没装」不行，必须「用的那一刻核」。整类和 A 一样只差 `vi.mock('@/desktop/bridge')` 这一扇门是运行时拦（归 C'） |

### C' 换掉主人导出：`vi.mock`、`vi.doMock`、`vi.spyOn`、直接改命名空间
| 项 | 内容 |
|---|---|
| 删什么 | `vi.spyOn` 打主人命名空间的 5 份（E/spyon-owner.out）；目标是主人模块的 mock：静态数 132 份是下限（桥 66、目录 28、项目 27、目录读口 12、设置 10、存盘原语 2，E/vimock-owner.out）。运行时探针在 30 份对照里又认出 2 份静态正则漏掉的相对路径 `./catalogStore`（E/mock-probe/record.out），所以真数更多，以批 1 记录模式为准 |
| 谁顶替 | 同 A、B：世界由 `buildWorld` 造，桥由 `desktopBridgeForTest` 给 |
| 机制 | **四扇门，两扇运行时拦、两扇结构上做不出来**：①②setup 里包住 `__vitest_mocker__.queueMock`，`vi.mock` 和 `vi.doMock` 都经这里（vitest 4.1.8 `node_modules/vitest/dist/chunks/test.DNmyFkvJ.js:3569`、`:3578`），按 importer 解析路径，目标是主人模块就抛 `owner_module_mock_refused`。探针：认出 30/30，抛错后 3/3 文件红，对照 0 误认。③包住 `vi.spyOn`，目标是主人模块命名空间就抛。探针：5/5 份 spyOn 主人的认出并红，对照 5 份 0 误认（E/mock-probe/spy.out）。主人模块用自己导出的标记常量声明身份，名单不手写（设计，没探：探针认主人用的是手写导出名单）。④直接 `Object.defineProperty(命名空间, …)`：今天能绕，消费方拿到的是假的（E/mock-probe/ns-define.json、freeze-off.json）。**堵法：主人模块在测试时冻结自己的命名空间**（模块末尾自引用后 `Object.freeze`）。探针在 `bridge.ts` 末尾手加这两行（E/mock-probe/freeze-on.json）：`defineProperty` 抛 `Cannot redefine property`，消费方仍拿真的；`vi.spyOn` 抛 `Module namespace is not configurable`；`vi.resetModules` 之后新对象仍冻结；同文件 spyOn、mock 非主人模块照常。冻结后 ③④ 两扇门都是结构上做不出来，③ 的 spyOn 包装可以不要。正式做法由 vitest 转换插件给带标记导出的主人模块末尾注入这两行，只在测试时注入，不进产品构建；插件本身没探，批 1 第一步做 |
| 证明档 | ③④ 结构上做不出来（冻结）。①② 运行时拦，单门，靠的是 vitest 内部接口。升级 vitest 时由一份元测试兜底：固定夹具 mock 桥、改桥命名空间，必须红，不红就是门换了 |
| 反例 | `vi.mock('./catalogStore')` → 拦；`vi.doMock` → 拦；`vi.spyOn(projectRepository, 'saveProject')` → 拦（探针）；`Object.defineProperty(bridge, 'getDesktopBridge', …)` → 冻结前能绕，冻结后抛错（探针） |
| 不误伤样本 | 只 mock 非主人模块的 28 份对照、只 spyOn 非主人命名空间的 5 份对照，0 误认。冻结 `bridge.ts` 后碰桥、不换桥的 32 份 686 条全绿；冻结 `catalogStore.ts` 后 `electron/catalog` 186 份 4498 条全绿（E/mock-probe/freeze-on-wide.log、freeze-on-catalog.log） |
| 合法出口 | 无（主人模块不许假） |
| 做不到 | `vi.mock` / `vi.doMock` 换掉主人模块：只能在登记那一刻抛错（运行时拦，单门），找不到结构上的办法，因为 mock 换的是模块登记表里的整个模块，消费方拿到的就是假的，主人自己的核对也一起被换掉。A、B、D 都只差这一扇门。要协调定：单门、登记即抛、由元测试守住门没换，这一档算不算写不出来 |

### C 静态模型表：手写模型行，喂给纯函数
| 项 | 内容 |
|---|---|
| 删什么 | 109 张表、217 份文件里的手写行（`modelKey:` 字面）。其中 24 张同时也读主人，按区：src/workbench 22、electron/catalog 17、tests/ux 15、electron/providerAdapter 15 |
| 谁顶替 | `tests/world/rows.ts` 的 `worldRows(spec)`：先 `buildWorld`，再经主人读口（`readCatalog` 或主人桥）取行 |
| 机制 | **做不到写不出来**。模型行是值，不是句柄：主进程和渲染端之间走结构化克隆，产品里也大量 map 和展开复制，身份核不住，WeakSet 这条路不通。最强能做到：①去料，A 和 B 落地后，测试里经产品读口拿到的行只会是主人造的；②纯函数的参数换成品牌类型，tsc 自动拦对象字面，但 `as unknown as` 强转只能靠扫描，算提示 |
| 证明档 | 去料（只覆盖经读口的那一半）+ 提示 |
| 反例 | 写 `[{ modelKey: 'x', … }]` 直接传给纯函数 → 不拦，照实列为缺口 |
| 不误伤样本 | 已经经主人读口取行的 24 张表（E/static-model-tables.txt 里同时读主人的） |
| 合法出口 | `worldRows`；测旧数据形状走 `seedOldUserData` 再读 |
| 做不到 | 纯函数层手写行。要用户定：接受「类型拦 + 扫描提示」，还是规定纯函数单测一律经 `worldRows`、由评审看。纯函数到底有多少个消费方没量：未验证，缺量具，要跑 door-map |

### D 测试专用宿主：8 个 TestUtils（引用装配第 2 刀，不另设计）
| 项 | 内容 |
|---|---|
| 删什么 | `electron/capabilityCore/{agentPanelSpendConfirm,canvasShot,externalAgentGate,resultLanding}TestUtils.ts`、`electron/parity/generationParityTestUtils.ts`、`electron/productionRun/{landFirst,productionGenerationAuthorization}TestUtils.ts`、`src/workbench/api/canvasResendDecideTestUtils.ts`，102 份引用（E/census） |
| 谁顶替 | `createGenerationDomain` 工厂 + 真盘夹具（D-1121-assembly-test-copies-cut2，#1590 第 1 刀卡 :164–166、:223–225、:366–369） |
| 机制 | **只认主人**：`assertIssuedGenerationPlanning` 用的那一刻核 WeakSet，测试只能在 `tests/setup/generationPlanningTestIssue.ts` 里开发证口（#1590）。**去料**：TestUtils 同提交删掉 |
| 证明档 | 只认主人 + 去料 |
| 反例 | **把工厂改坏成永远「没就绪」，CI 上的测试必须红**。今天不红：`externalAgentGateTestUtils` 和 `agentPanelSpendConfirmTestUtils` 绕开了工厂（协调 11-21 实测）。新写一个 TestUtils 手接宿主 → 用的那一刻没证，抛 `generation_planning_not_issued` |
| 不误伤样本 | 走工厂的 vitest 测试（第 2 刀定） |
| 合法出口 | `issueGenerationPlanningForTest`，只在 setup 里开 |
| 做不到 | 本类自身无，前提是 #1590 合入、第 2 刀做完；和 A、B 一样只差 `vi.mock` 换掉 `generationDomain` 这一扇门是运行时拦（归 C'） |

### G 注入自己的读写函数
| 项 | 内容 |
|---|---|
| 删什么 | 宿主层和走查层手写的读写替身，19 份 26 处（E/injected-own-fakes-host-files.txt：productionRun `*.e2e.test.ts`、TestUtils、集成测试）；走查直接换 `ipcMain` 处理器的 3 份（`tests/ux/library-load-error.walk.mjs:55`、`_storyboardAgentBulkSteps.mjs:15`、`_promptLibraryReadGate.cjs`）；`mainRequire` 预载 20 份里给产品或 ipc 打补丁的 5 份 |
| 谁顶替 | 宿主层走工厂（D）；故障走 `tests/world/faults` 的具名 `faultAt(channel, kind)` |
| 机制 | 走查层**只认主人**：`launchNomiApp` 的 `mainRequire` 只收登记表里的预载（静音、网络守卫、凭据存储、具名故障），表外直接抛错，换 ipc 只能经 `faultAt`。宿主层同 D。单测层 26 个 DI 端口：**做不到写不出来**，因为依赖注入本身就是设计 |
| 证明档 | 走查和宿主层：只认主人。单测层：出口对拍，只能保证「至少有一份测试跑真装配」，挡不住别的单测手写替身 |
| 反例 | 走查 `mainRequire` 塞一个自写 cjs → 启动器拒；单测给 `ProjectsIpcDeps` 塞手写 `readProject` → 不拦。反馈日志尾巴逃逸就是这个形状 |
| 不误伤样本 | 网络守卫、静音预载（登记在册） |
| 合法出口 | `faultAt`；单测层每个端口登记一份「真装配测试」，端口表在 E/injected-own-fakes-ports.tsv，选择表单测核每个端口都有一份 |
| 做不到 | 单测层手写替身。要用户定：接受「每端口一份真装配测试」这一档 |

### F 假供应商（外部边界，不是自己的东西，但回答要和真的对拍）
| 项 | 内容 |
|---|---|
| 删什么 | `startFakeApimartServer` 手写的回答（`tests/ux/_mcpL2Fixture.mjs`，如 `{ url: … }`）；单测 stub `fetch` 的 54 份 |
| 谁顶替 | 回放服务和 `networkTransport` 替身只按录制 id 回答：`tests/fixtures/vendor-official/<vendor>/responses/*.json`，每份带原文、出处、`fetchedAt`、重录期 |
| 机制 | 替身的 API 只收录制 id、不收回答体，类型上写不出手写回答，算**只认主人**。`vi.stubGlobal('fetch')` 在 setup 里拒（同探针包 `stubGlobal` 的办法）；`vi.mock` 的 appFetch 由 C' 拦。到期重录，按出口对拍 |
| 证明档 | **还没做到**：回答侧录制 0 份。协调 11-22 定了来源：①先用官方文档示例，免费，每份带原文和出处；②文档没给回答外壳的模型再真调录制，一次只录一个原型，先报真实花费，再批量。按出口对拍算 |
| 反例 | 测试自起 `createServer` 冒充供应商、把 baseUrl 经主人 API 指过去 → 不拦。自建 http 有 146 份，多数是正当用途（素材下载、本机服务），分不开 |
| 不误伤样本 | 我们自己的服务（反馈 worker）在进程内跑真处理器 |
| 合法出口 | 录制回答；中转和自定义供应商按通用 OpenAI 协议官方文档示例 |
| 做不到 | 自建服务冒充供应商，只能靠夜跑网络守卫白名单提示 |

### E 界面文字定位
| 项 | 内容 |
|---|---|
| 删什么 | 字面文字定位（E/ui-text-census.out）：`getByText` 259 处 / 113 份、`getByRole name` 763 / 223、`getByLabel` 等 53 / 25、`hasText` 193 / 118、`text=` 50 / 26、`toContainText` 等 266 / 74，共涉及 365 份。其中 50 份已混用 `uiText` |
| 谁顶替 | `ui('key')`（经 `uiText` 读词典）；真正的内容文字（用户输入、模型名）用 `content('…')` |
| 机制 | **运行时拦一部分**：启动器返回的 page 和 locator 用 Proxy 包住，文字类定位只收 `ui()` 或 `content()` 包过的值。`content()` 的值等于某条词典文字时抛 `ui_text_literal`。**未验证：没跑探针** |
| 证明档 | 运行时拦，只覆盖经启动器的 page |
| 反例 | 部分匹配：`getByText(/生成/)` 或 `'生成'` 只是更长词典句的一段 → 未验证，批 2 第 1 片先做探针；`page.evaluate(() => document.body.innerText…)` → 不拦；`expect(await el.textContent()).toBe('生成')` → 不拦；不经启动器的 111 份（528 − 417，E/walk-world-writers.out）→ 不拦 |
| 不误伤样本 | 只用 `uiText` 的 76 份 |
| 合法出口 | `content()`，只收非词典文字 |
| 做不到 | 位置定位（`nth(n)` 68 / 30、数字坐标点击 13 / 13）只能扫描提示；evaluate 和取文字后自己比，也做不到。要用户定：接受这一档 |

## 丙 夜跑信号：已知红名单（两头冻结、有上限、过期即删）

- **名单文件**：`tests/ux/nightly-known-red.json`，放在仓库里，不放 issue 正文。今天 #1121 正文每晚被覆盖（R）。每条有这些字段：`path`、`owner`（线或人名，不许写「协调分诊」）、`due`（≤ 登记日 + 7 天）、`reason`、`issue`。
- **上限**：8 条（Fowler）。
- **启动期**（一次性，到期自动消失）：今天每晚红 133 条，三晚都红 66 条（R:42–43），8 条装不下。所以丙第一天逐条定「修 / 删 / 进名单」。属于世界走散的，`owner` 写对应迁移批，`due` 取「该批合入 + 3 天」和绝对日期 2026-12-21 里更早的那个（R 的复查日）。批次拖了也照样到期，不占 8 条上限，但同样两头冻结、只减不增。最后一批合入那天，这个启动期字段跟着删。
- **对差脚本**：放进 `scripts/nightly-walk-summary.mjs`（已有逐条状态和 `mergeState`）。每晚算四样：名单外新红、过期条目、名单里变绿的、名单长度。**作业结论由它定**：名单外有新红、超上限、有过期、名单里有变绿的，作业都红。名单内的红不让作业红，所以作业绿就是真绿。这是和前三次最大的不同。
- **谁认名单外新红、何时**：当晚汇总点名；开工雷达那一行（`scripts/daily-radar-session.mjs:141`）在协调会话开工时显示。新红当晚作业就红。协调 24 小时内认领：要么开 PR 进名单（写 owner 和 due），要么派修。第二晚还没人认，作业自动开一个「进名单」PR，`owner` 和 `due` 留空，名单格式单测拒绝空 owner，所以这个 PR 不填人合不进去，作业每晚继续红。没人认领的新红不自动删，因为它可能真抓到了产品回归；自动删只给过了期的名单条目。
- **过期怎么删**：夜跑作业自动开 PR，删测试文件和名册里对它的引用，协调合并。这是机械删除走 PR，符合 P1。用户已拍板「到期没修就删」。
- **缺前提的**（真素材、Key、登录）：从夜跑拿出，进排除表 `tests/ux/nightly-ci-exclusions.json`。排除表每条加 `runner` 和 `cadence` 两个字段，照 `OTHER_LANES` 由单测核 runner 存在。
- **哪里都不跑的**：走查 36 + e2e 68 + probe 4 = 108（E/runs-nowhere.out、E/e2e-mentions.out）。夜跑选择从只选 `.walk.mjs` 改成选全部顶层可跑脚本（walk、e2e、probe），剩下的必须在排除表里有 runner，否则选择表单测红。丙第一天逐条处理：挂进去，或删。`mcp-declared-model-gate.e2e.mjs` 在「没人提」里；`mcp-headless-unknown-outcome.e2e.mjs` 只在 #1590 分支上，合入时一并进选择。
- **比前三次多了什么**：

| 那次 | 为什么没好 | 丙多出的机制 |
|---|---|---|
| 11-09 分诊 150 条 | 一次性分诊，建议没人执行，「待定项尚未定责」（`R-nightly-red-triage.md`） | 每条红必须有 owner 和 due 才进名单，进不了就过期删 |
| 11-16 开工雷达加夜跑提醒 | 只是一行字，没有主人和到期（`I-nightly-red-at-session-start.md`） | 汇总定作业结论，红在作业上，不只在一行字里 |
| 11-18 盘点 443 条，删 0 | 删除要层层批，「A5 删 0（4 委派、1 引用超范围）」（`L-test-iteration.md`） | 到期自动开删除 PR，删除这件事不再等人想起 |

## 批次与并行（按会改哪些文件分组）

走查侧 A × E 共有 140 份文件（E/overlap.out），所以走查侧是**一条流**：每份文件 A、E、F、G 一次迁完，按文件清单分片。单测侧按批算（含各批要迁的 mock 文件，E/batch-overlap.out）：批 3 × 批 4 重叠 4 份，3 × 5 重叠 12 份，4 × 5 重叠 15 份。共享文件归编号小的批，由它把这份文件里各类一次迁完，另外两批不碰它，所以 3、4、5 能并行。批 6、7 要等前提（第 2 刀、录制），和它们共享的文件（3 × 6 有 11 份、4 × 6 有 8 份、5 × 6 有 12 份）由前面的批只迁自己那类，6、7 开工时前面已合入，再动同一份文件不冲突。

「还没迁」名单是冻结名单，跟它的锁同批上线。写盘锁和换导出锁在批 1 上线，各带一份名单：换导出锁一开就碰到批 3–6 的 mock（含 D 装配的 mock），不带名单会把这些还没迁的文件一下打红。桥锁在批 3 上线，和桥共享的文件都归批 3、一个 PR 迁完，所以不带名单；批 1 到批 3 之间新写的装假 window 测试没人拦，批 3 开工时重数一并迁。名单放在 `tests/world/not-yet-migrated/<锁>.json`，由锁的记录模式生成，CI 核它和记录结果一致。只减不增，新文件进不去，所以新测试从锁上线第一天就写不出来。每类最后一批同提交删掉该类的名单。

| 批 | 碰的文件 | 删除清单 | 机制 | 验收判据 | 规模 | 能否并行 |
|---|---|---|---|---|---|---|
| 0 丙 | `scripts/nightly-walk-{selection,summary}.mjs`、`.github/workflows/nightly-walkthroughs.yml`、`tests/ux/nightly-known-red.json`（新）、`nightly-ci-exclusions.json`、被删的测试文件 | 到期或无人认领的红；哪里都不跑又不挂的 | 作业红 = 名单外新红 / 超上限 / 过期 / 名单里变绿；选择表单测；名单格式单测拒空 owner | 反例四条各让作业红；108 份「哪里都不跑」降到 0 | 1 天 | 与 1 并行（被删的走查不进批 1 清单） |
| 1 地基 + 目录走查 | `tests/world/*`（新）、`tests/setup/world.ts`（新，用 `import.meta.glob` 收 `tests/setup/world/*.ts`，之后各批只加文件不改它）、`tests/setup/world/{fsLock,exportLock}.ts`（新，写盘锁和换导出锁）、`vitest.config.ts` 一行、`tests/ux/_launchApp.mjs`、`ui-driver.mjs`、`uiDriverOptions.mjs`、`_mcpL2Fixture.mjs`；走查：`bd40dc0b5` 那 13 份 + #1560 那 9 份 + 其余手写目录的 tests/ux 文件（catalog-writers：hand-only 31） | A 的走查侧目录部分；启动器目录参数；手写旧数据名册 | A 写盘锁（单测 + 走查）+ C' 换导出锁（`queueMock` 单门 + 冻结主人命名空间的转换插件）+ 两份冻结名单 + 出口 (a)(b) | **回放**：在分支上把目录版本升一档，照 `bd40dc0b5`；再按 #1560 前后的规则各跑一遍。预测：0 份翻红、0 份要改。**基线**：升版要改 13 份；#1560 同形状 9 份 8 红（R:33）。**判据同时要求**这 22 份文件仍在、仍被夜跑选中（`node scripts/nightly-walk-selection.mjs` 列得出），删测试换来的 0 红不算 | 2–3 天 | 与 0 并行 |
| 2 走查流 | tests/ux 走查侧其余文件，按清单分 2–3 片，片间文件不交 | A 走查剩余、E 字面定位、F 走查侧回答、G 走查 `mainRequire` 和 ipc 换手 | E 的 Proxy（第 1 片先做部分匹配探针）、`mainRequire` 登记表、`faultAt` | 每片：冻结名单相应条目删掉；E 反例表逐条有结果 | 每片 2 天 | 片与片可并行；与 3、4、5 并行 |
| 3 假桥 | `src/desktop/bridge.ts`、渲染端入口、4 个直读产品文件、`tests/world/bridge.ts`、设计实验室 14 份、桥 mock 66 + 假 window 21 份 + spyOn 桥 1 份 | B 全部；`composerBridgeTestUtils.ts` 和引用它的测试（今天 3 份、6 处，开工时重数），在 `desktopBridgeForTest` 的同一个提交里删掉 | B（发证认领 + 删全局声明） | 反例表 B 全红；对照 32 份 0 误认 | 2 天 | 与 2、4、5 并行（和 4 共享 4 份、和 5 共享 12 份，都归 3） |
| 4 存盘单测侧 | 写盘锁拦下的 84 份 + 目录、项目、设置、原语的 mock 67 份 + spyOn 主人 3 份 | A 单测侧；写盘和换导出两份冻结名单里本批的条目 | A、C' 的锁已在批 1 开 | 冻结名单删光 | 2–3 天 | 与 2、3、5 并行 |
| 5 静态模型表 | 109 张表所在文件 + 目录读口 mock 12 份 + spyOn 目录读口 1 份 | C 能去的部分 | `worldRows` + 品牌类型 | 经读口的表全部改成 `worldRows`；纯函数层按用户定的档 | 2 天 | 与 2、3、4 并行（和 4 共享的 15 份归 4） |
| 6 宿主 + 注入 | 8 个 TestUtils + 102 份引用 + G 宿主层 19 份（和 D 重叠 12 份，所以同一条线做） | D、G 宿主层 | 第 2 刀 | **改坏工厂，CI 上的测试会红** | 依第 2 刀 | 等 #1590 合入和第 2 刀；与 2–5 文件不交的部分可并行 |
| 7 假供应商 | `networkTransport` 替身、回放服务、54 份 stub fetch、`vendor-official/*/responses/` | F | 录制 id + 重录期 + 拒 `stubGlobal('fetch')` | 回答全部带出处；到期重录有作业；真调录制的每个原型先报真实花费 | 先用文档示例，缺的逐个原型真调 | 放最后，不挡批 0–6 |

并行上限：同一时刻最多 4 条写的线。批 2、3、4、5 同时跑，正好 4 条（记忆「≤4 写线」）。批 0、1 两条先跑。总共 8 批。

## 新测试入口（放哪、叫什么、老写法碰到的报错）
- `tests/world/index.ts`：`buildWorld(spec)`、`seedOldUserData(id)`、`damageWorldFile(world, file, kind)`、`worldRows(spec)`。
- `tests/world/bridge.ts`：`desktopBridgeForTest(world, overrides)`。
- `tests/world/faults.ts`：`faultAt(channel, kind)`。
- 走查用 `launchNomiApp({ world })`。

所有报错第一行是错误码，第二行点名入口：
- `world_file_hand_written: <路径> 属于 <主人模块>。测试世界只能经 tests/world 的 buildWorld(spec) 造；测旧版数据用 seedOldUserData('<目录名>')；测坏数据用 damageWorldFile(world, '<文件>', '<坏法>')。见 docs/plan/2026-11-22-test-world-owner-only.md「新测试入口」。`
- `desktop_bridge_not_issued: 这个桌面接口不是主人发的。测试用 tests/world/bridge.ts 的 desktopBridgeForTest(world)；产品代码只经 getDesktopBridge()。`
- `owner_module_mock_refused: <模块> 是主人模块，不许 mock。造世界用 buildWorld，桥用 desktopBridgeForTest，故障用 faultAt。`
- `launch_option_removed: settingsDir / projectsDir 已删。传 world: await buildWorld(spec)。`
- `main_require_not_registered: <文件> 不在预载登记表里。故障注入用 tests/world/faults.ts 的 faultAt。`
- `ui_text_literal: 「<文字>」是词典里的界面文字，用 ui('<key>')。真正的内容文字用 content()。`
- `generation_planning_not_issued`：沿用 #1590 原文。

## 普查命令（都能重跑；在仓库根目录跑，输出写进 E）
- `bash E/census.sh <repo>`：总表（E/census.out）。
- `python3 -I E/catalog-writers.py <repo> E`：目录写入者分档。
- `python3 -I E/ui-text-census.py <repo> E`：界面文字定位。
- `python3 -I E/injected-own-fakes.py <repo> E`：注入替身。
- `python3 -I E/spyon-owner.py <repo> E`：spyOn 主人命名空间。
- `python3 -I E/batch-overlap.py E`：按批算的重叠。
- `python3 -I E/runs-nowhere.py <repo> E`：哪里都不跑。
- `python3 -I E/e2e-mentions.py <repo> E`：只在名册里的 e2e。
- `python3 -I E/vimock-owner.py <repo> E`：mock 主人模块。
- `python3 -I E/walk-world-writers.py <repo> E`：走查侧写盘。
- `python3 -I E/overlap.py E`：批次间的文件重叠。
- 探针分析：`python3 -I E/world-probe-analyze.py <repo> E`、`python3 -I E/world-probe2-analyze.py <repo> E`（三种规则对比）、`python3 -I E/bridge-probe-analyze.py <repo> E`、`python3 -I E/mock-probe/analyze.py <repo> E/mock-probe record.jsonl`、`python3 -I E/mock-probe/spy-analyze.py <repo> E/mock-probe spy.jsonl`（重出 spy.out）。探针本体跑完已删。批 1 把写盘和 mock 两个探针做成锁的记录模式进仓库，这些数以后由仓库里的命令重跑。

## ★9 验收清单与反例（实现线按它自验，验收线只核它）
- 每类的反例行逐条要有「反例 → 结果 → 证据」。判据是「用的那一步信不信」，不是「这种写法被认出来没有」。
- 「什么都不做」必须通不过：锁关掉时，各类反例要能写进去、测试照绿。验收线先关锁跑一遍，确认反例真能绕过，再开锁。
- 「全部拦下」也必须通不过：A 的 49 份、B 的 32 份、C' 的 28 + 5 份不误伤样本必须绿；只读旧数据的迁移测试必须绿；主人目录外驱动产品代码的集成测试必须绿。
- 部分匹配、子进程写、冻结命名空间的转换插件（探针是手改模块末尾，不是插件）这三处，要么交出验证结果，要么明写「未验证」，不许默认算拦住了。A、B、D 报的时候照实写「只差 `vi.mock` 一扇门是运行时拦」，协调没定之前不报「写不出来」。
- 批 1 回放的基线和预测照上表；被删、被排除的测试不算进 0 红。
- 批 6：改坏工厂，CI 红。
- 丙：作业红的四种情况（名单外新红、超上限、过期、名单里变绿）各造一次；空 owner 的名单条目让格式单测红；新 e2e 不登记 runner 时选择表单测红。
- 回滚：每批 revert 一个 PR。锁是 `tests/setup/world/` 下的独立文件，revert 就退。
