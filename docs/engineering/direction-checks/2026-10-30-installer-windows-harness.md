# 方向检查：Windows 安装器场景脚本第一次真跑（PR #1381 第 3 轮，草稿）

> 触发：同一条线第 3 轮修补，同一 PR 的 Windows 验收第 2 次不过（模板触发 4）。上一轮复盘 `docs/engineering/direction-checks/2026-10-30-installer-nsis-compile.md` 写明：Windows 作业若红在编译、场景或删除范围，就停止代批、交用户。本轮红在「场景」，所以交用户拍板。

## 0. 一句话根因

Windows 场景脚本（869 行）在 Mac 上写成，合进 PR 前一次都没在 Windows 上跑过，就被设成发版硬门。于是每推一次只剥开一层没跑过的问题；脚本又把 PowerShell 的真实错误吞掉，每一层都只能靠猜。

## 1. 归类表

| 运行 / 提交 | 直接原因 | 类 |
|---|---|---|
| 40921209572（aff208710） | NSIS include 用正斜杠，Windows 编译器拆不开路径 | 跨平台构建没在目标平台真跑过。088a22643 已修好：41008253991 里主包打包、三个反例包都在 Windows 编译成功 |
| 41008253991（ff328a204）：A1–A13 全红，每个约 1 秒 | `resetMachine` 在 `$ErrorActionPreference='SilentlyContinue'` 下以 `Remove-Item <work>\s` 收尾。干净机器上没有这个目录，错误被静音，但 `$?` 为假。按官方说明，`-Command`（`-EncodedCommand` 同理）进程「最后一条命令 `$?` 为假即退 1」[^ps]。helper 把 stderr 当错误原文，可 stderr 里只有「Preparing modules for first use」进度记录 | 测试脚本没在目标平台跑过，错误又被吞 |
| CX1–CX3「NOT RED」 | 同上：反例在重置那步就停了，没测到安装器 | 同上。脚本自带的「准备失败不算红」判据正常拦住了假红 |

[^ps]: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_powershell_exe?view=powershell-5.1 ，-Command 一节：「The exit code is 0 when $? is $true or 1 when $? is $false.」

## 2. 为什么会一直出现

- **执行处只有一个。** 脚本每一步只能在 Windows 上执行。本机没有 Windows，也没有 pwsh（`which pwsh` 为空），唯一能跑的地方是推送触发的 CI。每轮代价约为：本机完整检查 20 分钟 + Windows 作业 7–40 分钟 + 协调一轮。
- **后面全是第一次。** 13 个场景、3 个反例从没完整跑过。重置之后还有这些层都是第一次执行：
  - 装 0.24.0 旧包；
  - 对话框监视器；
  - 文件锁助手；
  - A6 提权（per-machine）；
  - 注册表核对。
- **错误被吞，两头都会错。** 11 处 PowerShell 片段都按「退出码 + stdout」判断。`SilentlyContinue` 吞掉错误；退出码又只看最后一条命令。结果「其实没事却退 1」和「出了错却退 0」都可能发生，而且没有错误原文。
- **铁律 ⑫ 适用：** 用户以为升级、卸载后项目还在。结账挂的类检查仍是 Windows A1–A13 / CX1–CX3，目前没有一个真正跑到安装器。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 只补 `resetMachine` 末行，下一次 Windows 作业会红在下一层没跑过的步骤（装旧包、对话框监视器、文件锁助手、A6 提权之一），错误原文仍可能为空 | 只补一行后重跑 Win Installer Scenarios，看首个失败步骤和错误原文 |
| 「出了错却退 0」：`attributesOf` 里 `Get-Item` 找不到文件时，只写一条不中断的错误；随后 `.Attributes.ToString()` 打在空值上，那一项被跳过；最后的 `ConvertTo-Json` 成功，退 0。于是返回的数组比文件列表短，A2 的属性断言会对错位 | 在 Windows 作业里对含一个缺失文件的列表调用 `attributesOf`，比较返回长度 |
| 其它以可能失败命令收尾的片段（如 `setRegistryValue` 的 `New-ItemProperty`）在特定机器状态下同样无故退 1 或静默成功 | 逐个片段构造「目标不存在 / 已存在」两种状态各跑一次 |

## 4. 靶子独立性

- 场景脚本、反例、Mac 普查都出自同一条实现线。本轮红的是尺子自己，不是安装器。按模板：靶子有错，先修靶子。
- 修靶子时**不得动 `build/installer.nsh` 的删除逻辑**。靶子修好后，如果场景红在安装器行为上（用户文件被删、弹出对话框、退出码不对），那就是安装器本身的问题：立即停，交用户。

## 5. P0：这些是我们独有的吗

- **删文件、杀进程、查注册表都是通用能力：**
  - 删文件用 Node 自带的 `fs.rmSync(path, { recursive: true, force: true })`：目标不存在即算成功。脚本里的种子目录已经这么删；
  - 杀进程已用 `taskkill /T /F`；
  - 注册表留在 PowerShell 里，但统一包装：脚本级 `$ErrorActionPreference='Stop'`，片段末尾显式 `exit 0`，出错时用 try/catch 把错误原文和行号写到 stdout 再 `exit 1`。
- **我们独有的只有场景本身：** 哪些文件属于用户，升级、卸载后必须原样还在。

## 6. 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成 + 一次补齐 | ① 文件删除全部改用 `fs.rmSync(force)`，删掉 PowerShell 删文件的写法；② 剩下的 PowerShell 片段走同一个「出错即停、显式退出、原文上屏」包装，Mac 上加一条测试钉住（每个片段都经包装，禁止脚本级 `SilentlyContinue`）；③ 推上去连跑 Windows 作业，最多 3 次推送：红在脚本就修，红在安装器行为就停、交用户 | 约 2–3 小时，大头是等本机检查和 Windows 作业 | 3 次后仍有没跑通的层 → 停下，带每次的错误原文交用户 | **推荐** |
| 只补这一处 | `resetMachine` 末行改成先判断存在，再推一次 | 约 1 小时一轮 | 大概率还有下一层，每层一轮，错误原文仍可能为空 | 不推荐 |
| 重写 | 改用 Pester 重写整套 Windows 场景 | 一天以上 | 远超本单，安装器修复延后 | 不推荐 |
| 删 | 去掉 Windows 场景门，只靠 Mac 普查 + 真编译 | 最快 | 安装器的升级 / 卸载没在真 Windows 上验过就发出去，正是这次事故的形状 | 不接受 |

## 7. 用户要权衡的核心

多花一两个小时，把「测试脚本第一次在 Windows 上跑」一次跑通，以后每次红都能直接看到真原因；还是赌只差这一处，省一小时，但可能一轮一轮再来。

## 特征测试清单

- **现状钉在 CI 运行 41008253991：**
  - A1–A13 各约 1 秒退出；
  - 错误原文只有进度记录；
  - CX1–CX3 NOT RED；
  - 编译、打包、下载旧包四步全绿。
- **本机复现不了：** 没有 PowerShell。Mac 侧只能静态钉住片段形状，这正是方案 ② 要加的测试。
- **已有：** `tests/installer/installerScenarios.test.mjs`（Mac 普查 + 真编译，32 例）。

## 裁定

用户 10-30 14:4x 拍板「一次补齐（推荐）」。本轮最多 3 次推送；红在安装器行为就停，交用户裁定。不改安装器删除逻辑、场景期望、反例定义或 Windows 作业及其硬门地位。
