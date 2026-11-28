# 画板会话生命周期设计卡

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

线：I-whiteboard-session-lifecycle（Mac，实现线）。类别：纯修复；用户已批准方向检查。

## ★1 用户怎么用

当我点开画板（画板卡片或图片浮条上的「画板」），我想让它一直开着让我画，直到我点完成或取消。

1. 选中画板卡片，再点打开；也可双击。图片浮条也能打开。
2. 直接画。
3. 平移或缩放画布，节点暂时移出视口再回来，仍开着、笔画仍在。
4. 完成落成结果图并关闭，或者取消关闭。

真实任务：在隔离的用户项目副本中从原画板卡片打开绘画；从原图片浮条打开绘画；真实素材走查使用本机素材目录。资料只用 user-copy 副本并重写路径。

不做：第一下只选中不变；工具、存档形状、卡片样式和文案不变；编辑器会话统一留到 0.25。

| 指标 | 基线 / 目标 | 量具 |
|---|---|---|
| StrictMode 两入口保持开启 | 0/2 → 2/2 | 新 StrictMode 真实组件挂载单测 |
| 完成、取消、删节点、换项目关闭 | 核现状 → 4/4 | 生命周期单测 |
| 生产虚拟化后开着且笔画在 | 未验证 → 通过 | 锁内生产 build，真实 Electron 中英截图 |
| 开发两入口保持开启 | 0/2 → 2/2 | 5283、隔离用户副本，复用诊断脚本与截图 |

## ★1b 连带界面

画板卡片「打开画板」、图片浮条「画板」、完成 / 取消、节点删除、项目切换。文案不变。

## ★2 谁说了算

会话开关唯一主人 `whiteboardSession.ts`。组件订阅 `useWhiteboardSession`，卸载不替用户作业务决定。显式关闭边界：完成、取消、节点删除、项目释放；已有复用，没有的补在 session store。动手前执行 `node scripts/door-map.mjs openWhiteboard` 和 `closeWhiteboard`，完整门表收进根因合同和交付报告，供协调写 PR。

## ★3 一致与复用

遵守 React 官方 https://react.dev/learn/synchronizing-with-effects 的 setup / cleanup 对称规则。先核自动保存是否足够；不足只加幂等落盘。不得检测 StrictMode 演练、增加延时 / 重试或关闭 StrictMode。

## ★4 全状态

| 状态 | 用户看到什么 |
|---|---|
| 打开中 | 画板显示 |
| 节点移出视口 | 节点不渲染，会话仍开着 |
| 回到视口 | 画板接着显示 |
| 完成 / 取消 | 关闭 |
| 删节点 / 换项目 | 关闭，无孤立会话、不往旧项目写 |
| 开发 effect 演练 | 用户看不出区别 |

### 功能分类
- [x] 大数据量 / 画布 / 长列表
- [ ] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 生成效果
- [ ] 数据格式
- [ ] 新增功能 / 性能

本次不新增界面或操作；不改样式与文案，拍板图不适用。Windows 与安装包未在此 Mac 线验证。

## ★9 验收与回滚

1. 先写方向检查末尾四条特征测试，锁住现状，再翻转期望并实现；保留 red / green 日志。
2. `<React.StrictMode>` 包真实组件，走画板卡片和图片浮条入口，打开后会话保持。恢复旧 cleanup 必红，作为结构门岗。
3. 完成、取消、删节点、换项目均关闭。
4. 锁内 `pnpm run build`；生产 Electron：开 → 画一笔 → 平移出视口 → 移回，开着、笔画在；中英截图自己看。
5. 开发模式复用诊断目录脚本做法，5283、user-copy 副本和隔离 profile，两入口持续打开，截图。
6. `NOMI_REAL_MEDIA_DIR=/Users/aoqimin/Desktop/视频/` 跑 `tests/ux/whiteboard-refactor.walk.mjs` 中英；抢前台守卫退出码与断言失败分别报告。
7. 普查 `src/workbench` 所有 effect cleanup 中关会话、写业务状态、发业务事件；同类同 PR 修，资源释放 / 幂等落盘不算。导演台另一线占用，只列不改；未改项写理由和 TODO 发协调。
8. `node scripts/fix-churn.mjs --range origin/main..HEAD --warn`；所有触及 src 的 fix 提交带 `Direction-Check: docs/plan/2026-10-29-whiteboard-session-lifecycle.direction-check.md`。
9. 相关测试、typecheck、lint；根因合同检查。报告附「反例 → 结果 → 证据」表。

反例：其他编辑器照抄 cleanup 关闭；虚拟化卸载；HMR；项目切换旧会话写入新项目；删除后孤立会话。

逃逸账本：核 `FB-20261022-whiteboard-board-unusable.json`，相同类则结账，否则新建 `FB-20261029-whiteboard-dev-self-close`；在独立验收之前提交翻转并挂 StrictMode 门岗。

回滚：revert 本任务修复。独立验收由协调另派，不以本实现线自验替代；本线只本地提交，不推送不开 PR。

## 实现线自验记录（2026-10-29）

实现提交 `35592e462`。生命周期实现仅改 `InlineWhiteboard.tsx` 和 `whiteboardSession.ts`。

| 清单 | 自验结果 |
|---|---|
| 先特征后翻转 | `4e23f68fb` 的 6 条特征测试全绿；翻转后 5 条按预期红，再实现 |
| StrictMode 真挂载两入口 | 2/2；真实 card / toolbar、编辑器 / drawing document / session 与 store；见 `whiteboardSessionLifecycle.test.tsx` |
| 完成、取消、删除、项目释放 | 4/4；另覆盖同 ID 项目替换、删除时异步 finish 迟到、未到 debounce 的最后一笔 |
| 生产中英 | 各通过打开→画→真卸载→返回→实绘笔画仍在→完成结果图；已看中英截图，除落盘外还核 canvas 蓝色像素 |
| 开发 5283 | 两入口 2/2 保持开启，绘画 / 虚拟化 / 返回 / 完成闭环通过；已看截图 |
| 现成画板走查 | 中英各 58/58；退出码均 0，无抢前台失败 |
| 最终相关测试 | 画板目录 + 项目释放，11 文件、116/116 |
| 静态检查 | typecheck 5 组通过；lint 0 错误、91 条存量警告（门槛 95） |
| 根因 / 热点门岗 | root-cause 检查 54/54；fix-churn 范围内热点 fix 均带有效 Direction-Check |
| 同类普查 | [cleanup 普查](2026-10-29-whiteboard-cleanup-census.md)，导演目录仅列不改 |
| 逃逸账本 | 新条目 `FB-20261029-whiteboard-dev-self-close`，candidate → reviewed，挂实现提交与 StrictMode 类级门岗；未有真实 PR 不写 fixed |

自验的反例矩阵：StrictMode 重放、真实卸载 / 重挂、真实节点删除、同 ID 项目替换、旧 finish 迟到均通过。实际 Vite HMR 热更新、Windows、打包安装、独立验收与 merge 收据为 `unverified`。没有跑全量 gates，不把相关测试当作全量门岗。报告与私有用户副本截图由协调状态目录保存，不进公开仓库。
