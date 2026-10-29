# 方向检查：安装器编译闭环（概念级热点）

## 0. 一句话根因

安装器的运行行为、跨平台编译和交付治理原先分开验证，缺少推送前执行真实 NSIS 编译这一层；本轮已补编译尺子，但新增合同的 owner 登记直到完整 gates 才暴露遗漏。

## 1. 归类

| 提交/问题 | 直接原因 | 类 |
|---|---|---|
| 原安装器数据事故及 0d854b0b7 | 上游默认整目录删除 | 安装器的文件归属边界 |
| Windows 40921209572 / 088a22643 | NSIS Windows 路径拆分只认反斜杠，原 include 用正斜杠 | 跨宿主构建契约未经真实编译 |
| 本轮 gates / 待提交三文件 | 新合同宣告共享边界，却没登记概念 owner；通用 compile 名称撞上其他定义 | 构建治理元数据未闭环 |

`node scripts/fix-churn.mjs --staged` 命中的是「概念」口径（该概念含 3 个文件，近 14 天已有 2 个 fix），这次要提交的三个文件自身没有报热点。实现线按「命中即停」停下，交协调会话裁定（见文末「裁定」）。

## 2. 为什么会再出现

清单逐项比对和模板指纹验证不了编译器是否接受脚本；Mac 编译又抓不到 Windows 路径拆分。治理元数据需要把真实编译入口和 manifest owner 对上，不能只在文字合同里声明。

铁律⑫适用：用户以为更新/卸载后项目还在。结账挂的类检查是 tests/installer/installerScenarios.test.mjs（默认车道及推送前守卫）和 Windows A1–A13/CX1–CX3。后者仍未运行，不能用编译绿代替。⑩/⑪不涉及本轮模型参数或可选项。

## 3. 可验证预测

| 预测 | 验证 |
|---|---|
| 只跑 Mac 编译，原来的正斜杠 include 仍可通过 | 修前完整 Mac Windows 包已成功；Windows 路径断言修前失败 |
| 再写非法 NSIS 指令，普查会阻止交付 | 编译反例在 include 副本追加 NomiInvalidInstruction，真实编译器拒绝；32 例全绿含此反例 |
| 只声明边界不登记 owner，完整 gates 继续红 | 初轮 gates 107 项中唯一阻断项为 check:concept-owners；当前待提交登记修正已单跑通过 |

## 4. 靶子独立性

本线写了编译夹具及 Windows 路径断言；编译判定来自 electron-builder 26.15.3 下载的 NSIS 3.0.4.1 实际编译器和上游安装/卸载模板。Windows 真装真升真卸尚待协调触发并独立验收。本轮没有修改视觉基线；完整 gates 中出现的 136 项视觉差异被当前门岗作为非阻断结果处理，不能当成界面验证通过。

## 5. P0

通用编译使用现成 electron-builder build API、上游模板与 makensis；没有另装包或自写编译器。只删安装器自己文件是本项目领域安全约束，上游默认删除行为无法直接满足，继续保留既有自定义 NSH，不扩写运行时特例。

## 6. 选项与推荐

| 选项 | 做什么 | 代价/风险 | 推荐 |
|---|---|---|---|
| 接入现成编译链 | 保留真实两轮编译守卫；审查当前三份待提交文件的 owner 登记与命名，拍板后提交并完成全量验证 | 不新增运行时分支；仍要完整 gates、修后全包和 Windows 作业证据 | 推荐 |
| 继续补运行时逻辑 | 在 NSH 新增平台/版本特例 | 目前没有证据需要，会扩大数据保护风险 | 不推荐 |
| 重写安装器 | 换安装框架 | 需重验升级兼容及旧卸载程序，远超本单 | 不推荐 |
| 删定制 NSH | 恢复上游默认 | 恢复整目录删除风险 | 不接受 |

依据：electron-builder v26 跨平台文档、安装的 NsisTarget/getMakeNsisPath 实现、NSIS v304 scriptpp.cpp/util.cpp（设计卡列有链接）。

## 7. 核心权衡

当前新增的是编译预防和治理登记，是否允许在概念级热点下完成这次闭环，再以完整打包及 Windows 场景验收，而不扩展运行时修补。

特征测试：scripts/packaging/installer-manifest.test.mjs；tests/installer/installerScenarios.test.mjs，后者调用 scripts/packaging/installer-compile.cases.mjs。当前工作区 2 文件/32 例通过；概念 owner 及根因合同单跑通过。

## 裁定（协调会话，2026-10-30）

按 P1 的例外条款代批，事后报用户：

- 命中只因概念口径：这三刀都落在同一个 PR 的开发过程里（实现、Windows 首跑红在编译、补登记），不是上线后反复回来的同一个 bug。本提交要改的三个文件本身没命中。
- 改法是换，不是补：
  - 把 088a22643 已经写好的两个入口（`build/installer.nsh` 的 `!include`、编译守卫 `compileInstallerTemplates`）补登到既有概念；
  - 通用名 `compile` 改成 `compileInstallerTemplates`，同提交删掉旧名；
  - 根因合同不再把通用的 `SCAN_GUARDS` 记成安装器的 owner。
- 没有新增运行时分支或特例：installer.nsh 的删除逻辑一字未动。

不再代批的条件：推送后 Windows 安装器作业如果红在安装器本身（编译、场景或删除范围），而不是登记口径，就停止修补，这份复盘连同新证据交用户拍板。
