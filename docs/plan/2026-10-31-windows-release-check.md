# Windows 真机检查任务书（不合入）

1. 这是什么：发版前有 5 项检查 Mac 做不了，要在真 Windows 上做。你是 Windows 上的 AI 会话，照本文件一条条做，不需要别的上下文。
2. 别合入：本 PR 永远不合入，不改产品代码。分支基于 main 的 `24a9c15da`。
3. 怎么做：先读「安全红线」和「准备」，再按任务 1 到 5 做。每条独立，一条红了接着做下一条。
4. 怎么交回：写 `docs/evidence/2026-10-31-windows-release-check/report.md`，截图放同目录，提交并推送到本分支（见「交回」），然后告诉用户「做完了」。
5. 拿不准会不会碰到真实资料，或遇到本文件没写的情况，停下问用户，不要自己决定。

## 安全红线（写死）

- 这台机器很可能装着用户真实的 Nomi。绝不碰 `%APPDATA%\Nomi`、`%USERPROFILE%\.nomi`、「文档」下的 `Nomi Projects`、任何真实项目目录。
- 每次起应用都用隔离目录。下面叫它「四件套」，全指到 `C:\nomi-win-check\iso-<名字>\` 下新建的空目录，并且和起应用在同一个 PowerShell 里设：
  `NOMI_ELECTRON_USER_DATA_DIR`、`NOMI_SETTINGS_DIR`、`NOMI_PROJECTS_DIR`、`NOMI_CAPABILITY_DIR`。
  手工起打包后的应用时，再把 `HOME` 和 `USERPROFILE` 指到空目录，并清掉环境里指向真实目录的其他 AI 编码工具的配置变量（完整变量名未核实，先 `Get-ChildItem Env: | ? Name -match 'CLAUDE|CODEX|MCP'` 看一眼），防止应用读写真实配置。
  走查脚本（任务 2、3、4、5）经 `tests/ux/_launchApp.mjs` 自己设好这些，不用手设。
- 不花钱：`NOMI_SPEND_OK` 一律不设，不读任何 Key，不调真实供应商。走查用的是本机环回假供应商。
- 不改系统和安全设置（含开启 Windows Sandbox、开发者模式、提权），不永久删除不是自己创建的东西，不用 `--no-verify`、不 force-push、不 stash、不 reset、不 rebase。
- 不改产品代码。发现问题只记录复现步骤，不修。
- 只往本 PR 的分支推，不合入，不碰别的分支。
- 报告和截图不许带真实素材、真实项目名、路径里的用户名、聊天记录、Key。路径写成 `<WORK>`、`<USER>`；截图提交前自己逐张看过。
- 不要在真桌面上跑 `tests/installer/windows-installer-scenarios.mjs`。它每个场景前都会清掉所有 `Nomi*` 的卸载注册表项（用户级和机器级）、`%LOCALAPPDATA%\Programs\Nomi`、快捷方式，结束该目录下的进程，还会在「文档」下建测试文件夹。它是给一次性的 CI 机器设计的：只准在 Windows Sandbox 或一次性虚拟机里跑。

## 准备
```
git clone https://github.com/aqm857886159/Nomi.git C:\nomi-win-check\repo   # 专用克隆，不要动用户已有的工作目录
cd C:\nomi-win-check\repo
node -v        # 要 >= 22.19.0（package.json engines；CI 用 24）
pnpm -v        # 要 10.8.1（packageManager）；没有或不同，记下来告诉用户，不要提权安装
gh auth status # 要已登录；没登录就停下告诉用户，不要自己输密码或令牌
gh pr checkout 1396
git branch --show-current   # 应是 test/windows-release-check
pnpm install --frozen-lockfile
```
- 不要用 `pnpm run perf:scenarios` 之类外面包了 `python3 scripts/with-gates-lock.py` 的命令：Windows 上 `python3` 常是应用商店别名，会退出 49 且零输出（`docs/lessons/windows-agent-toolchain-traps.md` 第 4 条）。下面都直接用 `node ...`。
- 所有产物放 `C:\nomi-win-check\`（没有权限就换一个短路径、无空格的位置，报告里写 `<WORK>`）。
- 机器信息，报告开头要有：`Get-CimInstance Win32_OperatingSystem | select Caption,Version,BuildNumber`；`Get-CimInstance Win32_Processor | select Name,NumberOfLogicalProcessors`；`Get-CimInstance Win32_VideoController | select Name,DriverVersion`；内存 `(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB`；系统缩放看「设置 > 系统 > 屏幕 > 缩放」（devicePixelRatio 在 Windows 上等于缩放百分比除以 100，125% 就是 1.25）；是否接电源、电源模式。

## 走查的前台与负载（Windows 上的实际行为）

- `NOMI_WALK_FOREGROUND_OK` 只给任务 4 的那两条命令用，而且先问过用户（见任务 4），跑完就清。别的走查一律不设。没有它，声明了必须前台的走查不起应用，退出码 125（跳过），不算红。
- 其余走查都没声明前台，走「安静模式」：`tests/ux/_quietWalk.cjs` 把应用窗口变成全透明、鼠标穿透、不可聚焦，停在屏外 (-32000,-32000)。屏幕上不该看到应用窗口；任务栏里闪一下 Nomi 或 Electron 图标是正常的，别点、别关。只有任务 1 里安装器的界面和装好后的 Nomi 窗口、任务 4 的窗口会真的弹出来，也是正常的。
- 前台守卫（`lsappinfo`）只在 macOS 起作用。`project-save-draft-contract.walk.mjs` 的 `launchConditions` 和 `tests/perf/canvas-scale/generationIdleScenario.mjs` 的起跑核对，在非 macOS 上直接放行；`os.loadavg()` 在 Windows 永远是 0。所以没有自动的负载准入，你自己做：起跑前关掉其他 Nomi、Electron 和大浏览器页面（`Get-Process Nomi,electron -ErrorAction SilentlyContinue` 应为空），再 `Get-Counter '\Processor(_Total)\% Processor Time' -SampleInterval 2 -MaxSamples 5`，平均应低于 30%，把这个数写进报告。
- 未核实：窗口全透明、在屏外时，Chromium 在 Windows 上会不会因「被遮挡」降低绘制、让帧间隔偏好。任务 3 的数字好得可疑就把疑虑写进报告，不要为此在任务 3 里设放行变量。
- 走查起的是开发构建，起跑前要 `pnpm run build`（`assertFreshBuild` 会拒绝比源码旧的产物）。

## 任务 1（必做）安装器真升级

目的：#1381 修了「升级把装在安装目录里的用户文件一起删掉」。要在真 Windows 上验：先装官方 0.24.0，再升级到带修复的版本，外来文件都还在。

CI 怎么做（`.github/workflows/win-installer.yml`，`windows-latest` 上，超时 150 分钟）：给被测包改一个带 `-installer-test` 的版本号，`pnpm run build`，`pnpm exec electron-builder --win nsis --x64 --publish never`，下载 v0.24.0 安装包，跑 `node tests/installer/windows-installer-scenarios.mjs ... --counterexamples`，场景表在 `tests/installer/scenarios.mjs`（A1 到 A16）。反例要重新打包，本机不跑，不带 `--counterexamples`。

**第一步 拿官方旧包**
```
gh release download v0.24.0 --repo aqm857886159/Nomi --pattern Nomi-win-x64.exe --pattern SHA256SUMS.txt --dir C:\nomi-win-check\old --clobber
```
资产名和大小已核实：`Nomi-win-x64.exe`，288647920 字节；用 `SHA256SUMS.txt` 里对应行核对哈希。

**第二步 从 main 本地打带修复的包**（第一遍用这个；协调会在 PR 上贴 0.24.1 候选包地址，第二遍用候选包才算数）
```
pnpm run build
pnpm exec electron-builder --win nsis --x64 --publish never -c.extraMetadata.version=0.24.0-installer-test
```
- 产物：`release\Nomi-win-x64.exe`、`release\win-unpacked`、`.tmp\installer-manifest\Nomi-x64.json`（afterPack 钩子 `scripts/after-pack-mac.cjs` 写出，版本号取自 electron-builder 的 `appInfo.version`，与 CI 同一路径）。
- 为什么要改版本号：main 现在就是 0.24.0，和官方旧包同号。同号时执行器直接报错，场景 A7（注册表标记是别的版本写的）也量不到东西。CI 是 `npm pkg set` 改 `package.json`；这里用命令行覆盖，不动文件。`-c.extraMetadata` 这个写法未核实（Mac 上没打包）：报错或产物版本不对，就改用 CI 的做法，并在打完后 `npm pkg set "version=0.24.0"`、`git status --short` 确认 `package.json` 没有改动（有就停下告诉用户，不要 reset）。
- 可能卡住：electron-builder 解包签名工具时报 `Cannot create symbolic link` 或 `A required privilege is not held`（需要符号链接权限，本仓库会不会触发未核实）。不要开开发者模式、不要提权，记录原文，问用户。

**第三步 选环境，不碰真实安装**

先查本机有没有 Nomi：
```
Test-Path "$env:windir\System32\WindowsSandbox.exe"   # True 才有沙盒（这个判断未核实；沙盒只有 Pro、企业、教育版，家庭版没有）
Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue | Get-ItemProperty | ? DisplayName -like 'Nomi*' | select DisplayName,DisplayVersion,InstallLocation
Test-Path "$env:LOCALAPPDATA\Programs\Nomi"; Get-Process Nomi -ErrorAction SilentlyContinue
```
- 有沙盒：走方案 A。沙盒没启用，不要自己去开（那是改系统设置，还要重启）。
- 没有沙盒，且上面查不到任何 Nomi（注册表空、目录无、进程无）、「文档」下也没有 `Nomi Projects`：走方案 B。
- 没有沙盒，且查到任何已装的 Nomi：任务 1 停下，报告写 unverified，问用户。

**方案 A Windows Sandbox（跑现成执行器）**

宿主机上准备（沙盒里没有网络，输入都要备好；不带 `node_modules` 的原因：pnpm 的链接在沙盒里会断，所以只带执行器唯一的第三方依赖 `@xmldom/xmldom` 的真实文件）：
```
$S='C:\nomi-win-check\sbx'; New-Item -ItemType Directory -Force "$S\in\slice\tests","$S\in\slice\node_modules\@xmldom","$S\out" | Out-Null
Copy-Item -Recurse tests\installer "$S\in\slice\tests\installer"
Copy-Item -Recurse (Split-Path (node -p "require.resolve('@xmldom/xmldom/package.json')")) "$S\in\slice\node_modules\@xmldom\xmldom"
Copy-Item (Get-Command node).Source "$S\in\node.exe"
Copy-Item C:\nomi-win-check\old\* "$S\in\"
Copy-Item release\Nomi-win-x64.exe "$S\in\Nomi-new.exe"
Copy-Item .tmp\installer-manifest\Nomi-x64.json "$S\in\"; Copy-Item -Recurse release\win-unpacked "$S\in\win-unpacked"
```
`$S\in\run.ps1`（沙盒里执行；`--work` 路径不能有空格）：
```
New-Item -ItemType Directory -Force C:\work,C:\w | Out-Null
Copy-Item -Recurse -Force C:\in\slice\* C:\work\
& C:\in\node.exe C:\work\tests\installer\windows-installer-scenarios.mjs --old C:\in\Nomi-win-x64.exe --old-sums C:\in\SHA256SUMS.txt --new C:\in\Nomi-new.exe --manifest C:\in\Nomi-x64.json --unpacked C:\in\win-unpacked --work C:\w --report C:\out\report.json *> C:\out\runner.log
$LASTEXITCODE | Set-Content C:\out\exit.txt
Copy-Item -Recurse C:\w\dialogs C:\out\dialogs -ErrorAction SilentlyContinue
```
`$S\nomi-check.wsb`，双击启动（`.wsb` 格式凭 Microsoft 文档记忆写，Mac 上未核实；沙盒拒绝就把报错原文记下来）：
```
<Configuration>
  <Networking>Disable</Networking>
  <MemoryInMB>8192</MemoryInMB>
  <MappedFolders>
    <MappedFolder><HostFolder>C:\nomi-win-check\sbx\in</HostFolder><SandboxFolder>C:\in</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>C:\nomi-win-check\sbx\out</HostFolder><SandboxFolder>C:\out</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>powershell -NoProfile -ExecutionPolicy Bypass -File C:\in\run.ps1</Command></LogonCommand>
</Configuration>
```
跑完（约一小时以上）看 `$S\out\exit.txt`（0 为过）、`report.json`、`dialogs\`。沙盒窗口里的安装器界面会弹出来，正常。

**方案 B 无沙盒（只做手工步骤，不跑执行器）**：目录用 `C:\nomi-win-check\app`。结束后卸载，做法同执行器：把 `<目录>\<uninstallerFileName>`（文件名见 `Nomi-x64.json`）拷到别处，运行 `<拷贝> /S /currentuser _?=<目录>`（`_?=` 放最后、不加引号），再确认注册表项、快捷方式、目录都清干净。

**手工步骤（A、B 都做）**，自己写一个一次性脚本，不提交。A 的话脚本放进 `$S\in\`，在沙盒里手动跑（第一次的执行器收尾后机器本来就是干净的，也可以关掉重开一个沙盒再做，关掉即丢弃）；B 的话放在 `C:\nomi-win-check\`：

1. `Nomi-win-x64.exe /S /D=<目录>`（旧包；`/D=` 必须在最后、不加引号、路径无空格），退出码应为 0。
2. 在目录里放外来文件并记 SHA256：子目录文件（如 `resources\user-notes\a.txt`）、`.docx`、`.jpg`、`.bin`、一个只读文件（`attrib +R`）、一个隐藏文件（`attrib +H`）、一个空目录、一个 0 字节文件。
3. 新包升级：`Nomi-new.exe --updated /S`（自动更新的调用方式，不带 `/D`），记退出码和耗时。再从第 1 步重来一遍，这次升级不加 `/S`，真人路径走一遍，每个界面截图（能操作界面才做，做不了写 unverified）。
4. 起应用：设四件套，再把 `HOME`、`USERPROFILE` 指到空目录，运行 `<目录>\Nomi.exe`，等 20 秒。事先在隔离项目目录里放一个测试项目（仿照执行器的做法：`<项目名>\.nomi\project.json`）。

**判据（逐条给结论）**

| 编号 | 通过条件 |
|---|---|
| J1 | 升级后每个外来文件都在，SHA256 不变，只读和隐藏属性还在，空目录还在。执行器 A1、A2 过且手工步骤一致 |
| J2 | 卸载旧版那一步没有报错框：静默升级对话框数为 0；非静默那次逐屏截图，没有错误框，没有「Nomi 没有更新」或 `Nomi was not updated` 字样（出处 `build/installer.nsh`） |
| J3 | 升级后应用能打开：`Nomi` 进程 20 秒后仍在，`MainWindowTitle` 非空，截图；注册表里 Nomi 的版本号是新版 |
| J4 | 隔离资料里的测试项目文件，应用起过一次后 SHA256 不变 |
| J5 | 安装目录大小合理：升级后的大小减去全新安装的大小，要能被外来文件加上 `report.json` 里 `legacyOnly` 列的旧版独有文件解释；解释不了记红 |

第二遍（协调贴出候选包地址后）：下载候选包，同样核对哈希，只要它同时带了 manifest 和 `win-unpacked` 就同样跑执行器，否则只做手工步骤并写明。红的写可重复步骤，附 `runner.log` 片段和对话框记录。

## 任务 2 保存在 Windows 上

用户报过 Windows 上保存一直失败（自动保存连败 27 次）。#1390 修了，#1389 加了故障扫描，两者只在 Mac 上跑过真窗。
```
pnpm run build
$env:NOMI_SAVE_DRAFT_OUT='C:\nomi-win-check\t2-save'      # 必须是绝对路径
node tests\ux\project-save-draft-contract.walk.mjs; "exit=$LASTEXITCODE"
pnpm exec vitest run electron/workspace/saveFaultSweep.test.ts; "exit=$LASTEXITCODE"
```
- 走查一次跑中英两轨，真窗口里新增未命名人物卡、清空名字、切回默认画幅都要能存；还含正常关闭重开、强制结束重启、EBUSY 占用提示（脚本补丁模拟）。证据在 `NOMI_SAVE_DRAFT_OUT` 下的 `observations.json` 和截图。
- 故障扫描是 Node 里模拟 I/O 故障（7 类 I/O、5 种错误码），含真新进程重启；它在默认 vitest 车道里，没找到文件就如实报。
- 重点看：Windows 文件锁、杀毒占用、rename 失败。走查里的 EBUSY 是脚本补丁抛的，不是真锁。可选加做（只对隔离目录，要能操作界面才做）：应用开着隔离项目，在隔离项目目录里找到 `project.json`，用 `$h=[IO.File]::Open($f,'Open','Read','None')` 独占占住，在界面里改名触发保存，看提示是不是「被占用」类原因，不是笼统失败；`$h.Dispose()` 放开后再保存应成功。
- 同步盘和杀毒占用由任务 4 的 `--held` 模拟。真杀毒软件的占用没有安全的模拟办法，报告里写 unverified 和原因。

## 任务 3 生成等待在 Windows 上

#1393 只在 Mac 上量过，弱机和 Windows 没量。零花费：环回假供应商。
```
$env:GENERATION_IDLE_OUT='C:\nomi-win-check\t3-idle-zh'; node tests\ux\generation-idle.walk.mjs; "exit=$LASTEXITCODE"
$env:GENERATION_IDLE_OUT='C:\nomi-win-check\t3-idle-en'; node tests\ux\generation-idle.walk.mjs --en; "exit=$LASTEXITCODE"
node scripts/perf-scenarios.mjs --measure-only --id generation-idle-60  --out C:\nomi-win-check\t3-perf-60.json;  "exit=$LASTEXITCODE"
node scripts/perf-scenarios.mjs --measure-only --id generation-idle-100 --out C:\nomi-win-check\t3-perf-100.json; "exit=$LASTEXITCODE"
```
- 走查：12 个任务等待、灰格静止、重启后原单不丢不重下；输出 `<语言>-report.json` 和截图。性能场景每个至少跑 5 次，预算 33ms（帧间隔 p95），退出码 1 表示超预算、退化或没采到数据。
- 要记：显卡型号、devicePixelRatio、帧间隔 p95 和中位数；落卡数（12 个结果落进工程文件，应 12/12）；下单数（假供应商收到的提交次数，重启后必须仍是 12，多了就是重下）；还有性能输出里 `GENERATION_IDLE {...}` 那行的 `idleDraws`、`idleSaveIPC30`、`idleSnapshotWrites`。Mac 上改后这三个都是 0，帧间隔 p95 约 10ms。
- `load1AtStart` 在 Windows 永远是 0，别引用，用上面自己量的 CPU 数。

## 任务 4 卡顿巡检（发版流程必做）

`docs/release-process.md` 规定发版前要在 Windows 上跑这条：过去有三个 Windows 专属问题（等待动效着色器编译卡死、同步盘占用让存盘锁卡住、导入被清理错误改写成失败），Mac 和 Linux 全测不出来。

这条要真焦点，窗口会到前台、会抢键盘。**跑之前先问用户一句：「接下来这台机器的前台能让我占用一会儿吗？」用户同意才跑；不同意，报告写「未跑：用户当时在用」，不算红。**
```
pnpm run build
$env:NOMI_WALK_FOREGROUND_OK='1'
node tests\ux\windows-freeze-sweep.walk.mjs --label check; "exit=$LASTEXITCODE"
node tests\ux\windows-freeze-sweep.walk.mjs --label check --held; "exit=$LASTEXITCODE"
Remove-Item Env:NOMI_WALK_FOREGROUND_OK
```
- 判据：`tests\ux\shots\windows-freeze-sweep\check\report.json` 和 `check-held\report.json` 都 0 红、0 残留锁（`leftoverLocks`），截图自己看过。
- 这一遍是演练。协调贴出候选版的提交号后，切到那个提交重新构建，用 `--label rc-<版本>` 再跑两条才算数。
- 用时未核实。退出码 125 表示放行变量没设上，检查后重跑。

## 任务 5 画布远看缺块（占位，暂不做）

#1394（画布远看缺块）还没合入。协调会在 PR 上贴出提交号，贴了才跑。到时：
```
git fetch origin fix/canvas-detail-admission
git worktree add C:\nomi-win-check\canvas <提交号>
cd C:\nomi-win-check\canvas; pnpm install --frozen-lockfile; pnpm run build
node scripts/perf-scenarios.mjs --measure-only --id canvas-far-dense-blank --out C:\nomi-win-check\t4-blank.json
node scripts/perf-scenarios.mjs --measure-only --id canvas-far-dense-pan   --out C:\nomi-win-check\t4-pan.json
node tests/perf/canvas-scale-bench.mjs --scales D60 --scenarios far-dense-pan --runs 5   # 不强制显卡内存和缩放：真机本来的样子
```
- 场景在分支 `fix/canvas-detail-admission` 上（`tests/perf/scenarios/canvas-far-dense-*.json`），当前 main 里没有。登记的跑法带 `--gpu-mem-mb 512 --dpr 1.25`（模拟 Windows 1080p 缩放 125%）。要两种都量：登记的和不强制的。Windows 集显正是这条修复没测过的环境。
- 看 `blankCardPct`（预算 1，应为 0）和 `frameGapP95`（预算 33）。
- 素材：`tests/ux/real-media-fixtures.json` 登记了真实素材（素材不进仓库），位置由 `NOMI_REAL_MEDIA_DIR` 指定。这台机器上没有登记素材、脚本报缺素材，就写 unverified 和脚本原话；不许用合成素材顶替。

## 不归你的一条

发版流程还要求「Windows 上 Agent 真能说话」：同一台机器、同一个候选版，配一个真实文本模型，在生成面的 Agent 面板连发三句。这要真 Key、会花钱，你不做也不要代做。候选版出来后，协调会请用户亲手做。

## 交回

`docs/evidence/2026-10-31-windows-release-check/report.md`，每条任务一节，写：

- 结论：过 / 红 / unverified，加原因；
- 命令和退出码；机器信息（Windows 版本、CPU、显卡、内存、缩放）；
- 亲眼看到了什么（截图你自己看过再提交）；
- 红的：可重复步骤和日志片段（脱敏）。

写报告用编辑器工具或 Node，不要用 PowerShell 5.1 的 `>`、`Set-Content`（会带 BOM 或写成 GBK）。
```
git add docs/evidence/2026-10-31-windows-release-check
git commit -m "docs(evidence): Windows 真机检查报告"
git push
```
- 只 `git add` 上面这个目录，不要 `-A`，一次性脚本和产物不提交。
- 推送前钩子（`scripts/pre-push-contracts.mjs`）会按改动自动跑，没有绕过开关；它读 GitHub 上本 PR 的正文，需要 `gh` 已登录。正文里的 `## 短版设计卡` 一节别删别改（缺了它判据就红，Mac 上用 `NOMI_PR_BODY_FILE=<正文文件> node scripts/check-pr-judgement.mjs` 核过）。具体选哪些门岗以钩子输出为准（纯文档会选到哪些，未核实）。
- 钩子红了：内容原因（敏感信息扫描报路径、用户名）就改内容；环境原因（`python3` 别名退出 49、换行、路径分隔符，见上面那条教训）不要绕，不要 `--no-verify`，停下把钩子输出原文告诉用户。
- 推送成功后告诉用户「做完了」。协调会 `git fetch` 读报告。
