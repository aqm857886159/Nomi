# Windows 升级 / 卸载只删安装器自己装的文件

线：I-installer-r4；类别：可打断。2026-10-30 用户裁定甲，见 [方向检查与裁定](../engineering/direction-checks/2026-10-30-installer-keep-user-files.md)。本页是第 4 轮动手前合同，替换原搬家方案。

事故：用户把项目放在 `F:\Nomi_new\xiangmu`，从 0.24.0 更新后五个项目被默认卸载段永久删除。

## ★0 先查别人

| 出处 | 它怎么做 | 对决定的影响 |
|---|---|---|
| 本机 electron-builder 26.15.3 `installer.nsi:67–81`、`installSection.nsh:52–58` | customInit 在初始化里、早于安装段；安装段按注册表调用旧卸载程序（HKLM 安装后还查 HKCU） | 在 customInit 换掉不可信文件，覆盖 UAC 内外实例，不改默认应用退出检查 |
| 同版本 `include/installUtil.nsh:155–175,209–230`、`include/installer.nsh:100,121–125`、`out/targets/nsis/NsisTarget.js:298` | 按 UninstallString 取引号中路径，复制到插件目录执行；本版卸载程序本来就随包写入 | 同样读路径、含第二注册表键回退；提前写入本版卸载程序，默认调用链继续 |
| [NSIS RMDir 手册](https://nsis.sourceforge.io/Docs/Chapter4.html#rmdir) | 递归删安装目录会误删用户文件；非递归只删空目录 | customRemoveFiles 逐文件按构建清单，目录不递归 |
| [Revenera 大版本升级](https://community.revenera.com/s/article/modify-uninstall-behavior-of-a-previous-version-during-a-major-upgrade) | 可以提前改变已装旧包的卸载行为 | 从根上拿掉删除者，删除搬家事务 |
| [MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw) | REPLACE_EXISTING、COPY_ALLOWED、WRITE_THROUGH | TEMP 与安装目录可不同盘；只替换登记的卸载程序，失败中止 |
| [NSIS MessageBox](https://nsis.sourceforge.io/Docs/Chapter4.html#messagebox) | 不带 /SD 在静默下也弹框 | 失败明确点名路径，exit 2，不调用不可信卸载程序 |

模板原文已全文核读 installer.nsi、installSection.nsh、include/installUtil.nsh、uninstaller.nsh、include/installer.nsh；模板指纹保留。默认旧段 uninstaller.nsh:164–187 是递归删除，必须一次也不跑。所谓「上游 / 旧版改不了」必须附定位与调用点原文，不能只查被调用者。

## ★1 用户怎么用与量具

用户照常更新、覆盖安装、改目录重装或卸载。安装器先把不可信的登记卸载程序换成本版只删清单的卸载程序，再沿模板原流程升级；用户文件始终原地不动，含 resources/locales 子目录。用户文件独占打开也不妨碍升级。之后 customInstall 写 RemovesOnlyOwnFiles=<本版版本>。

量具：Windows 真安装器 report.json。主指标是每个用户文件 SHA-256 幸存率 100%；替换失败时 100% 中止（退出码 2、恰好一个中英双语对话框，含路径、旧登记及应用完整）；正常步骤退出码 0、无对话框。安装器耗时记录 durationMs。旧包文件减本版清单以 legacyOnly 记录，不能把旧应用残留冒充用户文件或隐去。

唯一新增失败文案：「Nomi 没有更新。无法替换旧卸载程序 <路径>，为避免删除你的文件，更新已经停止。请关闭占用它的程序并检查写入权限，再重新更新。Nomi was not updated. The old uninstaller <path> could not be replaced. The update stopped to protect your files. Close programs using it, check write permission, and update Nomi again.」不带 /SD。

## ★2 谁说了算

- 文件归属：afterPack 的 computeInstallerManifest 遍历剪完平台二进制的产物，一次生成 NSH/JSON；卸载按清单，目录最深在前非递归删除。卸载器、elevate.exe、可选图标按模板补齐。
- 可信标记：RemovesOnlyOwnFiles 非空且等于同根卸载项 DisplayVersion。失配即替换，版本不和正在运行的安装程序版本比。
- 路径：与模板一样 HKCU 一轮、管理员再 HKLM 一轮；UninstallString 空时回退 UNINSTALL_REGISTRY_KEY_2；用模板 GetInQuotes。文件不存在跳过（模板无法启动它）；替换失败直接 Quit。
- 只保留 customHeader/customInit/customRemoveFiles/customInstall 四个文档化钩子；customInstall 只写标记；删除待恢复记录、旁边目录、说明文件、恢复对话框、隐藏段及未文档化钩子。
- door-map `quitAndInstall install --roots=electron`：4 门，应用启动入口不改，统一汇到 NSIS 初始化与卸载段。概念 owner 为 delivery.installer-owned-files。

## ★3 一致与复用

保留 electron-builder 26.15.3、nsis.include、默认应用退出检查及旧卸载结果处理；不覆盖整份模板、不新增包。新卸载器升级时只将清单文件挪到插件临时目录、失败还原（保留模板原子升级语义）；普通卸载只 Delete 清单，绝不移动用户文件。NSIS 真实编译沿 electron-builder build API 的两轮模板，-WX，极小 payload；过期清单 / 非支持形态编译失败。PowerShell 共用 powershell-boundary.ps1（Stop、原文、显式退出），文件系统清理由 Node 负责。

## ★4 全状态与失败模式

- 未安装 / 登记文件不存在：无删除者，模板继续。
- 标记可信：原文件保持；缺失 / 过期标记：从包提取到 PLUGINSDIR，再 MoveFileExW 原路径替换。
- 替换任一步失败：一个双语框含登记路径，exit 2/Quit，早于模板执行旧卸载程序。旧应用和用户文件保持，解除占用后重试。
- 替换成功：用户文件不动；模板只会启动清单卸载器；不创建、不认领任何旁边目录。
- 中断后：文件仍在原处；已替换卸载器仍只删清单；遗留卸载进程即使晚跑也只删应用文件，应用缺失可重新安装到原目录。
- 取消 / 解包失败：用户文件原地；应用可不完整，重跑安装程序。取消不恢复旧危险卸载器。
- 旧版独有文件：本版清单不认识，留在原处；报告 legacyOnly，不能扩大删除。

## 5 中途表

所有花费为无；无需联网。

| 状态 / 打断 | 取消 / 关窗 | 断网 | 重启 / 断电 / 强杀 | 连点 |
|---|---|---|---|---|
| 替换前 | 旧安装未删除 | 无影响 | 用户文件原地 | 模板互斥锁 |
| 提取 / 替换中 | 失败即中止 | 无影响 | 用户文件原地；下次重试不可信登记 | 模板互斥锁 |
| 清单卸载器运行中 | 沿模板 | 无影响 | 卸载器可继续，只删应用文件；重装原目录 | 模板互斥锁 |
| 解包中 | 模板 Quit | 无影响 | 应用可不完整，用户文件原地，重装 | 模板互斥锁 |
| 完成 | 写入可信标记 | 无影响 | 无新增影响 | 模板互斥锁 |

## 6 外部数据与失败

模板指纹变动要求重读调用链、重跑全部场景。不支持 oneClick/perMachine-only/web/非 x64 构建直接 !error；文件关联与 NSIS 不支持的文件名由生成器拒绝。旧包用 Release v0.24.0 且 SHA256SUMS 校验。MoveFileExW 任一步失败不回退危险执行。

## ★7 性能

无新增应用内操作。替换最多两份卸载程序，用户文件数量不影响替换次数；卸载按构建清单。量具 Windows durationMs，无新增性能场景。

## 8 真实条件与边界

Windows Actions 真装真升真卸；Mac 只验证静态合同与真实 NSIS 编译，不能证明 Windows 行为。UAC 弹窗 / 内层、非静默更新界面、杀毒软件、真实断电、早于 0.24.0 的登记形状均 unverified。测试只动 runner 的隔离测试资料。未触碰真实用户资料、不读 Key、不花钱。

控制面板直接卸载尚未更新的 0.24.0 仍危险，应先移出项目；更新本身按新合同保护。内部测试机留有 .nomi-keep 时手动挪回，本版不认领它。

## ★9 验收与反例（动手前合同）

第一推送只改测试 / 文档，installer.nsh 按字节不动：A1 嵌套、A14 迟到删除、A15 误认领必须在旧实现红，其余场景保持。IFEO 无信号是准备失败；卡不住改抓取重放。第二推送实现后全部 A1–A16 + 反例通过；安装器行为红即停。最多三次推送。

每个正常步骤 exit 0、无意外对话框；每个种子 SHA-256 和属性不变；除了 A15 用户预建目录，不出现 .nomi-keep。场景登记与下表逐行普查。

| 编号 | 场景 id | 怎么做 | 核什么 |
|---|---|---|---|
| A1 | `old-to-new-user-folder` | 0.24.0 + 三处数据，安装目录含项目/散文件及 resources\user-notes\a.txt、locales\my.txt；更新，再卸载 | 两次后三处用户文件全留，应用完整与清单精确对账，新版本 / 标记，卸载登记清空 |
| A2 | `old-to-new-dir-full-of-user-files` | 中文空格、多层、隐藏、只读、空目录、零字节；旧升新再卸载 | 用户文件和属性不变，清单全删 |
| A3 | `old-to-new-app-still-running` | 旧应用以用户目录为 cwd 活着时更新 | 默认检查结束应用后成功，数据不变 |
| A4 | `old-to-new-locked-user-file` | 独占用户文件时旧升新 | exit 0，无框，原路径字节不变 |
| A5 | `old-to-new-changed-dir` | 旧装 A，新包 /S /D=B | A 数据保留、应用清单全删，B 完整与登记 |
| A6 | `old-to-new-per-machine` | allusers 旧升新再卸载 | HKLM 标记正确，所有步骤无框含卸载 |
| A7 | `old-to-new-stale-marker` | 标记等于新版本但不等于旧 DisplayVersion | 不能误信，数据留 |
| A8 | `old-to-new-no-foreign-then-uninstall` | 无用户文件旧升新再卸载 | 清单精确，卸载目录不存在；legacyOnly 非空时只剩这些 |
| A9 | `interrupted-after-replace` | 预置本版卸载器覆盖旧登记文件，再升级 | 数据不变，应用完整，新版 / 标记 |
| A10 | `interrupted-after-replaced-uninstaller-ran` | 同上再按模板参数运行清单卸载器；新包 /S /D=L | 数据原地，重装进 L，登记与标记正确 |
| A11 | `new-to-new-update` | 新升新、三处数据含嵌套且用户文件独占，再卸载 | 每次后三处都留，无旁边目录 |
| A12 | `new-to-new-changed-dir` | 新版改目录 | 旧目录只剩用户文件，新目录完整 |
| A13 | `new-uninstall-keeps-user-files` | 顶层和 resources 用户文件，普通卸载 | 清单删光、用户原样、登记/快捷方式清空 |
| A14 | `late-deleter-after-killed-installer` | IFEO 两视图卡 old-uninstaller.exe；记录路径/参数/哈希；去 IFEO，只杀父安装器不带 /T；重跑更新；放行卸载器；最后 /S /D=L | 迟到卸载后每个用户字节不变；被卡映像等于本版卸载器（旧特征阶段等于旧版）；重装后完整 / 新登记 |
| A15 | `unowned-sidecar-untouched` | 无待恢复记录；预建 L.nomi-keep 含用户说明文件/私人.txt/子目录；旧升新再卸载 | 旁边目录路径与 SHA 全等，没有额外东西；L 无私人.txt；两步无框 |
| A16 | `old-to-new-locked-uninstaller` | 独占登记卸载程序，升级；释放再试 | 恰好一个框含路径，exit 2，旧应用 / 登记 / 用户文件保持；重试成功 |

M1：清单生成器特殊名字、空目录、链接防环、elevate/perMachine、架构/文件关联/非法名拒绝、重复生成字节一致；NSH/JSON/独立树三方对账。M2：afterPack win32 写、linux 不写。M3：四钩子、标记、清单路径、12 模板指纹、场景/卡逐行对应、默认项目位置、Windows 工作流全场景与反例、发版硬门；新增调用唯一性与写目标白名单普查，每条必红自检。真实两轮 NSIS 编译与非法指令必红；PowerShell wrapper/CLIXML 默认测试保留。

| 编号 | 变异 | 必红位置 |
|---|---|---|
| CX1 | 卸载加回递归删除 | A13 用户文件缺失 |
| CX2 | 替换函数入门 Return | A1 子目录用户文件缺失 |
| CX3 | 失败框加 /SD IDOK | A16 静默缺对话框 |
| CX9 | 替换函数入门 Return | A14 映像不是本版卸载器 |
| CX10 | 替换函数开头删除旁边目录说明文件 | A15 用户说明文件缺失 |
| CX11 | 版本比对永远可信 | A1 子目录用户文件缺失 |
| CX4–CX8 | 空目录遗漏 / 递归删 / 模板一字节 / workflow --only / 候选不等安装器 | 对应 Mac 普查必红 |
| Mac 写目标 | 副本末尾加 Delete "$INSTDIR.nomi-keep\x" | 白名单普查必红 |
| Mac 接线 | 去掉 customInit 调用 | 调用唯一性普查必红 |

Windows 反例在独立 include 副本重打包，不改生产源码；结束按字节核对源码未变。发版硬门 desktop-rc 无条件调用 windows-installer，finalize 等它，release 只晋级 success。测试包同提交同配置、测试版本后缀，非字节相同候选 exe。

实施记录：特征阶段仍保留旧 A4/A9/A10 期望与旧钩子普查，第二阶段同提交替换，不留并行实现。Windows 运行编号待写入。独立验收由协调另派，尚未通过。
