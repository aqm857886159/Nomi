# 素材库删除在版本撤销期内延后回收（短档）

## 变更意图
- 意图：纯修复
- 候选档位：短
- 单一意图：是
- 声明：纯修复：不改用户可见元素、布局、文案
- 界面核实：无界面差异

## 短版设计卡
- ★1：创作者删版本→在项目素材删除原文件→提示条撤销或⌘Z→主图仍能解码、重启仍能使用；不撤销关项目须回收腾空间。主指标：两条任务中英通过率100%，量具 tests/ux/asset-liveness-storyboard-ref.walk.mjs 的 library 模式（toast/keyboard/none）；护栏：asset-library-interactions.walk.mjs 中英确认卡原文和在用保护不变。★1b：沿用版本提示条、素材库确认卡，不加元素/文案。★1c：不改存盘格式；真实0.24.1退出载荷复制件 SHA256 ec8a51d2886a8151332648aaaea7924de6ce50ad0f6fb88e132d0601726b8c5c 通过原走查 old-source 模式打开、保存、退出重开。
- ★2：asset.library-deletion 的 planAssetDeletion 判断 keep / trash / defer；deleteAssetResult 唯一执行口；pendingAssetDeletions 沿用 source=asset-library、日志位置、到期再判引用、持久化与失败重试。画布日志主人只提供可达撤销/重做投影与绝对位置，不决定文件命运。列表只看当前活引用，撤销材料不阻止隐藏。到点由现有 release 负责销账或回收；读不全仍保留，未知不当无人用。工具：door-map deleteAssetResult 得2扇直接写门（AssetLibraryPanel/capabilityApplyHandler），git grep 再追浏览器经 assetFileDeletion→主进程→capabilityApplyHandler；6个生产调用文件。删除规则仅 asset-file-owner 一份管 deleteFiles/deleteAssets，版本面再禁能力/浏览器删除入口。
- ★3：D-1117-liveness-no-auto-recycle、D-1113-blocks、D-1118-asset-undo-defer-recycle 仍适用；原方向修：把撤销保留期限交回已有待删机制（选择）；换完整素材身份图：超过本刀且需存量迁移；删素材库回收：失去腾空间能力，拒绝。复用 planAssetDeletion/isProjectFileReferenced、pendingAssetDeletions，不新增存盘字段、不逐门补判断。热点方向复盘见 docs/engineering/direction-checks/2026-11-17-asset-liveness.md。
- ★4：空/加载沿用现状；成功：版本消失、原文件留在项目素材；素材库删除后待删文件隐藏；撤销：主图与文件列表恢复；失败：现有删除失败提示且撤回待删记账；部分成功：原有多选计数；取消中：不新增取消过程，确认卡取消不做事；过期：撤销日志挤出/关项目后再判引用并回收；能力不可用：缺桌面桥沿用失败回执，不改变入口。中英文均沿用原词条，删无引用 assetUnavailable/deleteFileFailed。
- ★9：先跑主分支真窗口中文，主图/重启裂图且文件进一次性映像卷回收站才算复现；修后中英 toast/keyboard 任务主图、项目素材列表、原路径SHA、全退出重开解码必须全部成立；none 任务关项目后恰好回收一次。反例：①主分支原样，toast任务红；②素材库删除全部延后不删，none任务红；③桥批量删除、能力删文件、浏览器素材盒三种绕法片段 eslint 必红；④到期不再判引用，真实撤销后 release 用例红；⑤owner自己调桥、没人用文件照常回收绿。红后按字节还原跑绿；函数级覆盖挤出撤销步和存盘失败回滚。新增扫描登记；目标走查登记到DISPOSABLE_TRASH_WALKS并由原守卫验证一次性映像卷，定向测试、gates:contracts、提交后 pre-push-contracts、eslint0警告。预测：上述组合再进版本面无法物理回收、素材库撤销不会裂图；复查日2026-11-25，量具同上，失败重开升档。回滚：协调revert本次提交。

## 系统改进
①本次：三扇素材库删除门统一在规划中区分活引用与可达撤销引用，后者延后回收；②最早本应在设计/门岗挡住：旧判据把「没有当前结果」等同「没有撤销期限」，eslint.config.mjs 又漏 deleteAssets 和间接能力入口；③扩现有共享规划与 eslint 规则，目标走查同时要求撤销可用和无撤销能腾空间。另一真实旧案 FB-20261029-browser-asset-reference-delete 由 assetDeletionMatrix 保持在用保护；owner真实源码lint通过作不误伤对照。

## 验证边界
没有改动带data-*标记的元素。挤出撤销步只做函数级；Windows、真供应商、真付费未验证，不属于本次素材删除条件。构建/起窗按共享锁串行；不跑全量gates/全量test/check:design-lab/check-prior-art。不推送、不合并。
