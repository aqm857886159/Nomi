# 方向检查：安装器保留用户文件——第 4 轮之前（PR #1381）

> 触发：同一条线第 4 轮修补（模板触发 4）。第 3 轮后 Windows 作业全绿（运行 41020984888），独立验收仍判不通过：两条挡合并项都是本 PR 引入、都会丢数据。本线前两页：`2026-10-30-installer-nsis-compile.md`（编译）、`2026-10-30-installer-windows-harness.md`（场景脚本）。本页交用户拍板，拍板前不改 `build/installer.nsh`。

## 0. 一句话根因

我们把「升级时旧卸载程序一定会运行、一定整目录删」当成改不了的前提，自写了一套可中断的「搬走 → 等它删完 → 搬回」协议，去和一个不受控制、可能比安装程序活得更久的删除进程赛跑。可这个前提没对着模板原文核实：模板运行的只是注册表里登记的那个文件，我们可以在它运行之前把它换成只删清单的新卸载程序。

## 1. 归类表

| 轮次 / 提交 | 修了什么 | 为什么没收住 | 类 |
|---|---|---|---|
| 第 1 轮：57b0f6e42、0d854b0b7、7565502ed、9ff61d802 等 | 清单生成器；卸载只删清单；升级时把顶层外来条目搬到 `<安装目录>.nomi-keep`，旧卸载程序跑完再搬回（待恢复记录、说明文件、三个对话框）；Windows 场景 A1–A13 / CX1–CX3；发版硬门 | 推送前没真编译过 NSIS，Windows 首跑红在 `!include` 路径（运行 40921209572） | 验证装置没在目标平台跑过 |
| 第 2 轮：088a22643、07b498376、ff328a204 | include 改反斜杠；默认车道真编译两轮；概念登记；防卡死上限 | 869 行场景脚本从没在 Windows 跑过，全部红在清理机器那一步，错误被吞（运行 41008253991） | 同上 |
| 第 3 轮：ad607df28、40436e56e、959ec0a2e | PowerShell 统一包装、Node 删文件、错误原文上屏 | Windows 全绿；独立验收读源码找到下面两条丢数据路径。仅有的恢复场景 A9 / A10 只预置静止状态，量不到 | 搬家协议本身的语义漏洞 |
| 漏洞一：恢复竞态 | — | 下次运行按待恢复记录把文件搬回安装目录之前，没确认上一次拉起的旧卸载程序已经退出。它若还活着，会接着 `RMDir /r` 把搬回的文件删掉 | 协议依赖「删除者已经死了」，却拿不出证据 |
| 漏洞二：误认领 | — | 没有待恢复记录时，也会凭 `NOMI-INSTALLER-KEEP.txt` 这个文件名认领同名旁边目录：把里面的东西搬进安装目录，再删掉这个文件 | 归属靠起名约定去猜，不靠记录 |

## 2. 为什么这一类会一直出现

**三层。**

- **症状**：每轮把最底下那层红修绿，下一层冒新问题。第 3 轮验证装置第一次跑通，协议本身才第一次被对抗性地审。
- **直接原因**：
  - 漏洞一：NSIS `ExecWait` 拉起的子进程不随安装程序退出。`myCreateProcess` 不继承句柄，也不进作业对象。恢复时手里没有「它已退出」的证据。
  - 漏洞二：恢复入口不只看待恢复记录，还按注册表位置和 `$INSTDIR` 去探测带说明文件的旁边目录（`build/installer.nsh` 441–450、283–299）。
- **类根因**：自写的搬家协议是一个带崩溃恢复的分布式事务。状态由这些维度相乘：
  - 待恢复记录、旁边目录、说明文件；
  - 注册表；
  - 删除进程还活着没有；
  - 由哪个 Windows 账户在跑。

  每个角落都是一条丢数据路径。场景只能预置静止状态，量不到真实的进程交错。设计卡中途表其实写了「卸载程序是独立进程会跑完」，却没把它当成并发的删除者。

**根上的约束：用 electron-builder 26.15.3 模板原文和 NSIS 文档说话。**

- **旧卸载程序怎么删**：
  - 0.24.0 没有 `nsis.include`，走默认卸载段。
  - 新安装程序升级时给它传 `--updated`（只有要求删应用数据时才不传，`include/installUtil.nsh` 202–207）。于是 `un.atomicRMDir` 把 `$INSTDIR` 下每个文件（包括用户的、子目录里的）挪进它自己的 `$PLUGINSDIR\old-install`，再 `RMDir /r $INSTDIR`；退出时清空 `$PLUGINSDIR`（`uninstaller.nsh` 164–187），不进回收站。
  - 控制面板卸载不带 `--updated`，直接 `RMDir /r`。
  - NSIS 手册 RMDir 一节明说：卸载程序里 `RMDir /r $INSTDIR` 不安全，用户可能把自己的文件放在安装目录。
- **新安装程序一定会调用登记的卸载程序**：安装段无条件 `uninstallOldVersion SHELL_CONTEXT`，装给所有用户时再跑一轮 HKCU（`installSection.nsh` 52–58）。没有钩子能跳过这一步。
- **但它调用的只是一个文件**：
  - 读注册表 `UninstallString`，取引号里的路径（`installUtil.nsh` 155、167）；
  - 拷进 `$PLUGINSDIR\old-uninstaller.exe`，带 `/S --updated _?=<旧目录>` 运行（209–224；拷贝那份起不来就原地运行，230）；
  - 不核对版本。
- **本版卸载程序本来就会写进安装目录并登记**：安装段末尾由 `File /oname=${UNINSTALL_FILENAME}` 写入，再登记成 `UninstallString`（`include/installer.nsh` 100、121–122）。构建时，安装程序那一轮能拿到它（`out/targets/nsis/NsisTarget.js` 298）。
- **结论**：文档化的 `customInit` 在 `.onInit` 里运行（`installer.nsi` 79–81），UAC 内外两个实例都会跑，而且排在安装段调用旧卸载程序之前。所以「改不了」只对磁盘上那份旧代码成立。只要在模板运行它之前把这个文件换成本版只删清单的卸载程序，旧删除代码就一次都不会跑。

**系统哪里没拦住。** ★0 只查了「旧卸载程序做什么」，没查「新安装程序怎么找到并调用它」。设计卡也没有要求「改不了」这类前提附上调用点原文。

**铁律。** 铁律 ⑫ 适用：用户以为点了更新或卸载，项目还在。结账挂的类检查仍是 `tests/installer/installerScenarios.test.mjs`（矩阵），加上 Windows 场景。铁律 ⑩ ⑪ 不涉及。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 子目录缺口照旧：0.24.0 安装目录里 `resources\user-notes\a.txt` 这类文件，用第 3 轮的包升级后消失。合同已把它列为残留风险 | A1 在 0.24.0 安装目录里加嵌套种子跑 Windows 作业，红在 `user file missing: resources\user-notes\a.txt` |
| 补上「只认领有待恢复记录的旁边目录」后，装给所有用户、由另一个 Windows 账户接着更新：他的 HKCU 里没有记录，旁边目录又已存在。结果每次更新都中止，文件一直留在旁边目录 | 作业里 `New-LocalUser` 建第二个账户；第一个账户的更新在挪开后被杀，再用第二个账户跑升级 |
| 补上「恢复前等旧卸载进程退出（有上限）」后，判断它还活着只能靠进程查询。在 PowerShell 被策略禁用、或 WMI 卡住的机器上，要么等到上限后中止（更新永远失败），要么只能按进程名猜 | 作业里把执行策略设成 Restricted，再跑漏洞一的场景，看退出码和对话框 |

## 4. 靶子独立性

- **靶子和实现有同一个盲区。** A1–A13、CX1–CX3、Mac 普查都出自实现线；两条漏洞是独立验收读源码找到的。仅有的恢复场景 A9 / A10 预置的是「旧卸载程序已跑完」和「挪了一半」两种静止状态，量不到「删除者还活着」，也量不到「旁边目录不是我们的」。
- **先修靶子。** 新场景的输入和期望直接取自验收给出的交错（见第 4 轮切法），而且必须先在第 3 轮的包上真红，再改安装器。
- 没有「修对了反而掉分」的先例（这里不打分）。

## 5. P0：这些是我们独有的吗？现成方案

- **我们独有的只有一条领域约束**：项目可以放在任何地方，包括安装目录，升级、卸载后必须原样还在。
- **搬家协议不是领域代码。** 待恢复记录、旁边目录、进程存活、跨账户，都是通用的事务和系统编程。`self-written.json` 里没有安装器条目。推荐项把这部分整块删掉。
- **清单生成器和只删清单的卸载段要留。** electron-builder 是整包 7z 解压，不记逐文件日志（`include/extractAppPackage.nsh`）；MSI 和 Inno Setup 自带的那份「装了什么」，这里没有。

**★0 先查别人**

| 出处 | 它怎么做 | 对哪个决定的影响 |
|---|---|---|
| [NSIS 手册 RMDir](https://nsis.sourceforge.io/Docs/Chapter4.html#rmdir)、[命令行 `_?=`](https://nsis.sourceforge.io/Docs/Chapter3.html) | 卸载程序里 `RMDir /r $INSTDIR` 不安全，用户可能把文件放进安装目录；`_?=` 让卸载程序不拷到临时目录，直接按给定目录删 | 只要旧删除代码还会运行，就有丢数据窗口，所以选「让它不运行」 |
| electron-builder 26.15.3 模板原文：`installSection.nsh` 52–58、`include/installUtil.nsh` 155–230、`include/installer.nsh` 100 | 升级时运行注册表 `UninstallString` 指向的那个文件，不核对版本；本版卸载程序就写在同一路径 | 推荐项的依据：在模板运行它之前把文件换成本版的 |
| [electron-builder #2181](https://github.com/electron-userland/electron-builder/issues/2181)、[#7914](https://github.com/electron-userland/electron-builder/issues/7914)、[PR #6551（7b2a5e1）](https://github.com/electron-userland/electron-builder/commit/7b2a5e1f19921e9da4aaaea8c01c78740f29f9dd) | 维护者认为应用目录应不可变，整目录删是有意的。社区绕法只改新卸载程序，不管已装的旧卸载程序。#6551 承认还用 `RMDir /r` 的旧卸载程序仍在用户机器上，只在新安装程序一侧加兜底 | 等不到上游；旧卸载程序这一次只能由我们处理 |
| [Revenera 知识库：大版本升级时改变旧版本的卸载行为](https://community.revenera.com/s/article/modify-uninstall-behavior-of-a-previous-version-during-a-major-upgrade) | 旧版本的卸载会删掉用户定制时，给两类办法：删除前后做备份、恢复；或者先给已装的旧包打补丁，改掉它的卸载行为，再升级 | 正好对应「加固」和「绕开」。「先改掉旧卸载逻辑」是行业正路之一 |
| [Inno Setup：追加卸载日志](https://jrsoftware.org/ishelp/topic_appendnotes.htm)、[VS Code 的 Inno Setup 脚本](https://github.com/microsoft/vscode/blob/main/build/win32/code.iss) | 升级默认装在原目录、追加卸载日志，不先跑旧卸载程序。VS Code 的 `[InstallDelete]` / `[UninstallDelete]` 只点名自己的子目录，从不整删 `{app}` | 升级不必先跑旧卸载程序；清理只按已知清单 |
| [Squirrel.Windows 更新流程](https://github.com/Squirrel/Squirrel.Windows/blob/develop/docs/using/update-process.md) | 每版装进新的 `app-x.y.z`；启动时删掉除当前和上一版以外的版本目录 | 「安装目录归安装器」是常见前提，用户数据该放别处。应用侧另一条线在做项目位置校验，但救不了 0.24.0 这一次 |
| [NSIS v304 `myCreateProcess`](https://github.com/kichik/nsis/blob/v304/Source/exehead/util.c)、[Job Object `KILL_ON_JOB_CLOSE`](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information) | `ExecWait` 的子进程不继承句柄、不进作业。要让它随安装程序一起死，得自己建作业对象 | 「加固」要补的是自写的进程生命周期管理，代价和新风险都在这里 |

## 6. 选项对比 + 推荐

| 选项 | 做什么 | 还会不会丢、窗口在哪 | 用户要做什么 | 实现与验证代价 | Mac 测不到的怎么在 Windows 证 | 推荐 |
|---|---|---|---|---|---|---|
| 绕开（接入模板自己的机制） | 在 `customInit` 里检查登记的卸载程序：不可信（没有等于 `DisplayVersion` 的 `RemovesOnlyOwnFiles`）就换成本版只删清单的卸载程序；换不掉就弹框、退出码 2，在模板调用前退出。删掉整套搬家、恢复代码，以及 `customCheckAppRunning`、`customUnInstallCheck*` 两类未写进文档的钩子 | 安装器这边没有窗口：升级时旧删除代码一次都不跑，用户文件不挪动，子目录里的也保住。<br>剩下所有方案共有的一条：用户不升级，直接用 0.24.0 自带的卸载程序卸载。<br>另：被杀的安装程序若遗留卸载进程，它晚跑也只删刚装的应用文件，不碰用户文件，重跑安装程序即可 | 什么都不用做 | 删三百多行，新增几十行；场景脚本重做 A4 / A9 / A10，新增 A14–A16；Windows 推 2–3 次；不增运行时分支 | A1–A16 + 反例。A14 用 IFEO 闸门卡住被拉起的卸载进程，并核它与本版卸载程序逐字节相同。第一次推送先在第 3 轮的包上看到 A14 / A15 真红 | **推荐** |
| 加固（补） | 恢复前等上次的卸载进程真退出：设等待上限，或用作业对象让它随安装程序一起死。只认领有待恢复记录、且带我们写入的随机标记的旁边目录 | 两条漏洞补上。<br>但 0.24.0 那一次，子目录里的用户文件照删。<br>协议的其它角落（跨账户、PowerShell 不可用、杀毒占用、盘符根目录）仍会带来中止或新漏洞 | 多数人无感；中止更新的情况变多，要重试或手动挪文件 | 新加进程查询或作业对象、随机标记两套逻辑；同样要 IFEO 闸门测试，外加跨账户、受限 PowerShell 两组场景；大概率还有第 5 轮 | 同样的 A14 / A15，加第二个账户、受限执行策略两组场景 | 不推荐 |
| 换路 | 旧版本不可信、且安装目录里有不属于安装器的条目时，中止升级，弹框请用户先挪走；删掉搬家代码 | 顶层不丢。<br>只查顶层，会漏掉子目录里的用户文件；查整棵树，又会把旧版本多出的应用文件当成外来条目误拦 | 正是这次出事的那类用户，每次更新都被拦：必须先手动挪走项目，挪完应用里可能找不到项目。装在本来就有文件的目录（如 `D:\工作`）的人，永远更新不了 | 最低：一个检查、一个对话框 | A1 / A2 / A3 改成「中止 + 弹框 + 原样」 | 不推荐：把风险推给用户，还挡住 0.24.1 这次必带的修复 |
| 重写：换安装框架 | 改用 MSI、Squirrel 一类 | 新框架不跑旧 NSIS 卸载程序，但旧安装的文件和登记还得有人清，问题换个地方回来 | 不定 | 自动更新链路、签名、迁移全部重验，远超 0.24.1 | — | 不推荐 |
| 删 | 去掉旧版保护，只留只删清单的新卸载程序 | 0.24.0 → 新版那一次照样整目录删，事故原样重演 | — | 最低 | — | 不接受 |

**推荐「绕开」，三条理由：**

1. **在根上去掉删除者，而不是和它赛跑。** 两条漏洞所在的代码整块删除，同类漏洞没有地方再长出来。
2. **顺带关掉三处残留。** 合同里承认的「0.24.0 那一次子目录照删」没了；盘符根目录、旁边目录已存在时的中止也没了。
3. **用的是模板自己的机制和文档化钩子。** 登记的卸载程序、默认的结果处理都照模板走，自写代码和未写进文档的钩子都变少，符合 P0、P1。

代价：推翻第 3 轮已经跑绿的搬家实现，场景脚本要重做一部分。

## 7. 用户要权衡的核心

二选一：

- 推翻已在 Windows 跑绿的「搬走再搬回」，多返工一轮，换来升级时旧的整目录删除程序根本不运行，也不再有中断恢复这类边角；
- 或者保住现有实现继续补洞，接受还会有第 5 轮。

## 第 4 轮切法（按推荐，拍板后才动手）

**要碰的文件**

- **`build/installer.nsh`**
  - 删除：
    - `nomiKeepAside` 及搬家、恢复的全部函数；
    - 待恢复记录、旁边目录、说明文件、三个对话框；
    - `customCheckAppRunning` 覆盖、隐藏段、`customUnInstallCheck` / `customUnInstallCheckCurrentUser`；
    - 为覆盖钩子补的 `getProcessInfo.nsh` 和 `Var pid`。
  - `customInstall` 只留写标记。
  - 新增「换掉不可信的登记卸载程序」函数，由 `customInit` 调用：
    - 按模板同样的方式读 HKCU 的 `UninstallString`；是管理员时再读 HKLM；
    - 不可信，就把 `${UNINSTALLER_OUT_FILE}` 先写进 `$PLUGINSDIR`，再用 `MoveFileExW` 换到登记路径（替换已存在、允许跨盘：`%TEMP%` 和安装目录常不在同一个盘）；
    - 写不进或换不掉：弹框（不带 `/SD`）、退出码 2、`Quit`。
  - 最终只用 4 个文档化钩子：`customHeader`、`customInit`、`customRemoveFiles`、`customInstall`。
- **`tests/installer/scenarios.mjs`、`windows-installer-scenarios.mjs`**
  - 删旁边目录相关常量和 `simulateMovedAside`；
  - 开跑前把被测包装进探测目录，取出本版 `Uninstall Nomi.exe` 备比对；
  - 新增 IFEO 闸门工具和 A14–A16；A1 加嵌套种子；A4、A9、A10 按下表重定义；反例按下表改。
- **新增 `tests/installer/late-deleter-gate.mjs`**：IFEO 闸门（[IFEO 的工作方式](https://learn.microsoft.com/en-us/archive/blogs/greggm/inside-image-file-execution-options-debugging)：在 CreateProcess 的用户态部分把调试器插在命令行前面；按调用方位数查 32 / 64 位两份注册表）。
- **`tests/installer/installerScenarios.test.mjs`**：钩子表改成 4 个；新增两条普查（见结构性预防）。
- **文档**
  - 设计卡补第 4 轮：★0、中途表、★9、残留风险；
  - 根因合同：不变量、策略、残留风险、`shared_boundaries`；
  - 概念登记的 `write_api` 换符号；
  - 本页入库；改 `build/installer.nsh` 的提交带 `Direction-Check:`。
- **顺手修验收指出的两处漂移**：合同里「本机没有 makensis」一句；A6 卸载后补 `expectNoDialogs`。

**先写的特征测试**

第一次推送只改测试，安装器不动。

- A14、A15 和 A1 嵌套种子，先跟第 3 轮的 `build/installer.nsh` 一起推。预期 Windows 作业只红这三处，其余全绿：
  - A14 红在「迟到的删除者跑完后用户文件缺失」；
  - A15 红在旁边目录里的 `NOMI-INSTALLER-KEEP.txt` 缺失；
  - A1 红在 `resources\user-notes\a.txt` 缺失。

  这次的运行号写进设计卡，作为两条漏洞的真机复现。
- 闸门自检：闸门没报「已卡住」，算准备失败、不算红，只修测试。
- 推送最多 3 次。第二次推送（换卸载程序）如果红在安装器行为上，停，交用户。

**★9 验收清单与反例**

下表只列新增和改动的行，其余 A 行不变。

| 编号 | 场景 | 怎么做 | 核什么 | 反例 |
|---|---|---|---|---|
| A14（漏洞一） | `late-deleter-after-killed-installer` | 1. 0.24.0 + 三处数据 + 嵌套种子<br>2. 对 `old-uninstaller.exe` 设 IFEO 闸门，32 / 64 位两个视图都写<br>3. 后台起新包 `--updated /S`<br>4. 闸门报「已卡住」后删 IFEO，只杀安装程序（不带 `/T`）<br>5. 新包再跑一次 `--updated /S` 到结束<br>6. 放行闸门，被卡住的卸载程序带原参数跑完<br>7. 再跑一次新包 `/S /D=<安装目录>` | 被卡住的程序与本版卸载程序逐字节相同；迟到的删除者跑完后，每个用户文件 SHA-256 不变；最后一次安装后应用完整 | 第 3 轮的包上必红（特征测试）。CX9：换卸载程序的函数一进门就返回，A14 红在「卡住的不是本版卸载程序」 |
| A15（漏洞二） | `unowned-sidecar-untouched` | 1. 0.24.0 + 用户文件<br>2. 预先建 `<安装目录>.nomi-keep`，内含用户自己的 `NOMI-INSTALLER-KEEP.txt`、`私人.txt`、`子目录\b.txt`；没有待恢复记录<br>3. 新包 `--updated /S`<br>4. 用新卸载程序卸载 | 退出码 0、无对话框；旁边目录里每个文件路径和 SHA-256 都不变，也没多东西；安装目录里没出现 `私人.txt` | 第 3 轮的包上必红（特征测试）。CX10：在换卸载程序的函数里插一句「删除旁边目录里的同名说明文件」，A15 红 |
| A1 | 不变 + 嵌套 | 0.24.0 安装目录里加 `resources\user-notes\a.txt`、`locales\my.txt` | 升级后、卸载后都在 | 第 3 轮的包上红（合同承认的残留，这次关掉） |
| A4 | 期望改了 | 独占打开一个用户文件再升级 | 退出码 0、无对话框、文件不变（不挪用户文件，占用挡不住更新） | — |
| A16 | `old-to-new-locked-uninstaller` | 独占打开登记的 `Uninstall Nomi.exe` 再升级；解除占用后重试 | 静默下恰好 1 个对话框，点名卸载程序路径；退出码 2；0.24.0 完整、用户文件不变；重试成功 | CX3 改为给这个对话框加 `/SD IDOK`，A16 红 |
| A9 | `interrupted-after-replace` | 预先把登记的卸载程序换成本版的（模拟上次换完就被杀），再升级 | 升级成功、用户文件不变、登记为新版本和标记 | — |
| A10 | `interrupted-after-replaced-uninstaller-ran` | 同上，再按模板参数跑一次换上去的卸载程序（登记和应用文件已删）；再跑新包 `/S /D=<安装目录>` | 用户文件在原处不变；新版装好 | — |
| CX2 | `skip-replace` | 换卸载程序的函数一进门就返回 | A1 红在用户文件缺失 | — |

另核：

- 除 A15 预置的以外，不出现 `<安装目录>.nomi-keep`。
- 报告列出「0.24.0 有、本版清单没有」的文件。本分支与 v0.24.0 的依赖、锁文件、平台裁剪都没变，预计为空，A8 零残渣照旧；发版时由候选版跑同一套场景再量。

**结构性预防**

- **删掉**：待恢复记录、旁边目录、说明文件、恢复路径全部删除，两条漏洞所在的状态不再存在。
- **结构上做不出来**：安装器只会拉起只删清单的卸载程序。换不掉，就在模板调用之前退出，没有「退回旧卸载程序」这条路。
- **门岗**：普查新增两条，各配必红自检。
  - 换卸载程序的调用只在 `customInit` 里出现一次。
  - `installer.nsh` 里 `Delete`、`Rename`、`RMDir`、`File /oname`、`CopyFiles`、`MoveFileEx` 的目标只能是以下几类，其它一律红：
    - 清单宏的条目；
    - `$INSTDIR`；
    - `${UNINSTALL_FILENAME}`、`uninstallerIcon.ico`；
    - `$PLUGINSDIR` 下的路径；
    - 从 `UninstallString` 读出的登记路径。

  Windows 侧 A14–A16 和 CX9、CX10 随作业进发版硬门。
- **规则文字（最弱）**：设计卡 ★0 遇到「上游或旧版本改不了」这类前提，必须附上上游如何定位、调用它的原文位置；写进 `docs/lessons/`。

## 特征测试清单

- **已钉住**：
  - `tests/installer/installerScenarios.test.mjs`（普查 + 真编译）；
  - `scripts/packaging/installer-manifest.test.mjs`；
  - `tests/installer/windowsHarness.test.mjs`；
  - Windows 运行 41020984888：A1–A13 全过，CX1–CX3 按登记变红。
- **没钉住**：两条漏洞和子目录缺口。原因：本机没有 Windows；场景里也没有能卡住删除进程的闸门，没有「不是我们的旁边目录」这种输入。第 4 轮第一次推送补上，并先在第 3 轮的包上看到它们真红。


## 裁定

2026-10-30 19:1x，协调向用户提交甲（换掉旧删除程序）、乙（继续加固搬家）、丙（发现用户文件就不更新）及体验说明，用户答「都按推荐」。执行甲：模板运行登记的旧卸载程序之前，先换成本版只删清单的卸载程序；用户文件原地不动。整套搬走再搬回协议删除，不保留并行实现。第 4 轮 fix-churn 已获拍板；产品代码提交带本页 Direction-Check。新增分支或新特例须停下上报。

### 协调裁定补充（2026-10-30 20:4x）

先本地完成甲，不再要求先单独推特征红；正常包和临时副本生成的两个变异包同次 Windows CI 验证。去掉替换、永远可信均须使 A1/A14/A15 变红；产品不留开关。推送队列上限 120 轮，其余安装器行为红即停、最多三次推送不变。
