# 方向检查：项目名与内容保存（L-autosave）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

### 0. 一句话根因
项目名有两个主人：改名入口，和每一个带 name 参数的内容保存口；内容保存没有「只写自己拥有的字段」的边界。

### 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 本次：自动保存把改名写回旧名 | 订阅里存了打开那一刻的 projectName，一路传到主进程记录 | 内容写口带旧快照字段 |
| 近 14 天 projectPersistenceService / NomiStudioApp 的 fix（保存锁回执、持久化解绑等） | 保存生命周期时序（谁等谁的回执） | 另一类：保存时序，不是本次的类；本次不碰时序 |

### 2. 为什么这一类会一直出现
保存接口是「三部分窄接口」（id、内容、名字），名字被当成内容的随身参数；任何新增内容写口都会照抄传名字。落到铁律 ⑫「点了=以为的」：用户改名 = 以为名字变了，下一次自动保存悄悄改回。结账挂矩阵测试 `electron/workspace/workspaceRepository.contentSaveOwnership.test.ts`。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 新增的内容写口会再传一个名字 | `rg "saveLocalProject\(.*name"`；现在类型层面已无法传 |
| 主进程别的写口也带旧字段 | `electron/workspace/workspaceRepository.contentSaveOwnership.test.ts` 逐字段断言 |

### 4. 靶子独立性检查
测试是本线新写，渲染层用真仓库 + 真保存队列，仅替换主进程磁盘；主进程矩阵直接跑真 saveWorkspaceProject。变异（桌面端重新带 name）必红已验证。

### 5. P0
项目名归属是我们领域的元数据所有权，不是通用能力；复用现有改名函数与主进程合并，没有新自写。

### 6. 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 无对应现成库 | - | - | 否 |
| 补 | 调用方各自查最新名字再传 | 每个调用者一份 | 仍有读写之间的窗口 | 否 |
| 重写（限一个模块） | 保存接口重做 | 大 | 大 | 否 |
| 删 | 删掉内容保存的 name 参数与 projectName 链 | 小 | 低 | 是 |

### 7. 用户要权衡的核心
没有要拍板的权衡：只是把名字从内容保存里拿掉，改名行为不变。

## 特征测试清单
`src/workbench/project/projectPersistenceService.autosaveRename.test.ts`、`electron/workspace/workspaceRepository.contentSaveOwnership.test.ts`、既有 `workbenchProjectSession.*.test.ts`（26 条通过）。
