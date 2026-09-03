# 画布连线回归调查与修复

## 范围

- 定位 S5 走查中“从源把手拖到目标卡片正文后 edge 仍为 0”的分层断点。
- 保住 Zustand `connectNodes` / `connectToNode` 的领域语义，并修复 React Flow 手势落点解析（若分层证据确认 UI 为根因）。
- 增加一个快速回归护栏和 schema-v3 根因合同。

## 不动项

- 不改变 storyboard C1 的 `order` 语义，不改变参数引用槽位规则。
- 不动性能基准、Agent/3D 的程序化连线协议；这些入口只做同类入口扫描与回归验证。
- 不改变目标把手的视觉规格和 React Flow 单一交互内核。

## 调查假设与证据门

- 先直接调用 store `connectNodes(sourceId, targetId, ...)`，确认领域边是否从 0 增加。
- 若 store 通过，沿 React Flow `onConnect` / `onConnectEnd` 与自定义磁吸拖拽链定位断点。
- 用 `git log -S` / 区间 diff 确认 `a056b4ed..origin/main` 的引入 commit；不把 `2e476ee1` 的 `order` 参数当成结论，除非探针证明它过滤了新边。

## 交付与回滚

- 先让快速护栏在坏代码上失败，再实现并转绿；随后跑 canvas Vitest、S5 真实 Electron 走查和 gates。
- 远端只推送 `fix/canvas-connect-regression-20260903`，不在本轮开 PR 或合并。

## 验收门

1. store 层最小探针证明 `connectNodes` 新增 edge。
2. 快速护栏红 → 绿。
3. `node tests/ux/canvas-s5-walkthrough.walk.mjs` 13 条断言全绿。
4. `npx vitest run src/workbench/generationCanvas` 全绿。
5. `check:root-cause-contracts` 与 `pnpm run gates` 全绿。
