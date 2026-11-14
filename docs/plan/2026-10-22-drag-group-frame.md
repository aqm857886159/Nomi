# 设计卡：拖组框跟手（P-dragframe）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

改动名：拖组框预览不再每帧做全局 DOM 查询　线/负责人：P-dragframe（nomi-worker）　类别：[其他]（性能；碰画布拖动，非花钱 / 长跑 / 新界面）
方向检查：`docs/engineering/direction-check-2026-10-22-drag-group-frame.md`（用户 10-22 放行，按「换」做）

### 功能分类
- [ ] 新界面 / 改交互
- [x] 大数据量 / 画布 / 长列表
- [x] 新增功能 / 性能

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我在 150 张卡的画布上抓住含 60 张卡的组框拖动，我想让框和卡一路跟手，以便摆版不卡手。步骤：建组 → 点空白 → 抓组框 → 拖 → 松手；松手后位置落盘、可撤销。不做：不改拖动手感、不改多选拖动（React Flow 内核那条）、不加 Esc 取消（现状 Esc 不影响手势）。已知坑：预览不动测量包装层（否则每帧重算连边）。真实任务：隔离资料目录的真 Electron 里拖一个组框，前后对比截图。指标：主指标 frameGapP95（预算 33ms）；护栏 longTasks；量具 perf 场景 `canvas-drag-group-frame` | `node scripts/perf-scenarios.mjs --id canvas-drag-group-frame --measure-only` |
| ★2 谁说了算 | 拖动期间位置的唯一 owner 仍是 store，settle 时一次写回；DOM translate 只是预览，不是第二份事实。概念：画布分组交互，1 个概念，写入口 1 扇（`GenerationCanvasReactFlow.tsx:298`） | `node scripts/door-map.mjs useCanvasSelectionDrag` |
| ★3 一致与复用 | 预览元素解析收成文件里唯一一个函数 `resolvePreviewElements`，删掉原来 4 份几乎相同的选择器 / 清理 / 应用函数；同时删掉生产代码里无调用方的选区框拖动入口（`handleSelectionBoundsPointerDown`），夹具改走组框真入口；不引入新库（自写理由：测量包装层不能动，React Flow 内核做不到） | `git grep querySelectorAll -- src/workbench/generationCanvas/components/useCanvasSelectionDrag.ts` |
| ★4 全状态 | 拖动中：帧内只写 translate；松手 / blur / pointercancel / lostpointercapture / 只读 / 卸载：settle 一次写回并清预览；拖动中成员被删或卸载：引用失效，跳过，不报错、不复活；复制拖动（Alt）：换框后下一帧重新解析；项目 / 图被替换：沿用原有 generation 失效判断，不写。无文案 | `tests/ux/selection-drag-lifecycle.test.mjs` |
| ★7 性能 | ①操作：拖组框；②最坏规模：150 节点、组内 60 张（场景 I150）；③预算：frameGapP95 ≤33ms，长任务只看；④场景 `canvas-drag-group-frame`，修前 / 修后数见 PR 正文 | `pnpm run check:perf-scenarios` |
| ★9 验收与回滚 | 验收：不属四类（性能改动），协调安静窗口复测；清单与反例：①组框拖动中不再调用 `document.querySelectorAll`（spy 计数）②拖中途成员被删③Esc 不改变结算④松手落点正确且可撤销⑤复制拖动 / 项目被替换沿用原矩阵。回滚：revert 本提交 | `tests/ux/selection-drag-lifecycle.test.mjs` |
