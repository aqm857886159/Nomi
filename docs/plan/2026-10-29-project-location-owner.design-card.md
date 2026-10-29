# 设计卡（草稿）：「项目在哪」收敛单（D-project-location）

> 第 1 段草稿，只填 ★ 五格（1、2、3、4、9，★1b 是 ★1 的子项）。方向检查与删除清单：`2026-10-29-project-location-owner.direction-check.md`。
> 用户拍板方向之前不动生产代码；拍板后第 2 段按本卡实现，四类不命中（不花钱、不长跑、不可打断；界面只改现有卡片文案与报错，新提示条走设计流程）。

```
改动名：项目在哪只有一个主人        线/负责人：D-project-location（第 2 段另派）        类别：[其他]（界面部分单列，见 ★4）
```

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我升级 Nomi、在资源管理器里给项目文件夹改名、把它挪到别的盘、或复制一份当副本之后，我想项目还在库里（文件夹找不到就明说「找不到」），用「选文件夹」重新打开那个文件夹它就回来，以便不丢项目、也不把修改写进别的文件夹。步骤：①打开 Nomi 看项目库；②找不到的卡显示「找不到这个文件夹」；③点「重新打开文件夹…」或在首页「选文件夹」选新位置；④项目打开，之后的保存写进我选的那个文件夹；⑤不想要了就「从项目库移除」，不会自己回来。**不做什么**：不自动找回挪走的文件夹（Windows / 非 MAS 包拿不到系统书签）；不改安装器（另一条线）；本段不加新界面。**已知坑**：同一个 id 的两个活文件夹（复制）要用户确认改用哪个；开着时被改名的项目本次会话显示「找不到」直到重开。**真实任务**：(1) Windows 0.24.0 用户，默认位置设在安装目录下 `F:\Nomi_new\xiangmu`，升级后打开（本次报告原样）；(2) 在资源管理器里把项目文件夹改名后用「选文件夹」打开（报告原样）；(3) 复制项目文件夹当副本、打开副本继续做。**指标**（目标 → 信号 → 指标）：不丢项目 → 升级 / 改名 / 搬家 / 复制后项目仍在库里 → 「场景 × 入口」矩阵里仍在库里的比例，基线 0/6（建根门）、目标 100%，量具 = `electron/projects/projectLocation.characterization.test.ts` 翻转后的矩阵；重新打开就回来 → 重开后能打开的比例，基线 0%（2b / 2d）、目标 100%，量具同上；护栏：读面写盘次数 = 0，量具 `check:read-path-writes`（加门后）+ 同一测试文件的「读调用前后目录快照一致」用例；Windows 真机：未验证：缺量具（本线在 macOS，盘符与大小写只用 `path.win32` 推导）；线上「找不到」卡片出现率：未验证：缺量具（没有遥测事件） | 特征测试文件；方向检查 §1 / §3 |
| ★1b 连带界面 | 项目库卡片：missing 文案从「文件夹暂不可用」改成「找不到这个文件夹」，悬停提示说清下一步（重新打开 / 移除）；「选文件夹」打开改名后的文件夹不再弹「项目文件夹不存在或磁盘未连接」；设置「新项目默认位置」新增报错「不能放在 Nomi 自己的目录里（安装目录 / 应用数据目录），升级会清掉它」，选文件夹同句；MCP 项目列表照常带 `missing`，不再出现被悄悄摘掉的项目；新提示条（项目在安装目录里）与卡片上的新按钮走 `docs/engineering/design-pipeline.md`，本卡不定样子。全部 zh / en 两轨 | `check:i18n`；文案测试 |
| ★2 谁说了算 | 概念 `project.location`（项目 id → 项目文件夹）唯一 owner：`electron/workspace/workspaceRegistry.ts#bindWorkspaceLocation`（写）+ `#locateWorkspaceProject`（读）；入口守卫 `electron/workspace/workspaceLocationPolicy.ts#assertUserOwnedLocation`。允许的写调用方：新建、选文件夹、保存 / 恢复（回写同一路径）、启动对账；摘登记只有「从项目库移除」。同一份事实现在存 3 份（登记 `rootPath`、清单 `lastKnownRootPath`、默认根目录结构），收敛后 1 份（登记），清单字段保存时照写、没有读者。现在靠「文件夹不见了」猜用户删了（`listProjects` 摘登记）→ 收敛后没有，删除意图只走用户的移除动作。碰的概念：`project.location`（新）、`project.directory-lifecycle`（改 notes：列表不摘登记） | `node scripts/door-map.mjs --write=rememberWorkspace,rememberWorkspaces,removeWorkspaceReference,backfillWorkspaceOrigins`（7 扇）；`--read=resolveWorkspaceProjectDir,projectDirById,readProject`（约 55 扇） |
| ★3 一致与复用 | 读函数以现有 `resolveWorkspaceProjectDir`（只信登记）为底，合并 `projectDirById`；核身份复用 `workspaceManifest.ts#readSettledWorkspaceIdentity`（无锁只读 id，媒体解析不再取清单锁）；启动对账复用 `legacyProjectMigration.ts#discoverLegacyProjects`（逐项隔离已在）；入口守卫与 `workspaceIpc.ts#assessWorkspaceFolderSafety` 的系统目录 denylist 合成一份「用户可放项目的位置」判定；7 份手写路径包含判断收成一个（先查现成包，没有再登记自写）；不新增第二份定义 | `pnpm run check:self-written`；`git grep -n "startsWith(\`\${"` |
| ★4 全状态 | 项目卡：正常 / 找不到（文件夹不在：说「找不到这个文件夹」，下一步「重新打开文件夹…」或「从项目库移除」）/ 读不出（现有灰卡）/ 正被别处占用（现有）/ 默认根整个不在（全部「找不到」，不雪崩，现有）。选文件夹：成功 / 取消（什么都不变，现有）/ 文件夹在应用目录里（拒绝，原因 + 下一步：换一个位置）/ 同一个 id 已绑着另一个还在的文件夹（先问改用哪个）/ 文件夹不是 Nomi 项目（现有初始化确认）。设置位置：成功 / 在应用目录里（拒绝）/ 不可写（现有）/ 检查时目录不在（只报，不建）。能力不可用：不适用——不依赖模型或外部资源。加载中 / 部分成功 / 过期：不适用——都是一次本地读写，没有中间态。文案走 i18n zh / en，不写费用断言 | `check:i18n`；真截图（第 2 段，zh / en 两轨） |
| ★9 验收与回滚 | **验收清单与反例（动手前写全）**：①6 扇建根门逐扇（新建项目、素材库逐个列素材、`projectDirById`、`readProject`、设置检查、设置打开）：升级删掉默认根后任何一扇碰过，重启 5 张卡仍在、标「找不到」，登记一条不少；②默认根内改名、外部文件夹改名、挪到别的盘、复制：重新打开后登记 = 所选目录、能打开；复制后原文件夹不被写；默认根里复制后只重启，登记不在原件与副本之间改绑（2g）；③开着时被改名：之后的保存不写根上旧格式 `project.json`，重开后内容不丢；④三套解析合一后，对同一项目任何读调用答案一致；读调用前后目录树快照一致（不建、不摘、不写）；⑤入口拒绝：设置位置、选文件夹、新建项目在安装根 / `resources` / `userData` / 系统临时目录里一律拒，Windows 大小写变体也拒（`path.win32` 用例）；⑥反例保留：外置盘暂时拔掉 → 「找不到」、插回即恢复；默认根整体不在 → 不雪崩；用户「从项目库移除」后不会被启动对账找回（现有 suppress 标记）；⑦门岗变异：往 `listProjects` 里加回 `removeWorkspaceReference` → `check:read-path-writes` 红；⑧⑫ 对账：选文件夹 X → 打开的就是 X，中英两段走查各一次；⑨真机 Windows 0.24.0 → 新版升级一次（协调跑，unverified 前不报完成）。**回滚**：revert 第 2 段提交即可，登记文件格式不变、无数据迁移；回滚后本单特征测试回到「现状」断言。**独立验收**：另一条线按本格逐条核，报告链接进 PR 正文 `## 独立验收` | 特征测试翻转；`pnpm run check:read-path-writes`；走查脚本（第 2 段定） |

### 功能分类
- [ ] 新界面 / 改交互（卡片文案与报错属逻辑修复；新提示条单独走设计流程，不在本 PR）
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [x] 数据格式（登记写入来源与读面行为；登记文件形状不变）
- [ ] 新增功能 / 性能
