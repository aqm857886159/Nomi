# 画布非受控内核投影同步回归修复（2026-09-02）

状态：🚧 进行中；范围限定为 S4 画布拖动回归。

## 根因与边界

- 症状：React Flow mount 后，业务投影新增节点、结果缩略图和状态变化不会进入画布内部节点 store；空白项目添加图片节点时画布仍为空。
- 直接原因：`GenerationCanvasReactFlowViewport` 将 `nodes={flowNodes}` 改为 `defaultNodes={flowNodes}` 后，React Flow 只在 mount 播种一次，仓库没有投影到内部 store 的同步路径。
- 类根因：非受控 React Flow 内核与业务投影之间缺少单向同步不变量。
- 修复：保留非受控内核；在 React Flow 子树中以 `useReactFlow().setNodes` 按 id+引用同步新增、删除和 data/非位置变更。拖动期间跳过 position 字段，最终位置继续只由 drag stop 写回。

## 不动项

- 不恢复受控 `nodes`，不引入第二套 renderer，不改变 edges 受控路径。
- 不改变 `canvasDragDraft`、`canvasDragWriteback` 的 Zustand 隔离语义。
- 不改用户数据格式、供应商、模型或导出链路。

## 验收门

1. 新增 smoke 断言在坏代码上先红，修复后绿：添加图片前后 `.react-flow__node[data-id]` 计数增加 1。
2. `pnpm build` 后运行 `node tests/ux/smoke.e2e.mjs` 全绿。
3. canvas 域 Vitest、双合同结构测试、`check:root-cause-contracts` 全绿。
4. S 档三场景拖动锚点不超过既有 11.2ms / 1.07 的 15% 恶化阈值。
5. `pnpm run gates` 完整通过后 push 当前分支。

## 回滚

回滚本任务提交即可恢复当前 S4 非受控内核行为；不触碰已有 S3 未跟踪性能结果文件。
