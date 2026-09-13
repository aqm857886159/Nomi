# src/workbench capability boundary structure review

日期：2026-09-13

## 评审范围

本次评审聚焦 `src/workbench` 中渲染层对可选 Electron bridge 能力的读取边界，针对近期多份根因合同暴露的“能力缺失被当成业务错误”问题，逐一检查调用者、状态转换和错误呈现路径。

## 结论

`useAgentPanelSpendConfirm.refresh` 是 `productionRuns.pendingSpend` 的共享调用边界。它必须先判断 bridge 能力是否存在，再决定是否调用；能力不存在代表宿主裁剪或旧 bridge，不应产生用户业务错误；能力存在但调用拒绝才进入现有错误卡路径。画布性能 benchmark 的 18 个真实 Electron 场景复现了同一错误，证明问题跨场景而非单一页面偶发。

其他 workbench 读者不得各自复制 pending spend 判断。若新增可选 bridge，先在对应 capability adapter 建立同样的存在性分流，并以“缺失能力”和“已安装能力拒绝”两条真实路径测试。当前修复只改变共享 hook 的最早边界，不改变付费确认或错误可见性。

## 验收

- `src/workbench/ai/v4/useAgentPanelSpendConfirm.test.ts` 覆盖能力缺失与能力拒绝两态。
- 真实画布性能场景不再因缺失 `productionRuns` 产生 `missing-intervention-card`；已安装能力的真实拒绝仍可见。
