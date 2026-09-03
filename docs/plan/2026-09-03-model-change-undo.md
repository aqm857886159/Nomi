# 模型切换撤销修复

状态：✅ 已交付

## 范围

- 在 Generation Canvas 的共享 keydown 边界区分真实编辑器事件与残留焦点。
- 通过真实 `keydown` 派发测试证明：模型切换后的 Cmd/Ctrl+Z 到达 canvas store。
- 保留 textarea/contenteditable 自身的 Cmd/Ctrl+Z，不改模型切换或 store 历史实现。

## 不动项

- 不改模型目录、节点模型变更 patch、undo journal 或 timeline shortcut。
- 不提交、不推送、不启 PR；不跑 `pnpm run gates`。

## 验收与回滚

- 修复前目标回归用例红，修复后目标与文本编辑对照用例绿。
- `pnpm run gates:contracts && pnpm run test && pnpm run build` 全部完成；失败如实记录。
- 回滚只需撤销本计划涉及的快捷键 handler、测试和根因合同文件。
