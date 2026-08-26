# Electron 31.7.7 → 43：EOL 升级

> 2026-08-24 立项。用户拍板：与「nomi-local 流所有权」根因修复**拆成两个 PR**，目标版本 **Electron 43（当前稳定）**。
>
> **先说清这轮不是为了什么**：立项讨论里曾假设「升 Electron 能修掉 Windows 上那个
> `ERR_INVALID_STATE` 弹框」。已实测证伪——那条缺陷在 undici 6.19.8 / 7.29.0 / 8.10.0 / `main` 里**一模一样地存在**，
> 升级修不了（证据见 `2026-08-24-local-protocol-stream-ownership.md` §1.3）。
> **本轮的唯一理由是 Electron 31 已 EOL**：不再收安全补丁，而 Nomi 是要联网跑三方模型的桌面应用，
> Chromium 126 → 150 之间累积的安全修复拿不到，这才是真风险。

---

## 1. 版本事实（2026-08-24 实查 npm registry + electronjs.org，非凭记忆）

| | 现状 | 目标 |
|---|---|---|
| electron | `^31.7.7`（Chromium 126 / Node 20 / **EOL**） | **43.4.1**（Chromium 150 / Node 24.17） |
| electron-builder | `^25.1.8` | **26.15.3**（见 §4.4 的 dist-tag 坑） |

- 官方仅支持最新 3 个大版本：今天是 **41 / 42 / 43**。31 早已出列。
- **44 于 2026-08-25（明天）转正**——本轮**刻意不追 44**：它砍 macOS 12（要求 13+）、砍 Windows ia32 预编译、
  移除渲染层 `clipboard`。等 43 稳住、44 有早期反馈后再议（用户已拍板 43）。
- npm registry 核对：`electron` 43.x 最新 = `43.4.1`，**44 尚无稳定版**；41.x=41.10.6，42.x=42.9.3。

---

## 2. 破坏性变更 → 落到本仓真实代码

只列**扫到实锤的**。官网清单里与本仓无关的（`File.path`、`setPreloads`、老协议 API
`registerFileProtocol`/`registerStreamProtocol`、`webFrame.routingId`、渲染层 `clipboard`）**已逐条 grep，全部零命中**，不再占篇幅。

### 2.1 ~~🔴 最高风险：macOS 通知会挂~~ → **已实测通过，见 §9.3**

> **结论（2026-08-24 实测）：ad-hoc 签名足以满足 UNNotification，通知正常弹出，否决门通过。**
> 下面保留立项时的风险分析原文。

**机制**：Electron 42 把 macOS 通知从 `NSUserNotification` 迁到 `UNNotification`。
UNNotification **要求 app 已代码签名**；未签名时 `Notification` 对象直接发 `failed` 事件、**什么都不弹**
（[Electron 42 发布说明](https://www.electronjs.org/blog/electron-42-0)）。

**本仓命中**：
- 用了通知：`electron/notificationIpc.ts:33`、`electron/productionRun/productionNotificationsDesktop.ts:33`
- 签名现状：`package.json` → `build.mac.identity = null`（builder 跳过签名），
  再由 `scripts/after-pack-mac.cjs` 手工 `codesign --force --deep --sign -` 打**ad-hoc 签名**
  （这是为绕开 macOS XProtect 误报而存在的，不是为分发签名）。

**未定项（必须实测，不许猜）**：**ad-hoc 签名算不算「已签名」**，公开资料只给到「可能不够」的含糊说法，
没有权威结论。因此 §6 步骤 0 是一个**强制 spike**：先打一个 Electron 43 的 ad-hoc 包，真机点一次通知。
- spike 通过 → 按原样升级；
- spike 失败 → **升级在拿到真实签名身份之前不予合并**（否则等于用「静默丢通知」换「Chromium 更新」，
  这是拿用户可见功能换不可见收益，不接受）。这条是本轮的**否决门**。

### 2.2 ~~🔴 `console-message` 的 `level` 变成字符串~~ → **撤回：说法有误**

> **2026-08-24 更正。** 原文断言「`level` 变字符串 → `main.ts:213` 的 `level >= 2` 恒 false →
> 渲染层报错静默降级」。**这是错的**，来源是二手研究结论，我未回到一手类型定义核对就写入。

改用 **Electron 43.4.1 自带的 `node_modules/electron/electron.d.ts`**（一手、随版本走）核对：

```ts
// electron.d.ts:16153 — WebContents 的 console-message
on(event: 'console-message', listener: (
  details: Event<WebContentsConsoleMessageEventParams>,
  /** The log level, from 0 to 3. ... @deprecated */ level: number,
  /** @deprecated */ message: string,
  /** @deprecated */ line: number,
  /** @deprecated */ sourceId: string) => void): this;
```

即：**五个位置参数在 43 上全部仍在，`level` 仍是 `number`**（0-3，依次 verbose/info/warning/error），
仅标 `@deprecated`。变的是**第一个**参数——从裸 `Event` 变成携带
`{ message, level: 'info'|'warning'|'error'|'debug', lineNumber, sourceId, frame }` 的 `Event`。

`main.ts:213` 用 `_event` 忽略第一参、用位置参数 `level`（number）判级，**在 43 上照常工作**。
`browserViews.ts:120` 用 `_level`（忽略），同样无影响。

**真实性质**：这是「该迁移、但不会咬人」的废弃项——位置参数可能在**未来某个大版本**移除。
本轮仍迁到结构化事件对象（用 `details.level` 字符串判级），但它是**清理**，不是**修故障**，
不再列为风险项。

### 2.3 ~~🟡 `webContents` 导航 API 废弃~~ → **降级：43 上仍在，非阻塞**

同样以 43.4.1 的 `electron.d.ts` 核对：`canGoBack()` / `canGoForward()` / `goBack()` / `goForward()`
在 `WebContents` 上**依然存在**（`electron.d.ts:10129/10133/10161/10165`），
`navigationHistory`（`:18709`）是**新增能力**，不是替换。

命中 6 处（`browser/core/browserViews.ts:215,216,291,296`、`browser/core/browserViewUtils.ts:76,77`）
在 43 上**不会坏**。本轮顺手迁移只为「不留并行版 + 下次升级少一道坎」，属清理项。

### 2.4 🟡 Electron 42 起 `postinstall` 不再下载二进制

`pnpm install` 之后 `node_modules/electron` 里**没有二进制**，首次 `npx electron` 才拉。
**本仓命中**（三处都靠 `require("electron")` 拿路径）：
- `scripts/dev-electron.mjs:54`
- `scripts/start-electron.mjs:10`
- `scripts/ensure-electron-signature.mjs:132`（macOS XProtect 重签脚本，链条起点）

另外 `package.json` 的 `pnpm.onlyBuiltDependencies` 里那条 `"electron"` 随之失去意义。

> **2026-08-24 更正（读 `node_modules/electron/index.js` 源码后）：三个脚本其实不会坏。**
> `getElectronPath()` **自带按需下载**——`path.txt` 或 `dist` 缺失时它会自己
> `spawnSync(install.js)`，失败才抛出带指引的错误：
>
> ```js
> if (executablePath) {
>   const fullPath = path.join(__dirname, 'dist', executablePath);
>   if (!fs.existsSync(fullPath)) { downloadElectron(); }   // ← 自愈
>   return fullPath;
> }
> ```
>
> 所以**不需要**在脚本里补 `npx install-electron`。原文那条改法是按「二手结论」写的，撤回。

**真实剩下的两条风险**（都在开发/CI 链路，不影响打包产物）：

1. **首次运行静默卡住**：下载在 `require("electron")` 时**同步**发生（`spawnSync`），
   几百 MB，终端只有一行 `Downloading Electron binary...`。协作者会以为 `pnpm dev` 挂了。
2. **下载可能直接失败**：本机实测直连 GitHub 抛 `TypeError: fetch failed`（`curl` 同地址却 200），
   必须 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 才能拉下来。见 §9.2。

→ 改法收敛为：**文档/环境层面提供镜像配置**（README + `.npmrc` 说明），而不是改脚本逻辑。

### 2.5 🟢 不需要原生模块重编

逐条核过依赖：`@ffmpeg-installer/ffmpeg`、`@ffprobe-installer/ffprobe` 是**独立可执行文件**（子进程 spawn，
不链接 Node ABI）；`quickjs-emscripten` 是 **WASM**；其余 `undici`/`socks`/`xlsx` 等均为纯 JS。
全仓**零 `.node` 原生插件**，故 NODE_MODULE_VERSION 125 → 148 与我们无关，
不需要 `@electron/rebuild`，`npmRebuild: false` 维持原样。
（Electron 33 起原生模块需 C++20——因为我们没有原生模块，同样不适用。）

### 2.6 🟢 其余低风险项

- **macOS 最低版本**：33 起要 11+，38 起要 **12+**。43 落在 12+，比 31 收紧，需在下载页/文档同步说明。
- **Windows**：32→44 无最低版本变化；44 才砍 ia32，而我们 `win.target` 只有 **x64**，不受影响。
- **ASAR integrity**：39 起转正，但**仍是 opt-in fuse、非强制**，本轮不启用（另立项）。
- **Electron 43**：对话框 `defaultPath` 默认指向「下载」目录；Linux 去掉 `showHiddenFiles`。对本仓影响可忽略。
- **utilityProcess**（37）：未处理的 rejection 从「崩进程」改为「只告警」。全仓未用 `utilityProcess`，不适用。

---

## 3. 范围

1. `electron` `^31.7.7` → `43.4.1`；`electron-builder` `^25.1.8` → `26.15.3`。
2. 修 §2.2 `console-message`（**语义修复，必做**）。
3. 迁 §2.3 六处导航 API 到 `navigationHistory.*`。
4. 修 §2.4 三个脚本 + `onlyBuiltDependencies` 清理。
5. mac/win 双平台打包验证 + §2.1 通知 spike。
6. 文档：下载页/README 的 macOS 最低版本 11+ → 12+。

---

## 4. 不动什么

- **不动 `localProtocol.ts`**。那是另一个 PR 的地盘；本 PR 与它**无依赖、可各自独立回滚**。
  两个 PR 都改到 `electron/` 但**文件不重叠**，合并顺序无所谓。
- 不启用 ASAR integrity fuse、不改 `npmRebuild`、不动 `asarUnpack` 名单。
- 不追 Electron 44（用户已拍板 43）。
- 不动 `electron-updater@^6.8.9`（6.x 仍是稳定线，7.0 还在 alpha）。
- 不借机做无关重构——升级 PR 必须**只含升级**，否则出问题时二分不出来是哪一边。
- **不动 macOS 签名策略**（除非 §2.1 spike 逼我们动）；ad-hoc 重签是为躲 XProtect 误报的既有决策，不在本轮推翻。

---

## 5. 回滚

`package.json` 版本号回退 + `pnpm install` 即可；§2.2–2.4 的代码改动本身向后兼容
（`navigationHistory` 在 31 上不存在，故这一项**必须与版本号同 commit 回滚**——步骤里单独成 commit 正是为此）。
无数据/配置迁移。已发布安装包不受影响（用户仍在旧版上，升级失败不影响存量）。

---

## 6. 验收门

**步骤 0（否决门，先于一切代码改动）**：Electron 43 + ad-hoc 签名的 macOS 包，真机验通知能弹。
失败则本轮**就地停住**并上报，不进入后续步骤。

其余门：

1. `pnpm run gates` 全绿。
2. `pnpm run test:e2e` + `pnpm run test:packaging` 绿。
3. **mac**：`pnpm run dist:mac:dir` 出包 → 打开 → 走查（起动、建项目、画布放视频、导出）+ **通知实弹**。
4. **win**：NSIS x64 出包 → 真机安装 → 同一套走查（改哪面验哪面，win32 不能拿 mac 结果顶）。
   → **2026-08-26 已补，见 §9.8。结论：Electron 43 在 win32 零回归。**「真机安装」那一格仍是空的（CI 顶不了）。
5. **§2.2 专项**：渲染层故意 `console.error` 一条，确认主进程日志里级别**仍判为 error**（防静默降级）。
6. **§2.4 专项**：干净克隆 → `pnpm install` → 直接 `pnpm dev`，确认不因缺二进制而失败。
7. 走查截图必须**自己 Read 过**才算数（R13 眼见链）。

---

## 7. 步骤（每步独立 commit）

0. `spike:` §2.1 通知验证（不合并，结论回填本文档）。
1. `fix:` §2.2 `console-message`（**先于升级**，在 31 上就能验「不依赖新版本」的那部分）。
2. `refactor:` §2.3 导航 API 迁移。
3. `chore:` §2.4 脚本 + `onlyBuiltDependencies`。
4. `chore:` 版本号 bump（electron + electron-builder），单独一 commit，便于二分。
5. `docs:` macOS 最低版本说明 + 本文档回填验收结果。

---

## 8. 风险与未验证项（诚实标注）

- **[未验证·否决门]** ad-hoc 签名能否满足 UNNotification。资料含糊，只能实测（步骤 0）。
- **[未验证]** electron-builder 25.1.8 能否打 Electron 43：**未发现**任何已知不兼容，
  builder 也没有官方兼容矩阵。本轮直接升到 26.15.3 规避，而不是赌 25 能用。
- **[dist-tag 坑]** `electron-builder` 的 `latest` = **26.15.3**，但 `v26` tag = **26.15.7**，两者不一致、
  原因未公开。本轮取 `latest`（26.15.3）——即 `npm i electron-builder` 的默认落点，用户面最一致；
  若过程中需要 26.15.4–.7 的某个修复再单独议。
- **[需注意]** 若将来接 Windows 签名，electron-builder 26 已把 `win.signtoolOptions`/`win.azureSignOptions`
  合并进 `win.sign`（可用 `electron-builder migrate-schema` 自动迁）。当前未签 Windows，暂不适用。
- **[连带]** Node 20 → 24 是两个 semver-major。主进程代码可能踩到与 Electron 无关的 Node 行为变化，
  §6 的 e2e + 双平台走查是主要防线。

---

## 9. 执行日志（2026-08-24 实测回填）

worktree：`/Users/aoqimin/Desktop/Nomi-electron43`，分支 `claude/electron-31-to-43`（从 `origin/main` 443800a6 拉）。

### 9.1 已验证为真的预测

| 预测 | 实测 |
|---|---|
| §2.4 Electron 42+ 不再 postinstall 下载二进制 | ✅ **坐实**。`pnpm install` 后 `node_modules/electron/dist` 不存在；`package.json` 的 `scripts` 为 `undefined`（无 postinstall），`bin` 里多了 `install-electron` |
| §2.5 无需原生重编 | ✅ 安装无任何 native 编译；构建通过 |
| 43 能构建本仓 | ✅ `pnpm run build` **exit 0** |

### 9.2 新发现（计划里没写到的）

**本机直连下载 Electron 二进制失败**，`@electron/get` 抛 `TypeError: fetch failed`（而 `curl` 同地址 200）。
需 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 才能拉下来。
→ §2.4 的改法要一并考虑镜像配置，否则协作者/CI 会卡在这一步且报错信息极不友好。

### 9.3 ✅ 否决门：通知 spike **通过**（初判为红，打包版复核后翻绿）

> **结论先行**：打包后的 `com.nomi.app`（Electron 43.4.1 + ad-hoc 签名）**通知正常弹出**，升级可继续。
> 下面完整保留「初判为红」的过程，因为它说明了**为什么最小样本的红灯不能当结论**。

**决定性证据**——`scripts/notification-signing-spike.mjs`，起真打包产物、在**主进程**里挂 `failed`/`show`：

```
🔏 被测物：release/mac-arm64/Nomi.app
   Identifier=com.nomi.app  Signature=adhoc  Team=not set
📣 electron=43.4.1  isSupported=true  verdict=SHOWN
```

即 **ad-hoc 签名足以满足 UNNotification**。`build.mac.identity=null` +
`after-pack-mac.cjs` 的 `codesign --sign -` 这套现状**不必改动**，也**不需要**为此去买 Developer ID 证书。

**初判为红是怎么回事（这条教训值钱）**：最小样本用官方 `Electron.app` 跑，得到
`failed / UNErrorDomain 错误 1`，差点据此否掉整轮升级。真实原因是——
UNNotification 的授权**按 bundle id 记**，那个样本的 bundle 是 `com.github.Electron`，
一个从未获得过用户授权的通用 id，**与签名无关**；换成我们自己的 `com.nomi.app` 就正常。
→ 「环境替身」得出的结论必须用**真产物**复核。差一点就用一个错误的红灯，
否掉了一次本来可以做的升级。

**顺带仍然成立的一条隐患**（与否决门无关，但要修）：本仓两处通知代码
（`electron/notificationIpc.ts:39`、`electron/productionRun/productionNotificationsDesktop.ts:35`）
**都只调 `show()`、都不监听 `failed`**，前者还直接 `return { ok: true }`。
今天通知能弹，所以不发作；但只要哪天发不出去（用户在系统设置里关了、未来某版又收紧），
**应用会报告成功、界面无异常、日志无记录**——连它自己注释里那句「老实回 false…别假装发了」
也一并失效。本轮顺手补上 `failed` 监听（见 §10）。

---

<details><summary>初判过程（最小样本，已被上面的打包版结论推翻，留档备查）</summary>

最小样本（`/tmp/notif-spike`，只有 `app.whenReady()` + `new Notification().show()`），
**同一段代码、同一台机器、同一个 bundle（`com.github.Electron`）**：

| Electron | `isSupported()` | 结果 |
|---|---|---|
| **31.7.7**（现役） | true | **`show` 事件 → 通知正常弹出** ✅ |
| **43.4.1** | true | **`failed` 事件 → `UNErrorDomain 错误 1`（NotificationsNotAllowed），什么都不弹** ❌ |

唯一变量是 Electron 版本，故**排除**「这台机器的通知总开关关了」这类环境因素。

**严重性被另一个发现放大**：本仓两处通知代码
（`electron/notificationIpc.ts:39`、`electron/productionRun/productionNotificationsDesktop.ts:35`）
**都只调 `show()`、都没监听 `failed`**，且前者直接 `return { ok: true }`。
即：一旦失败，**应用会报告成功、界面无任何异常、日志无任何记录**——
连它自己注释里那句「老实回 false…别假装发了」的诚实机制也一并失效。这是最难被发现的那种回归。

**仍待排除的第三种解释**：`UNErrorDomain 错误 1` 也可能仅表示「该 bundle 从未获得用户授权」，
而非「签名不合格」。系统通知库里确实**查不到** electron/nomi 的授权记录。
真正的判据必须用**打包后的 `com.nomi.app`（走 `after-pack-mac.cjs` 的 ad-hoc 签名）**复测——见 9.4。

**对照事实**：官方下载的 Electron 43.4.1 二进制**自身就是 ad-hoc 签名**
（`codesign -dv` → `Signature=adhoc`, `flags=0x20002(adhoc,linker-signed)`）；
已安装的 `/Applications/Nomi.app` 同为 `Signature=adhoc`、`TeamIdentifier=not set`、`Identifier=com.nomi.app`。

</details>

### 9.4 打包链路（electron-builder 26.15.3 + Electron 43.4.1）

`npx electron-builder --mac dir --arm64` → **PACK_EXIT=0**。
`after-pack-mac.cjs` 正常执行（`kept darwin-arm64`）并完成 ad-hoc 重签
（builder 日志：`skipped macOS code signing reason=identity explicitly is set to null`
→ 随后我们自己的 afterPack 接手重签，与升级前行为一致）。
**§8 里「builder 能否打 43」那条未验证项就此关闭：能。**

---

## 10. 本轮实际要改的（据 §9 收敛后）

否决门通过 + §2.2 / §2.3 两条撤回后，真正要动的收敛到很小：

1. **版本号**：`electron` `^31.7.7` → `43.4.1`；`electron-builder` `^25.1.8` → `26.15.3`。
2. **§2.4 二进制懒下载**：三个脚本（`dev-electron` / `start-electron` / `ensure-electron-signature`）
   在拿不到二进制时显式触发一次下载并给出可读提示；清理 `pnpm.onlyBuiltDependencies` 里的 `electron`；
   **并把镜像回退写进去**（§9.2：本机直连失败，需 `ELECTRON_MIRROR`）。
3. **通知 `failed` 监听**（§9.3 尾）：两处补上，失败时如实回 `{ ok: false }` 并落日志——
   这是把「今天恰好能弹」变成「哪天不能弹我们会知道」。
4. **清理项（非阻塞，可选）**：`console-message` 迁结构化事件对象、导航 API 迁 `navigationHistory`。
   两者在 43 上都不会坏，做它们只为不留并行版、下次升级少一道坎。
5. **文档**：README / 下载页的 macOS 最低版本 10.15 → **12+**（Electron 38 起要求）。


### 9.5 typecheck 抓到一条计划里**没预测到**的真实变更

`nativeImage.getBitmap()` 在 Electron 43 已变成 `toBitmap()` 的 `@deprecated` 别名，
且类型退化为 `void`（31 上是 `: Buffer`）：

```ts
// electron.d.ts:9931 (43.4.1)
/** Legacy alias for `image.toBitmap()`. @deprecated */
getBitmap(options?: BitmapOptions): void;
// vs 31.7.7: getBitmap(options?: BitmapOptions): Buffer;
```

**命中**：`electron/browser/media/browserMediaVisualCapture.ts:18`——浏览器「保存当前帧」的
**空帧检测**（纯黑/纯色不落库，防「假成功卡」）。若不改，`bgraLumaStats(void)` 类型不过；
即便强行绕过类型，语义也不再可靠。

改法：换 `toBitmap()`（`: Buffer`，且是**拷贝**语义，不像 `getBitmap()` 要求「当前 tick 内用完」，
对这里的用法反而更稳）。同步改掉 `browserMediaValidation.ts` 里两处已失真的注释。

**这条的意义**：它是官网破坏性变更清单里**没有**、靠 `tsc` 才抓出来的。
说明「grep 官网清单」不足以覆盖升级面，**typecheck 本身就是一道不可替代的门**。

### 9.6 全门 + 真机走查（含 Chromium 126→150 的重媒体路径）

`pnpm run gates` → **GATES_EXIT=0**，6204 passed。

走查逐条做了**版本归因**——凡是红的都在 Electron 31 上跑同一条做对照，
不把既有问题算到升级头上：

| 走查 | Electron 43 | Electron 31 对照 | 归因 |
|---|---|---|---|
| `tests/ux/smoke.e2e.mjs`（14 断言，含 3D 轨迹） | PASS | — | ✅ |
| 视频拖动压测（499.6MB · 30 seek + 60 abort · 缓存覆盖 0.199） | PASS | PASS | ✅ |
| `scene3d-keyframe-consistency`（**离屏 WebGL + mp4 出片**） | PASS | — | ✅ |
| `scene3d-safeframe` | FAIL(3) | **FAIL(3)，同错** | 既有问题，非升级 |
| `scene3d-export-journey` | 启动即中断 | **同错同行** | 既有问题，非升级 |

**结论：未发现任何可归因于 Electron 43 的回归。**
其中 `scene3d-keyframe-consistency` 的 PASS 分量最重——它跑的是离屏 WebGL 渲染 + mp4 出片，
正是 Chromium 换 24 个大版本时最该出事的地方。

界面侧：真机截图确认 UI 完整渲染（素材库/画布/视频预览/时间轴），
且**暗色模式按本地时间自动生效**（23:27 那次是暗的，16:52 那次是亮的），主题系统正常。

**两条既有坏走查**（`scene3d-safeframe`、`scene3d-export-journey`）与本轮无关，
已另开任务跟进，不在本 PR 修——升级 PR 只含升级（§4）。

### 9.7 ⚠️ 唯一真正影响用户的取舍：macOS 10.15 / 11 用户会被落下

从**两个真实产物的 `Info.plist`** 直接读出（非推测）：

| 构建 | `LSMinimumSystemVersion` |
|---|---|
| `/Applications/Nomi.app`（用户手里的 v0.20.1 / Electron 31） | **10.15**（Catalina） |
| `release/mac-arm64/Nomi.app`（本轮 / Electron 43） | **12.0**（Monterey） |

**后果**：仍在 macOS 10.15 或 11 的用户，装上新版后**完全打不开**（系统直接拒绝启动），
而不是「功能少一点」。这是本次升级唯一一处对存量用户不可逆的影响。

**这是产品决策，不是技术决策**，交用户拍板。可选项：

1. **照常升级**——接受落下这部分用户。前提是他们占比小。
   建议同时做两件事：下载页显式标注「需 macOS 12+」（目前站点**没有任何**最低版本声明，
   见 `scripts/marketing/content.mjs`），并在 release note 里写清。
2. **暂缓升级**——继续留在 Electron 31（EOL、无安全补丁）换取覆盖面。
3. **分版本发布**——为旧系统保留一个 Electron 31 的维护分支。成本最高，solo 项目基本不现实（D2：约束即战略）。

**没有数据支撑之前不替用户选**。需要的输入是：现有用户里 macOS < 12 的占比。
若无遥测，可从 GitHub release 的下载数据或群反馈粗估。

**Windows 侧无此问题**：32→44 无最低版本变化，且本仓 `win.target` 只有 x64。

**§9.7 补数据（2026-08-26）**：v0.20.1 的 GitHub release 真实下载数拿到了——
mac arm64 **41** / mac Intel **12** / win **234**。即 77% 的 mac 用户是 Apple Silicon（M1 起出厂即
Big Sur，全都能升 12+），风险只可能落在 12 个 Intel 下载里；且 mac 仅占总量 53/287 ≈ 18%。
另：macOS 10.15 / 11 本身已 EOL，2026-02 那次更新只续了 iMessage/FaceTime 证书，
Apple 安全索引里无任何 CVE 条目。

### 9.8 ✅ 验收门第 4 条（win32）已补——Electron 43 零回归

2026-08-24 那轮 win32 一格没打勾（本机无 Windows）。**根因不是「那轮忘了验」**：
`quality-gate.yml` 只有 ubuntu-latest（跑走查）和 macos-latest（只打包、不走查），
**Windows 一个 job 都没有**——开发机是 macOS，win32 是结构性盲区。
已补 `.github/workflows/win-gate.yml`：把 ubuntu job 的两步原样镜像到 windows-latest，
另加 NSIS x64 出包，走查证据传 artifact。

**单变量对照**（两组共用同一套走查工装，diff 只有 package.json 一行 + lockfile）：

| | 实验组 Electron **43.4.1** | 对照组 Electron **31.7.7** |
|---|---|---|
| NSIS x64 出包 | ✅ success | ✅ success |
| `test:e2e` smoke | ✅ success | ✅ success |
| j3-first-success | ✅ 8/8 | ✅ 8/8 |
| j5 `真实 MP4 已导出且非空` | ✅ | ✅ |
| j5 `ffprobe 识别到视频流` | ✅ | ✅ |
| j5 `提示词与重新生成控件同时可操作` | ❌ | ❌ **同错，数字逐位相同** |

失败项两组的几何数据**完全一致**（含浮点尾数）：
`promptVisibleHeight:0`，`composer{top:636.300048828125, bottom:662.2999877929688,
left:290.34375, right:869.65625}`，`stage{top:88, bottom:719, left:60, right:1100}`。

→ **判定：Electron 43 在 win32 上零回归。** 那条红是既有 Windows-only 问题
（断言 2026-08-17 随 v0.20.0 发布准备加入，在 Linux 上一直绿；Windows 上大概率从那天起就红，
只是 CI 里没有 Windows、没人看得见）。**不构成本次升级的阻塞项，另开任务修。**

**注意 §2.1 类陷阱又出现了一次**：首跑报
`infra error: ENOENT ... nomi-export-*.partial.mp4`，看起来像「Electron 43 把 Windows 导出搞坏了」。
截图直接推翻——绿色 toast 明写「已导出到项目 exports 文件夹」，**产品导出成功了**。
根因在走查工装 `evals/journeys/j5-edit-export.mjs` 的 `latestExport()`：
`exportPaths.ts:69` 把 ffmpeg 在写的临时文件命名成 `<final>.partial.mp4`，它同样
`endsWith(".mp4")` 会被当成品捞进来；而 `.filter()` 与 `.sort()` 各 `stat` 一次，
ffmpeg 在两次之间把它改名成最终名，第二次 `stat` 直接 ENOENT 抛穿。
**全平台潜伏 bug，Windows 只是导出慢、正好把竞态窗口撞开。** 已修并 A/B 证实
（修复后两个导出断言均转绿）。教训与 §9.3 同族：**工装自己的 bug 会被 catch 洗成产品结论。**

**仍未闭合**：「真机安装」那一格 CI 顶不了——走查跑的是 dev 构建，不是装完的 NSIS 产物，
两者在 asar 打包、路径、`ensureExecutable` 的 ffmpeg 落地位置上有真实差异。
补法：NSIS 静默安装后用 `launchNomiApp({ executablePath })` 指向装好的二进制再跑一遍
（`_launchApp.mjs:115` 本就支持，`mcp-client-activation` 走查即此用法）。
