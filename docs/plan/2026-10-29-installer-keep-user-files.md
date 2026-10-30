# Windows 升级 / 卸载只删安装器自己装的文件

改动名：安装器只删清单内条目　线/负责人：I-installer-keep-user-files　类别：[可打断]（升级途中可被打断、要能续上；不花钱、不新增应用界面）

事故：用户把 Nomi 装在 `F:\Nomi_new`，又把「新项目默认位置」设成 `F:\Nomi_new\xiangmu`，在那里建了 5 个项目；0.24.0 提示更新后直接安装，5 个项目全没了，回收站里也没有。机制：`package.json` 的 `build.nsis` 没有自定义，electron-builder 默认卸载段（`templates/nsis/uninstaller.nsh:160`–188）升级时把安装目录逐个挪进 `$PLUGINSDIR\old-install`，再 `RMDir /r $INSTDIR`；普通卸载也是 `RMDir /r $INSTDIR`。升级时跑的是**旧版**卸载程序（`templates/nsis/include/installUtil.nsh:142`–243）。

## ★0 先查别人

| 出处 | 它怎么做 | 对我们哪个决定的影响 |
|---|---|---|
| [NSIS 手册 RMDir](https://nsis.sourceforge.io/Docs/Chapter4.html#rmdir) + [NSIS wiki：只卸载装过的文件](https://nsis.sourceforge.io/Uninstall_only_installed_files) | 手册明说卸载程序里 `RMDir /r $INSTDIR` 不安全（用户可能装进已有目录）；wiki 的做法是安装时记下装了什么，卸载时按记录逐个 `Delete`、非递归 `RMDir`，最后 `RMDir $INSTDIR` | **确认了**：卸载只删清单里的条目、目录一律非递归删、`$INSTDIR` 空了才删 |
| [Inno Setup `[UninstallDelete]`](https://jrsoftware.org/ishelp/index.php?topic=uninstalldeletesection) + [MSI RemoveFile 表](https://learn.microsoft.com/en-us/windows/win32/msi/removefile-table) | 两家都只删自己 `[Files]` / File 表里装的；额外删除要逐条登记，文档劝别对 `{app}` 用通配；目录项默认「空了才删」 | **确认了**：清单是唯一判据，不认通配；目录「空了才删」 |
| [electron-builder #2181](https://github.com/electron-userland/electron-builder/issues/2181) | 维护者表态「应用目录必须不可变」，`RMDir /r` 是有意为之，不会改默认 | **改了**：不能等上游，只能走 electron-builder 文档化的 `include` 钩子自己改卸载段 |
| [electron-builder #7914](https://github.com/electron-userland/electron-builder/issues/7914) | 社区绕法：`customRemoveFiles` 里遇到 `${isUpdated}` 直接 `quitSuccess`，升级时什么都不删 | **改了**：不照抄——那样升级永远不清旧文件、残渣越积越多；我们升级时仍按清单原子挪走、失败还原 |
| [electron-builder #8365](https://github.com/electron-userland/electron-builder/issues/8365) | 手动重装时 `customInstall` 里 `${isUpdated}` 为假，靠它区分「升级」不可靠 | **确认了**：挪开 / 挪回不看 `${isUpdated}`，只看注册表里登记的旧安装位置和标记 |
| electron-builder 26.15.3 文档 [Custom NSIS script](https://www.electron.build/nsis#custom-nsis-script) + 模板 `templates/nsis/installer.nsi:45`–124、`templates/nsis/installSection.nsh:33`–83、`templates/nsis/include/allowOnlyOneInstallerInstance.nsh:32`–43 | 文档列出的钩子里 `customInit` 在 `.onInit`（页面之前，UAC 内外两个实例都跑）；`customInstall` 在解包之后；模板另有未写进文档的 `customCheckAppRunning`（替换「应用还开着」检查）和 `customUnInstallCheck` / `customUnInstallCheckCurrentUser`（替换「旧卸载程序结果」处理） | **改了**任务书的「`customInit` 挪开、`customInstall` 挪回」：挪开放在「应用已关」之后、旧卸载程序之前，挪回放在旧卸载程序刚结束时（见下表）；未写进文档的钩子用模板指纹测试钉住 |
| electron-updater 6.8.9 `out/NsisUpdater.js:107`–121、`out/BaseUpdater.js:13`–21 | 「重启以更新」传 `--updated --force-run`（非静默），「退出时安装」传 `--updated /S`；先起安装程序再 `app.quit()`，安装程序可能在 Nomi 还没退干净时就开跑 | **确认了**：不碰更新握手；挪开必须排在 electron-builder 自己的「应用还开着」检查之后 |
| [MoveFileW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefilew) + NSIS 3.04 `Source/exehead/exec.c`（`EW_RENAME` 调 `MoveFile`）+ [手册 Rename](https://nsis.sourceforge.io/Docs/Chapter4.html#rename) | 目录只能在同一个卷内移动；文件跨卷会退化成「复制 + 删除」；目标已存在就失败 | **改了**：旁边目录取同一父目录下的 `<安装目录>.nomi-keep`（同卷 → 真重命名、原子）；挪不动就回滚并中止，绝不自己复制再删 |
| NSIS 3.04 `Source/exehead/util.c`（`my_MessageBox`：静默模式下只有带 `/SD` 的框才被跳过）+ [手册 MessageBox](https://nsis.sourceforge.io/Docs/Chapter4.html#messagebox) | 不带 `/SD` 的 MessageBox 在 `/S` 下照样弹出；electron-builder 自己的「卸载失败」框就是这么写的 | **确认了**：中止 / 残留提示一律不带 `/SD`，静默安装也看得见原因 |

偏差表（标准 · 我们的偏差 · 理由）：

| 标准链接 | 我们的偏差 | 理由 |
|---|---|---|
| `templates/nsis/uninstaller.nsh:160`–188 默认删除 | 定义 `customRemoveFiles`：升级时只把清单里的文件原子挪进 `$PLUGINSDIR\old-install`（任一失败就还原、同一句 `Abort`），普通卸载只 `Delete` 清单里的文件；目录按「最深在前」非递归 `RMDir`；最后 `RMDir $INSTDIR` 不带 `/r` | 安装目录里不属于安装器的东西一个都不能删；原子挪走 + 失败还原是 electron-builder 的升级语义，保留 |
| 文档钩子 `customInit` / `customInstall`（任务书原定挪开 / 挪回点） | 挪开：`customCheckAppRunning` 里先原样跑模板的检查（`IS_POWERSHELL_AVAILABLE` + `_CHECK_APP_RUNNING`），再挪开；UAC 内层实例模板不跑这个检查，改由排在安装段之前的隐藏段 `-nomiKeepUserFilesElevated` 挪开。挪回：`customUnInstallCheck` / `customUnInstallCheckCurrentUser`，旧卸载程序一结束就挪回（失败退出前也先挪回）。`customInstall` 只做兜底挪回 + 写标记 | `customInit` 在页面之前：用户还能取消或改目录，而且 UAC 内外实例都会跑、Nomi 可能还占着文件；`customInstall` 在解包之后：解包被取消（`Quit`）就到不了，文件会滞留在旁边目录 |
| `templates/nsis/include/installUtil.nsh:108`–134 默认的旧卸载结果处理 | 两个 `customUnInstallCheck*` 钩子逐句复刻默认语义（启动失败只记一行继续；返回码非 0 弹同一个框、`SetErrorLevel 2`、`Quit`），只在其中插入挪回 | 定义钩子就会跳过默认代码（钩子后紧跟 `Return`），必须自己保住原行为 |
| `templates/nsis/include/allowOnlyOneInstallerInstance.nsh:5`–8 | 定义了 `customCheckAppRunning` 后模板不再 `!include getProcessInfo.nsh`、不再声明 `Var pid`，由 `customHeader` 补上（两个编译轮都要） | 默认检查代码原样调用，依赖要自己补齐 |
| 「哪些属于安装器」：NSIS wiki 是安装时逐条记日志 | 构建时生成：`afterPack` 遍历打包产物（剪完平台二进制之后）生成 `.tmp/installer-manifest/<产品名>-x64.nsh` 和 `.json`；`resources\elevate.exe`（afterPack 之后才拷进去）、`Uninstall <产品名>.exe`、可选的 `uninstallerIcon.ico` 按 electron-builder 的规则补上 | 任务书要求构建时算出、不许手抄；electron-builder 是整包 7z 解压，没有逐文件 `File` 可记 |
| 「升级前旧卸载程序是不是只删自己的」没有标准 | 注册表 `SHELL_CONTEXT\Software\<GUID>` 写 `RemovesOnlyOwnFiles = <写入它的版本>`，只在等于同一根键下卸载项的 `DisplayVersion` 时才信 | 照 electron-builder 自己的 `KeepShortcuts "true"` 能力旗的先例；绑版本是为了降级 / 旧版覆盖后旧标记不被误信 |

## ★1 用户怎么用

当我把 Nomi 装在自己选的目录、又把项目放进这个目录时，我想点「更新」或「卸载」后项目原样都在，以便不丢作品。

1. 用户把 Nomi 装到 `F:\Nomi_new`（或一个本来就装满自己文件的目录，如 `D:\工作`）。
2. 设置里把新项目位置设成安装目录下的 `xiangmu`，建了几个项目（`xiangmu\<项目>\.nomi\project.json` + 素材）；安装目录顶层还有一个随手放的 `笔记.txt`。
3. Nomi 提示更新：点「重启以更新」（`--updated --force-run`）或退出时自动装（`--updated /S`）。
4. 安装程序先按 electron-builder 的老规矩确认 Nomi 已关，再把安装目录顶层不属于安装器的条目同盘挪到 `F:\Nomi_new.nomi-keep`，旧卸载程序跑完立刻挪回原处，再装新文件。
5. 用户打开新版 Nomi，项目路径没变，直接能打开。
6. 以后再升级 / 在「设置 → 应用」里卸载：新卸载程序只删清单里的文件，`xiangmu`、`笔记.txt` 都留着，安装目录空了才删。
7. 挪不开（文件被别的程序占着）：更新中止，弹框（静默也弹）说明哪个条目、什么都没动；关掉占用程序后再更新即可。

不做什么：不改应用代码（项目位置校验另一条线在做）；不改 `oneClick`、`allowToChangeInstallationDirectory`、`deleteAppDataOnUninstall`；不碰更新握手 / 重启；不回改已发的 0.24.0 卸载程序。

已知坑（明着标）：

- 直接用 0.24.0 及更早的卸载程序卸载（没先升级到修好的版本）仍会整目录删——旧程序已在用户机器上，改不了。
- 0.24.0 → 修好版本这**一次**，只保护安装目录**顶层**的外来条目；放在 `resources\`、`locales\` 这些安装器自己的目录里面的用户文件，这一次仍会被旧卸载程序删。修好版本之后，嵌套的用户文件也由新卸载程序保住。
- 某个旧版本有、本版本已不再带的顶层文件，在这次过渡里会被当成「外来」留下（无害残渣）；0.24.0 与本版本顶层文件集合相同（Electron、打包配置都没变），这次没有。
- 安装目录是挂载点 / 跨卷联接时，旁边目录不在同一个卷：目录挪不动 → 中止并提示（不丢）。

真实任务（Windows 作业里真装真升真卸，不是夹具模拟）：

1. 事故原样：v0.24.0 Release 安装包装到 `Nomi_new`，建 `xiangmu\proj1\.nomi\project.json` + 素材 + 顶层散文件，另在默认位置（「文档」`\Nomi Projects`）和安装目录外的自选位置各放一个项目，再用新包 `--updated /S` 升级，最后用新卸载程序卸载。
2. 安装目录本身是装满用户文件的中文带空格目录（`我的 工作`），0.24.0 装进去 → 升级 → 新版卸载。
3. 新版装好后放用户文件 → 新版再升级 → 普通卸载。

指标（目标 → 信号 → 指标；量具都是 `.github/workflows/win-installer.yml` 跑的 `tests/installer/windows-installer-scenarios.mjs` 报告）：

- 主指标：用户文件幸存率 = 场景结束时字节相同（SHA-256）的用户文件数 / 种下的用户文件数；目标 100%（每个场景）。基线：同一作业里的反例「不挪开」（CX2）在事故场景上量出 0%。
- 质量指标：残渣数 = 安装目录里既不在清单、也不是用户种下的条目数；目标 0；卸载后「没有外来文件」的安装目录不存在。
- 护栏指标：挪不开时更新中止的比例 = 100%，且对话框被捕获、文本含条目名；中止后旧版仍完整（安装目录与注册表版本不变）。
- 耗时：每个场景的 `durationMs`（只记录，不设门槛，见 ★7）。

### ★1b 连带界面

应用内界面一处都不改。安装程序新增两类系统对话框（中英双语，同一个框里先中文后英文；不谈钱）：

- 挪不开而中止：「Nomi 没有更新，你的文件一个都没动。安装目录 `<L>` 里的「`<条目>`」挪不开（可能正被别的程序打开）。请关掉占用它的程序，再重新更新 Nomi。」+ 英文同义句。
- 旁边目录做不了（盘符根目录 / 同名文件夹已存在 / 没权限）：「Nomi 没有更新，你的文件一个都没动。安装目录 `<L>` 里有不属于 Nomi 的文件，更新前要先临时挪到 `<H>`，这一步做不了。请把这些文件移出安装目录，或把 Nomi 装到单独的文件夹后再更新。」+ 英文。
- 挪回不完整 / 上次中断有同名冲突：「你的一部分文件还在 `<H>`（完好），没能挪回 `<L>`（那里已有同名的）。请手动把它们挪回。」+ 英文。
- 旁边目录里的说明文件 `NOMI-INSTALLER-KEEP.txt`（UTF-16，中英）：为什么在这里、重新运行安装程序会自动挪回、或手动挪回到哪里。

## ★2 谁说了算

- 「安装目录里哪些属于安装器」：唯一来源 = 构建时生成的清单（`scripts/packaging/installer-manifest.cjs`，由 `scripts/after-pack-mac.cjs` 在 win32 打包时调用），NSH 与 JSON 同一次生成；卸载段、挪开分类、Windows 作业的断言都读它。同一份事实 1 份。
- 「当前登记的卸载程序只删自己的」：注册表 `RemovesOnlyOwnFiles`，只由安装程序 `customInstall` 写，值 = 写入它的版本；读的只有安装程序的挪开判断。
- 「挪到一半的记录」：`HKCU\Software\<GUID>.nomi-keep` 的 `Pending1` / `Pending2` = 原位置，挪开前写、全部挪回后删；旧卸载程序删 `Software\<GUID>` 时碰不到它。
- 状态 owner 是安装程序；应用代码不读不写这些东西。`docs/engineering/concept-owners/` 里已有的概念一个没碰；新登记一个 `delivery.installer-owned-files`（owner = 清单生成器 `computeInstallerManifest`，写接口另有 `installer.nsh` 的 `customRemoveFiles`、`nomiKeepAside`），和根因合同同一个提交。没有靠「东西不见了」猜意图。
- 门表：`node scripts/door-map.mjs quitAndInstall install --roots=electron` → 应用里触发安装的唯一入口是 `electron/update/installGate.ts`（本单不改）；安装程序被启动的方式只有 electron-updater 的两种参数组合 + 用户手动运行。

## ★3 一致与复用

- 全部走 electron-builder 的 `nsis.include` 钩子，不换整份脚本（`nsis.script`），模板其余部分原样用。
- 「应用还开着」检查原样调用模板宏；升级时原子挪走 / 失败还原 / `Abort` 文案照抄模板做法；`Uninstall <产品名>.exe` 运行中改名失败照模板忽略。
- 打包产物遍历放在现有 afterPack（`scripts/after-pack-mac.cjs`，已在给 win32 剪平台二进制），架构名用 `scripts/packaging/native-binaries.cjs` 的 `normalizeArch`。
- Windows 作业沿用 `win-gate.yml` 的装配（pnpm / node / `pnpm run build` / `electron-builder --win nsis --x64`），旧版安装包用 `gh release download` 取并按 `SHA256SUMS.txt` 校验。
- 没有第二份定义：保留名单不手抄；旁边目录后缀 `.nomi-keep`、说明文件名、标记名在 `tests/installer/scenarios.mjs` 一处给测试用，`build/installer.nsh` 里的字面量由普查测试逐字对账。

## ★4 全状态

- 空（安装目录没有外来条目，或已是修好的版本）：不建旁边目录、不弹框，照默认流程升级。
- 进行中：带界面时详情里有「挪开 / 挪回」行；静默时没有界面。
- 成功：用户文件在原处、路径不变，旁边目录不存在，注册表写上标记。
- 失败（挪不开）：已挪的全部挪回，弹框说明条目，退出码 2；旧版完整可用，注册表不变。
- 部分成功（挪回时目标已有同名）：不覆盖，留在旁边目录并弹框说明位置；安装继续，记录保留，下次运行安装程序再试。
- 取消中：在 electron-builder 的「应用还开着」框点取消 → 挪开之前就退出，什么都没动；解包时取消 → 文件早已挪回；强杀 / 断电 → 文件只在原处或旁边目录之一，下次运行安装程序按记录自动挪回。
- 过期：标记是别的版本写的（降级、旧版覆盖）→ 当作没标记，照样挪开保护。
- 能力不可用：盘符根目录、旁边目录建不了 / 已有同名文件夹 → 不挪、中止并弹框；下一步：把文件移出安装目录，或把 Nomi 装到单独文件夹后再更新。
- 文案：系统对话框中英双语，安装程序不走应用 i18n 词典；不写任何钱的断言。

## 5 中途表

不涉及花费（安装程序不调任何付费接口），每格的「花费」都是「无」。

| 状态 \ 打断 | 点取消 / 关窗 | 断网 | 重启 / 断电 / 强杀 | 连点（再开一个安装程序） |
|---|---|---|---|---|
| 检查应用是否还开着 | 什么都没挪，直接退出 · 无 · 无回执 | 不联网，无影响 | 什么都没挪 · 无 | 模板互斥锁挡掉第二个实例（`ALLOW_ONLY_ONE_INSTALLER_INSTANCE`） |
| 挪开中 | 安装段里无取消按钮；强关 = 强杀 | 无影响 | 已挪的在旁边目录（有说明文件 + 注册表记录），未挪的在原处；下次运行自动挪回 | 同上，互斥锁 |
| 旧卸载程序运行中 | 无取消按钮 | 无影响 | 卸载程序是独立进程会跑完；用户文件在旁边目录；下次运行按 `Pending` 记录挪回（注册表安装位置已被删也找得到） | 互斥锁 |
| 挪回中 | 无取消按钮 | 无影响 | 一部分已回原处，其余在旁边目录；下次运行挪回 | 互斥锁 |
| 解包中 | 取消 → 模板 `Quit`；用户文件此前已挪回 | 无影响 | 用户文件已在原处；应用文件不完整，重新运行安装程序即可 | 互斥锁 |
| 写标记后 | 安装已完成 | 无影响 | 无影响 | 互斥锁 |

## 6 外部数据与失败

| 外部来源 | 规范链接 | 我们的偏差 / 依赖 | 失败时用户看到什么 |
|---|---|---|---|
| electron-builder 26.15.3 模板与钩子顺序 | 见 ★0 | 依赖两个未写进文档的模板钩子 | 模板一变，普查测试的模板指纹先红（开发侧），不会悄悄带到用户 |
| electron-updater 的安装参数 | `out/NsisUpdater.js:107` | 不改 | — |
| Windows 文件系统（占用、权限、MAX_PATH、挂载点、FAT32） | MoveFileW | 只做同父目录重命名；失败回滚 | 中止框，文件原样 |
| 旧版本留下的注册表（安装位置、版本、标记） | `templates/nsis/include/installer.nsh:103` | 标记绑版本；安装位置为空的极旧登记不处理（旧卸载程序那时会删默认目录，属 electron-builder 既有行为） | — |
| v0.24.0 Release 安装包（仅测试输入） | GitHub Release `v0.24.0` | 下载后按 `SHA256SUMS.txt` 校验 | 作业红，不会用错包 |

## ★7 性能

不适用于应用交互：本单没有新增任何应用内操作，`tests/perf/scenarios/` 不覆盖安装程序。安装程序侧：挪开 / 挪回是同盘重命名，次数 = 顶层外来条目数，不复制字节；最坏规模（顶层几千个用户文件）也只是几千次重命名。量具：Windows 作业报告里每个场景的 `durationMs`，只记录、不设门槛。

## 8 真实条件

- Windows：GitHub Actions `windows-latest` 真装真升真卸，旧版用 GitHub Release 上的 v0.24.0 安装包（真包，不是自建模拟）。动到安装器文件的推送跑一次；每次发候选版（`desktop-rc.yml`）也跑一次，作为发版硬门（见 ★9）。
- 干净安装：每个场景开始前清注册表、目录、快捷方式。
- 静默 / 交互：作业只跑静默（electron-updater「退出时安装」的参数）；「重启以更新」的非静默界面 `unverified`（同一段代码，只差界面和 `--force-run`）。
- UAC 内层实例（以普通权限运行安装程序、选「所有用户」时经 UAC 提权出来的那个实例）：`unverified`——CI 上 UAC 关着，造不出内层实例；这条路径与外层共用同一个函数，只是入口不同。
- 英文界面 / 最小窗口 / 键盘全程 / 真付费：不适用（系统对话框中英同框；无付费）。
- 真用户机器上的杀毒软件拦截：`unverified`。

## 拍板图清单：链接

不适用：不改应用界面，没有新屏；唯一新出现的是系统 MessageBox，文案原文在 ★1b。

## ★9 验收与反例（实施前）

验收线：协调另派（编号不同于本线）。命令：推本分支触发 `.github/workflows/win-installer.yml`（或在 Actions 里手动 `workflow_dispatch`），读作业摘要与上传的 `installer-scenarios` 报告。被测包在作业里临时改用 `<package.json 版本>-installer-test` 这个版本号（不提交）：`package.json` 现在还是 0.24.0，和旧版同号时 A7 量不到东西，执行器遇到同号直接报错。Mac 侧 `pnpm vitest run scripts/packaging/installer-manifest.test.mjs tests/installer/installerScenarios.test.mjs`。

每个场景都核：种下的每个用户文件 SHA-256 不变（含隐藏 / 只读属性）；结束时不存在 `<目录>.nomi-keep`、不存在 `Software\<GUID>.nomi-keep`；没有意外对话框；安装器退出码符合预期。各场景另核：

| 编号 | 场景 id | 怎么做 | 另核什么 |
|---|---|---|---|
| A1 | `old-to-new-user-folder` | 0.24.0 静默装到 `Nomi_new`；用户数据放三处：安装目录里（`xiangmu\proj1\.nomi\project.json`、`xiangmu\proj1\assets\shot.png`、顶层 `notes.txt`）、默认位置（「文档」`\Nomi Projects\` 下本场景专用的项目文件夹）、安装目录外的自选位置（和安装目录同级）；新包 `--updated /S`；再用新卸载程序卸载 | 升级后、卸载后三处都在；升级后安装目录顶层非用户条目 = 清单顶层名 + 卸载程序（不多不少）；清单每个文件都在且 `resources\app.asar` 与 `win-unpacked` 字节相同；`DisplayVersion` = 新版本；`RemovesOnlyOwnFiles` = 新版本；卸载后顶层只剩用户的条目、注册表清掉 |
| A2 | `old-to-new-dir-full-of-user-files` | 先建 `我的 工作`（中文带空格）并塞满用户文件（多层目录、隐藏、只读、0 字节）；0.24.0 `/S /D=` 装进去；新包升级；再用新卸载程序卸载 | 升级后、卸载后用户文件都在；卸载后清单文件全不在、目录还在（因为有用户文件） |
| A3 | `old-to-new-app-still-running` | 0.24.0 装好、种用户文件后，以 `xiangmu` 为工作目录启动旧版 `Nomi.exe`（模拟 quitAndInstall 时应用还没退、占着项目目录）；确认进程活着再跑新包 `--updated /S` | 退出码 0；Nomi 进程已被结束；用户文件都在（证明挪开排在「应用已关」之后） |
| A4 | `old-to-new-locked-user-file` | 0.24.0 + 用户文件；另一个进程独占打开 `xiangmu\proj1\.nomi\project.json`；新包 `--updated /S` | 静默下捕获到 1 个对话框、文本含 `xiangmu`；退出码 2；安装目录与注册表版本仍是 0.24.0；然后解除占用重跑 → 同 A1 全绿 |
| A5 | `old-to-new-changed-dir` | 0.24.0 装到 `Nomi_old` + 用户文件；新包 `/S /D=<另一个目录>`（手动重装改目录，不带 `--updated`） | 用户文件仍在 `Nomi_old`；`Nomi_old` 里旧应用文件都不在；新目录装好；注册表安装位置 = 新目录 |
| A6 | `old-to-new-per-machine` | 0.24.0 `/S /allusers /D=` 装给所有用户（HKLM）+ 用户文件；新包 `--updated /S` | 用户文件都在；HKLM 下 `RemovesOnlyOwnFiles` = 新版本（覆盖「旧卸载程序跑两轮、最后一轮后才挪回」） |
| A7 | `old-to-new-stale-marker` | 0.24.0 + 用户文件；往 `HKCU\Software\<GUID>` 手写 `RemovesOnlyOwnFiles = <被测新版本号>`（别的版本写的，而且恰好等于正在跑的安装程序自己的版本：比对象必须是登记着的 `DisplayVersion`，比成安装程序自己的版本这里就红）；新包 `--updated /S` | 用户文件都在（过期标记不被信） |
| A8 | `old-to-new-no-foreign-then-uninstall` | 0.24.0 装到 `Clean`，不放任何东西；新包升级；再卸载 | 升级后顶层条目恰好 = 清单顶层名 + 卸载程序、没建过旁边目录；卸载后 `Clean` 目录不存在（零残渣） |
| A9 | `interrupted-after-old-uninstall` | 0.24.0 + 用户文件；模拟上次修好的安装程序挪开后、旧卸载程序已跑完时被打断：用户文件已在 `<L>.nomi-keep`（含说明文件）、写了 `Pending1`、旧版已被卸载（注册表没了）；跑新包 `--updated /S` | 用户文件回到 `<L>` 原路径；旁边目录与 `.nomi-keep` 键都没了 |
| A10 | `interrupted-before-old-uninstall` | 同上但旧版还装着（注册表还在）；跑新包 `--updated /S` | 先挪回、再正常挪开 / 升级 / 挪回；用户文件在 `<L>`；升级成功 |
| A11 | `new-to-new-update` | 新包装好；用户数据放三处（同 A1），安装目录里另有嵌套的 `resources\user-notes\a.txt`、`locales\my.txt`；独占打开其中一个用户文件；新包再 `--updated /S`；解除占用后用新卸载程序卸载 | 退出码 0（被占用的用户文件不挡升级 = 没走挪开、新卸载程序没碰它）；升级后、卸载后三处都在（含嵌套的）；没建旁边目录；卸载后清单文件全不在、注册表清掉 |
| A12 | `new-to-new-changed-dir` | 新包装到 `A` + 用户文件；新包 `/S /D=B` | 用户文件留在 `A`；`A` 里清单文件全不在；`B` 装好 |
| A13 | `new-uninstall-keeps-user-files` | 新包装好；种顶层 + 嵌套在 `resources\` 里的用户文件；用卸载程序 `/S /currentuser` 卸载 | 清单文件全不在；含用户文件的目录还在、其余安装器目录都删了；卸载注册表项、`Software\<GUID>`、快捷方式都没了 |

任务书点名的覆盖面 → 场景：用户文件夹含 `.nomi\project.json`（A1 等）、散文件（A1）、装满用户文件的目录（A2）、0.24.0 → 新版（A1–A10）、新版 → 更新版（A11）、普通卸载（A13、A1、A2、A8、A11）、用户文件被占用（A4、A11）、手动重装改目录（A5、A12）、没有外来文件不留残渣（A8）；协调追加的「用户数据放三处（默认位置、安装目录外的自选位置、安装目录里），升级后、卸载后各验一遍」（A1：0.24.0 → 新版 → 卸载；A11：新版 → 新版 → 卸载）。普查测试按 `tests/installer/scenarios.mjs` 的覆盖面登记逐项核，少一项就红。

发版硬门（协调追加）：`desktop-rc.yml` 的 `windows-installer` 作业无条件调用本作业（`workflow_call`），`finalize` 依赖它；它红了候选版运行不是 success，`desktop-release.yml` 只晋级 success 的候选版。它和 `validate` 并行，测同一个提交（`github.sha`，`validate` 第一步核过 `inputs.ref` 就是它），自己另打一个带 `-installer-test` 后缀的安装包，不是 `windows` 作业上传的那一个字节相同的候选包（同一份源码、同一套打包配置；差别只在版本号和反馈接收端的出厂配置，后者在 `app.asar` 里，不影响安装目录里有哪些文件）。

Mac 侧（vitest，本线自跑）：

- M1 清单生成器矩阵：普通树 / 空目录 / 中文、空格、`$`、`'`、`&`、`#` 文件名 / 符号链接目录（跟随、防环）/ `packElevateHelper` 开关与 `perMachine` / 不支持的架构抛错 / 配了 `fileAssociations` 抛错 / 文件名含 `${` 抛错 / 同一棵树两次输出逐字节相同；NSH 解析回来与 JSON、与独立遍历三方一致。
- M2 afterPack 接线：用假的 win32 打包上下文调 `after-pack-mac.cjs`，清单写到 `<projectDir>/.tmp/installer-manifest/<产品名>-x64.*`；linux 不写（darwin 那一支会真调 codesign，单测不调它；两者走的是同一句 `=== "win32"` 判断）。
- M3 普查：`build.nsis.include === "build/installer.nsh"`、`oneClick === false`；`installer.nsh` 没有 `RMDir /r`、定义了 6 个钩子；常量与 `scenarios.mjs` 逐字一致；electron-builder 模板 12 个文件的 SHA-256 指纹；工作流对 `windows-latest` 跑全部场景、不带 `--only`、反例开着、能被 `workflow_call` 调用；`desktop-rc.yml` 恰好一个作业无条件调用它、`finalize` 依赖它，`desktop-release.yml` 只晋级 success 的候选版；执行器种「默认位置」的 `Nomi Projects` 还是 `electron/runtimePaths.ts` 里的默认位置；每个反例的「改哪一句」在 `installer.nsh` 里恰好出现一次。

反例（先改 → 必须红 → 还原）：

| 编号 | 改什么 | 预期红在哪 | 在哪跑 |
|---|---|---|---|
| CX1 | `customRemoveFiles` 换回 `RMDir /r $INSTDIR` | A13 用户文件被删 | Windows 作业（作业里按 `scenarios.mjs` 的变异描述临时生成 `.nsh`、`--prepackaged` 重打安装包后跑，预期红；红不了作业就红） |
| CX2 | 挪开函数一进门就返回 | A1 用户文件被删（基线 0%） | Windows 作业 |
| CX3 | 中止框加 `/SD IDOK` | A4 静默下捕获不到对话框 | Windows 作业 |
| CX4 | 生成器跳过空目录 | M1 红 | Mac |
| CX5 | `installer.nsh` 混进一句 `RMDir /r` | M3 红 | Mac |
| CX6 | 模板任一文件改一个字节（在副本上） | M3 指纹红 | Mac |
| CX7 | 工作流加 `--only` | M3 红 | Mac |
| CX8 | `desktop-rc.yml` 的 `finalize` 不再依赖安装器作业 / 去掉这个作业 / 给它加条件 | M3 红 | Mac |

这一类还会从哪回来：换 electron-builder 版本（模板指纹拦）、换安装包形态（单击安装 / 所有用户 / 多架构 / 网络安装包：`installer.nsh` 顶部 `!error` 拦在编译期）、加文件关联（生成器抛错）、新增 afterPack 之后才放进安装目录的文件（Windows 作业 A1 / A8 的「顶层条目恰好 = 清单」拦）、旧版本留下的注册表形状（A7、A9、A10）。

回滚：`git revert` 本 PR 的提交即可，不涉及数据迁移；已装上修好版本的机器，下次升级仍由修好版本的卸载程序执行（只删清单），之后才回到默认整目录删除。独立验收报告：待协调派验收线（四类：可打断）。

### 功能分类

- [ ] 新界面 / 改交互
- [ ] 花钱
- [x] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [ ] 新增功能 / 性能

## 2026-10-30 编译闭环补充（实施前）

★0：实查 [electron-builder v26 跨平台文档](https://www.electron.build/v26/docs/features/multi-platform-build/)：macOS 按需下载工具；本仓 26.15.3 `out/toolsets/windows.js#getMakeNsisPath` 默认下载 nsis-3.0.4.1，内含 `mac/makensis`（Mach-O x86_64），用 NSISDIR 指向包根可在本机运行。`NsisTarget.computeScriptAndSignUninstaller` 在 Catalina 及以后用 UninstallerReader 提取卸载器，不必通过 Wine 执行它；完整打包另实跑确认。保留依赖版本，不另装软件。

实查 [NSIS v304 scriptpp.cpp](https://github.com/kichik/nsis/blob/v304/Source/scriptpp.cpp) 与 [util.cpp](https://github.com/kichik/nsis/blob/v304/Source/util.cpp)：`pp_include` 用 `get_dir_name/get_file_name` 拆路径，后两者只认宿主分隔符，源码也标着 Windows 不支持 `/` 的 BUGBUG。CI 40921209572 完整日志实际是 `!include: could not find`，不是清单内某条指令非法；产物中清单存在。决定：include 使用反斜杠，Unix makensis 自己转换，Windows 使用原生分隔符。

★1：目标是安装器改动在推送之前就经过真实编译器；量具 = 默认 vitest / 推送前扫描登记的编译测试（退出码 + exe 产物）、本机完整打包日志。此处不证明 Windows 安装运行场景通过，A1–A13 仍由 Windows 作业验证。

★2：唯一源码仍是 installer.nsh + afterPack 生成器；编译测试复用 electron-builder 的 build API、实际 nsis 配置和实际 include，不另写一份模拟 NSIS 模板。

★3：用 electron-builder 自己解析并下载工具、生成两轮模板并执行 -WX；极小 payload 仅加速编译，不模拟 Windows 文件保护行为；完整应用另打一次 Windows 安装包。

★4：编译成功必须有非空 exe；任何语法错误、版本不匹配、缺失工具/下载失败都硬红，不 skip、不放宽 -WX、不移除 !error。

★9 验收清单（先写后改）：本机重现现有完整编译错误；修正所有实际编译暴露的问题后，两轮模板与生成清单编译通过，完整安装包产出；默认车道测试真实编译；推送前对 installer.nsh、生成器、package.json（包括 nsis 配置）、锁文件和 afterPack 的修改选中此测试；反例在 include 副本插入非法 NSIS 指令，真实编译必须失败。另以 Windows 路径拆分断言拒绝 `/` include（Mac 不能代跑 Windows 查找路径）；现有普查和场景不删不弱化。回滚本轮提交即可。


## 2026-10-30 Windows harness 闭环补充（动手前合同）

- ★1：CI A1–A13 在 resetMachine 就退 1，CLIXML 只有 progress；量具为真实失败日志、默认车道 windowsHarness.test.mjs（静态及解析）及 Windows 作业。Mac 无 PowerShell，片段执行明确未验证。
- ★2：文件删除归 Node fs.rmSync(force)；PowerShell 退出与诊断归同一 wrapper（powershell-boundary.ps1），同步片段、WATCHER -File、锁助手均使用它；XML 解析复用已装的 @xmldom/xmldom。
- ★3：注册表 / 进程 / KnownFolder 继续使用系统 Windows PowerShell 5.1；删除旧的文件系统 Remove-Item 和隐式退出路径，不增替代安装器。
- ★4：缺失清理目标成功；其它 PowerShell 错误 Stop + catch，在 stdout 输出固定标记、Exception.Message 和 PositionMessage，再 exit 1；成功 exit 0。异步启动失败 / 提前退出 / 非零退出均留原文。锁的有意终止单独认领；监视器失败不能被场景绿灯覆盖。
- ★9 验收：默认车道静态核全部片段归 wrapper、无脚本级 SilentlyContinue、无 PowerShell 文件删除；真实 progress fixture 退 1 必须报「没有错误原文、退出 1」，含 error 的 CLIXML 必须提取错误、换行、XML 实体并忽略 progress；ErrorRecord 对象也可读。attributesOf 缺失文件必须中止，setRegistryValue 写失败必须中止。Windows A1–A13 全过且 CX1–CX3 各红在登记场景才全绿。反例：绕开 wrapper、恢复脚本级静音、吞 stdout 或把 progress 当错误应使测试红。最多 3 次推送，安装器行为红即停。
- 沿用原设计卡其余格；不改界面、不花钱、不新增应用操作或性能场景。
- 依据：[PowerShell 5.1 退出语义](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_powershell_exe?view=powershell-5.1)、[MS-PSRP ErrorRecord](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-psrp/c527797a-d017-4755-8a81-9f58280a7135)、[PowerShell ConsoleHost 序列化源码](https://github.com/PowerShell/PowerShell/blob/master/src/Microsoft.PowerShell.ConsoleHost/host/msh/Serialization.cs)。
