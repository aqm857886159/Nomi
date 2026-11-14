# 项目可编辑草稿存盘合同

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

改动名：草稿存盘与保存失败原因；负责人：实现线；类别：[其他] 纯 bug 修复，无新增界面、付费或关窗流程。

## ★1 用户怎么用与量具

当创作者先搭人物卡、再补细节时，我想随时保存并重开继续，以便未完成内容不丢。操作：新建隔离工程 → 加人物卡 → 保持空名或清空名字 → 画幅先 16:9 再默认 → 等自动保存 → 关闭/强制结束 → 重开核对。另一个任务：保存写入被占用时看到真实原因和诊断入口。任务素材均为隔离资料目录中的本地草稿，不触及真实资料，不生成付费资源。

主指标：编辑序列可存比例由三种复现 0/3 到 3/3，量具 `projectSaveDraftContract.test.ts`、`editorPersistability.property.test.ts`。质量指标：JSON 往返方案一致率 100%，同一属性门经真 store + normalizePayload + normalizeRecord。护栏：模型/Agent 的空名和空整片画幅拒绝率 100%，用特征测试及原有 loopback；批量生成空名红框继续由 validatePlan 验证。原因回传五类命中率 100%，量具 `projectsIpc.test.ts` 与 `projectErrorSurface.test.ts`；真窗量具 `tests/ux/project-save-draft-contract.walk.mjs`（zh/en、重启、故障注入、截图）。只有真窗完成才记录 UI 已验证。

★1b 连带界面：顶部保存红字、关闭失败 toast、项目库操作错误均走现有 UserText 出口；unknown 说“没能保存，改动还在当前窗口里”，指明设置 → 通用 → 导出诊断包。中英两轨。关窗继续保留失败留窗行为。

## ★2 谁说了算

分镜形状唯一 owner `electron/shared/storyboard/storyboardPlanSchema.ts`；草稿只约束可往返结构，严格面从草稿 extend 内容非空。项目 `normalizePayload` 是存读迁移合同，主进程项目仓库是磁盘真相，保存错误闭合原因在 shared/contracts 定义，IPC 只由现有 unwrapIpcResult 拆封。无第二份方案或错误原文存储。门表来自 `node scripts/door-map.mjs normalizePayload`、`saveProjectRecord`、`storyboardPlanSchema`、`planAnchorSchema`、`parseStoryboardPlan`、`saveProject`；完整输出在根因合同和交付报告。

## ★3 一致与复用

复用现有 zod extend、fast-check、真实 Zustand store、canvasEventReplay 属性门、IpcResult、unwrapIpcResult。删除项目严格面的 import 和保存裸 invoke 的旧读法；现有锁忙、删除状态变化、回收站三个特例合成同一张原因表，不加第四条特例。批量条画幅选项抽成纯函数，UI 和门共读。不加依赖。规划模型/Agent 作者入参仍严格，Agent 整卡编辑另线。

## ★4 全状态

空/编辑中：可存的草稿；保存中：沿用原状态；成功：沿用保存回执；失败：按闭合原因文案、内存改动仍在；未知失败：导出诊断包；部分成功：不引入（项目原子保存）；取消中：不改变现有取消/关窗；过期绑定：提示重新打开；能力不可用：存盘不依赖模型或账号，无新不可用态。

## ★9 验收清单、反例及结构预防（动手前合同）

下文逐项保留方向复盘 §8 的刀 1 和刀 2 合同；刀 2 版本按拍板更新为 0.24.1。

### 刀 1（0.24.1）

**先写的特征测试，钉住现状**
- 修前红（复现）：
  - 用真函数产出方案：`createEmptyStoryboardPlan` 后接 `addAnchor`；`updateAnchor(…, { name: '' })`；`setPlanDefaultAspect(…, '')`。
  - 经真 store 的 `setStoryboardPlan` 写入，再走 `readCurrentWorkbenchProjectPayload()` → `normalizePayload`。
  - 今天三条都抛 `corruptPayload`。
- 修前修后都要绿（不许变）：
  - 规划模型输出和 Agent 入参里，空名人物卡、空整片画幅仍被拒（`parseStoryboardPlan`）。
  - `validatePlan` 对视觉人物卡空名仍报 `anchor-no-name`。
  - `projectNormalize.test.ts` 里的未知键剥离和旧键迁移。
  - `storyboardPlanSingleOwner.loopback.test.ts` 的三条不变量。

**★9 验收清单（动手前写全）**
1. 新增人物卡、不填名字：自动保存成功，没有红字。关掉整个 App 再打开，空名卡还在，行上的红框也还在。中英文各验一遍，截图亲眼看过。
2. 清空已有人物卡的名字：结果同第 1 条。
3. 整片画幅先选 16:9、再选「默认」：保存成功；重开后显示「默认」。
4. 处于 1–3 任一状态时，等 2 秒后强制结束：重开后编辑都在。这是把现场「强制结束丢编辑」翻过来。
5. 往返：存盘内容经 `JSON.stringify` / `JSON.parse` 后再走读盘（`normalizeRecord`），得到同一份方案。用来抓「存得进、读不回」，比如 `Infinity` 落盘后变成 `null`。
6. 规划模型或 Agent 给出空名人物卡时，仍被拒，报错能指到字段。
7. 空名视觉人物卡仍会拦住批量生成（`validatePlan` 不变）。
8. 注入一个 schema 不认识的形状让保存失败：日志里有字段路径，红字不再提磁盘权限。

**反例（必须红）**
- 把 `projectRecordSchema.ts` 改回引用严格面，或把草稿面的 `anchors[].name` 改回 `min(1)`：属性测试和静态守卫都必须红。
- 在编辑函数层新增一个会把内容字段写成 `''` 的动作，却没登记进门：覆盖棘轮必须红。
- 去掉往返断言：用 `durationSec: Infinity` 的变异样本跑，必须红，以证明往返确实在测。

**结构性预防**
- **结构上做不出来**：
  - 严格面 = 草稿面 `.extend()`，规则只能往严格面上加。
  - `src/workbench/project/**` 不许 import 严格面。用 ESLint `no-restricted-imports` 实现，或并进现有的 check 脚本。
- **门岗自动拦**：用 fast-check 写属性测试。
  - 随机编辑序列从编辑函数表里取：`storyboardPlanEdits.ts` 导出的全部方案变换、`storyboardShotScope.ts` 的画幅设置、批量参数作用域、store 的方案增删改名。
  - 自由文本取任意字符串，包括 `''`。
  - 下拉取界面上的真实选项：把批量条的画幅选项从 `StoryboardBulkBar.tsx:97-100` 抽成纯函数，测试和界面读同一份。
  - 每个序列经真 store 落到 `readCurrentWorkbenchProjectPayload()`，断言两件事：存盘口通过（`normalizePayload` 和 `assertWorkbenchProjectMediaUrlsPersistable`）；JSON 往返后读回同一份。
  - 加覆盖棘轮：编辑模块新增导出的方案变换没进表，测试就红。
  - 画布那一半不另起炉灶：在现有 `canvasEventReplay.property.test.ts` 的每个随机序列之后，加一句「存盘口通过」断言。
- **局限，明说**：
  - 组件里直接拼对象再调 `setStoryboardPlan` 的写法，门看不到，例如 `StoryboardShotTable.tsx:597,634`。
  - 这些写法受 TS 类型约束，而草稿面只保留类型能表达的约束，所以类型对就存得下。
  - 剩下唯一的缝是数值有限性，由往返断言兜住。

**回滚**
- 读盘的放宽不能回退。回退后，存过空名卡的工程会打不开。
- 如果要撤，只撤写口：在 `saveProjectRecord` 前加回一行严格检查，读口保持宽。也就是前滚，不整刀 revert。

### 刀 2–4 简表

**刀 2：保存失败的原因**
- 特征测试：
  - 先跑绿现有断言：锁忙能认出来，其余失败一律同一句。
  - 新增：在主进程注入 EBUSY、EPERM、ENOSPC、锁忙、身份过期，各走一遍真 handler，记下现状。
- ★9 要点：
  - 五类注入各得到不同的人话。
  - 日志有 reason、errno、syscall、channel，没有路径和原文。
  - 锁忙仍说「项目正被别处占用」。
  - Windows 上的 EPERM 只说「写入被拒（可能是权限、占用或安全软件）」，不归成某一个确切原因。
- 反例：
  - handler 改回抛错 → 包络测试红。
  - 新增一个 reason 却没配文案 → 类型检查红。


## 特征测试清单（动结构前先锁住）

**已有、要保持绿的**（本线只读，没运行）
- `src/workbench/project/projectNormalize.test.ts`：未知键剥离、旧键迁移、迁移失败告警。
- `src/workbench/creation/storyboard/storyboardPlanSingleOwner.loopback.test.ts`：手工编辑入口那一扇门。
- `src/workbench/generationCanvas/agent/storyboardPlanEdits.test.ts`。
- `src/workbench/library/projectErrorSurface.test.ts:62-80`、`src/workbench/project/useProjectWindowLifecycle.test.ts:51-58`：错靶子。刀 2、刀 3 在同一提交里改写，刀 1 不动它们。

**要先写的**（建议的文件名）
- `src/workbench/project/projectSaveDraftContract.test.ts`：三条修前红的复现，加往返断言。
- `src/workbench/project/editorPersistability.property.test.ts`：fast-check 门和覆盖棘轮。

**登记**
- 逃逸账本：建议条目 `USER-20261029-project-save-draft-veto`，铁律 ⑫，结账挂上面这个属性测试（matrix 类检查）。
- 根因合同的 doors：door-map 数出 `normalizePayload` 有 2 个入口、3 处调用：读两处（`projectNormalize.ts:194,212`），写一处（`projectRepository.ts:270`）。三处都改走草稿面，不合并入口，理由是读和写本该同一契约。

## 补充反例与兼容

删除 EBUSY/EPERM/ENOSPC 任一映射，原因测试必须红。恢复 handler 抛错包络测试必须红。变异后按字节还原并核 SHA256。降级说明原文：0.24.1 存过空名卡的工程，0.24.0 打不开。回滚只能撤写口（在 saveProjectRecord 前加回严格检查），读盘的放宽不回退。

## 实施前已知边界

单卡生成空名是否拦截属后续取舍，本线仅核 validatePlan 的批量生成行红框，不改单卡出站逻辑。真实窗口若显示单卡仍放行，将如实记录，不扩大修复范围。

## 静态与登记补齐

项目目录严格面 import 守卫之外，同一 ESLint 配置也禁止在草稿 name/aspectRatio 上直接加入内容限制；把草稿名字改回 min(1) 时，属性门和静态门均已实跑为红，并按字节还原。可编辑字段的编译期键守卫钉在草稿面，避免可选字段只加在严格面而落盘时被剥离。保存阶段词表与草稿/IPC 概念 owner 一并登记。
