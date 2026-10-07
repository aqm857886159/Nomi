# 设计卡：自动保存不再把项目名写回旧值（L-autosave）

改动名：内容保存不带项目名    线/负责人：L-autosave    类别：[数据格式]（纯修 bug，会丢用户数据；不花钱、不长跑、无界面改动）

| 格 | 内容 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 我打开一个项目干活，期间项目名被别的路径改了（项目库改名、Agent / MCP 改名、主进程别的写口），我接着改画布，名字应该保持新的，不能在下一次自动保存时被改回打开那一刻的旧名。不做：不改改名入口的交互、不加冲突提示。真实任务：打开项目 → 其它路径改名 → 改画布触发自动保存 → 读盘名字仍是新的。 | `src/workbench/project/projectPersistenceService.autosaveRename.test.ts`（main 上红 2 条） |
| ★2 谁说了算 | 概念：项目名。唯一 owner：`renameLocalProject`（项目库改名）与 `renameProjectAndPersist`（顶栏改名）。内容保存 `saveLocalProject` 不再有 name 参数；桌面端连 name 字段都不发，主进程 `saveWorkspaceProject` 在清单锁内取盘上现值。碰 1 个概念，已在 concept-owners.json 登记 `project.name`。 | `node scripts/door-map.mjs saveLocalProject`（3 个调用文件）、`renameLocalProject`（2 个）；`docs/engineering/concept-owners.json` |
| ★3 一致与复用 | 复用现有的改名函数与主进程合并（`...existing` 再换 name / payload），不新造机制；同 commit 删旧：`saveLocalProject` 的 name 参数、保存队列和订阅里的 `projectName` 整条链。 | `git grep -n projectName src/workbench/project/workbenchProjectSession.ts` 为空 |
| ★4 全状态 | 无新界面。改名失败仍走原 `studio.renameFailed` 提示；自动保存失败仍走 `projectSaveFailureText`。 | 不适用：无新文案 |
| ★9 验收与回滚 | 验收：渲染层真实路径测试（真仓库 + 真保存队列 + 真 service，只替换主进程磁盘）+ 主进程矩阵（7 个不归渲染层的字段逐个断言不被陈旧值覆盖）；变异（桌面端重新带上 name）必红。回滚：revert 本分支提交，无落盘数据变化。 | 测试命令见 PR 正文 |

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [x] 数据格式
