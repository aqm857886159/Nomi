# 体验成绩单：批量生成恢复

产品源码 `6f7d2bb30`。Mac、1280×860、中英亮色、隔离假服务商；没有真实付费或真人评分。

完整免费四段passed：静置302160ms、15 POST/12张转发。修前同脚本2 POST后断言红，静置302187ms后仍未派发镜头；按字节还原并构建0。

| 分项 | 结果 | 原始收据 |
| --- | --- | --- |
| en-a4LockExitJourney.json | 过 | [JSON](receipts/en-a4LockExitJourney.json) |
| en-agentMountedLockExitJourney.json | 过 | [JSON](receipts/en-agentMountedLockExitJourney.json) |
| en-agentUnmountedLockExitJourney.json | 过 | [JSON](receipts/en-agentUnmountedLockExitJourney.json) |
| en-editedCanvasLockExitJourney.json | 过 | [JSON](receipts/en-editedCanvasLockExitJourney.json) |
| en-editedListLockExitJourney.json | 过 | [JSON](receipts/en-editedListLockExitJourney.json) |
| en-editedStoryboardLockExitJourney.json | 过 | [JSON](receipts/en-editedStoryboardLockExitJourney.json) |
| en-httpEightLockExitJourney.json | 过 | [JSON](receipts/en-httpEightLockExitJourney.json) |
| en-listEntryLockExitJourney.json | 过 | [JSON](receipts/en-listEntryLockExitJourney.json) |
| en-matrixLockExitJourney.json | 过 | [JSON](receipts/en-matrixLockExitJourney.json) |
| en-queueActionsLockExitJourney.json | 过 | [JSON](receipts/en-queueActionsLockExitJourney.json) |
| en-singleActionsLockExitJourney.json | 整体未通过；分项另列 | [JSON](receipts/en-singleActionsLockExitJourney.json) |
| en-spendChangeLockExitJourney.json | 过 | [JSON](receipts/en-spendChangeLockExitJourney.json) |
| en-threePageLockExitJourney.json | 过 | [JSON](receipts/en-threePageLockExitJourney.json) |
| zh-CN-a4LockExitJourney.json | 过 | [JSON](receipts/zh-CN-a4LockExitJourney.json) |
| zh-CN-agentMountedLockExitJourney.json | 过 | [JSON](receipts/zh-CN-agentMountedLockExitJourney.json) |
| zh-CN-agentUnmountedLockExitJourney.json | 过 | [JSON](receipts/zh-CN-agentUnmountedLockExitJourney.json) |
| zh-CN-editedCanvasLockExitJourney.json | 过 | [JSON](receipts/zh-CN-editedCanvasLockExitJourney.json) |
| zh-CN-editedListLockExitJourney.json | 过 | [JSON](receipts/zh-CN-editedListLockExitJourney.json) |
| zh-CN-editedStoryboardLockExitJourney.json | 过 | [JSON](receipts/zh-CN-editedStoryboardLockExitJourney.json) |
| zh-CN-httpEightLockExitJourney.json | 过 | [JSON](receipts/zh-CN-httpEightLockExitJourney.json) |
| zh-CN-listEntryLockExitJourney.json | 过 | [JSON](receipts/zh-CN-listEntryLockExitJourney.json) |
| zh-CN-matrixLockExitJourney.json | 过 | [JSON](receipts/zh-CN-matrixLockExitJourney.json) |
| zh-CN-queueActionsLockExitJourney.json | 过 | [JSON](receipts/zh-CN-queueActionsLockExitJourney.json) |
| zh-CN-singleActionsLockExitJourney.json | 整体未通过；分项另列 | [JSON](receipts/zh-CN-singleActionsLockExitJourney.json) |
| zh-CN-spendChangeLockExitJourney.json | 过 | [JSON](receipts/zh-CN-spendChangeLockExitJourney.json) |
| zh-CN-threePageLockExitJourney.json | 过 | [JSON](receipts/zh-CN-threePageLockExitJourney.json) |

single-actions-3中英整体失败，但E3三页普通重试、E9同状态的checks均true，按分项记通过；E1实际拖框三次停点，不以Meta+A分组替代。

A11中英：资产期间真下拉切2K，第二卡取消不增POST且保留资产；新批量确认后请求确为2k。任务中心去掉普通死重试，人工核对后的专用放行仍+1 POST。

[修前日志](rehearsal-before.log) · [修后日志](rehearsal-after.log) · [完整免费收据](receipts/zh-CN-rehearsal.json) · [付费前置收据校验](paid-receipt-validation.json)

真实付费、Windows、真人SEQ、独立验收和整窗冻结复现均未验证；画布现有节点模型覆盖不回写方案，是main既有窗口，本轮只报告。

## 第2轮

原独立验收不通过，修复后待复验。B6中英三入口各5 POST、目标1次，结果不被顶掉；B7原金路径0→1图片请求并经冷启动。新完整免费四段绑定提交，旧源码/无提交收据不具备付费资格。详细原始数字见 [round2](round2.json)。

第二轮最终自验：核心57项与相关487项通过，构建、类型、概念归属、根因合同及推送前快检均退出0；最终免费四段绑定b985edee6，静置301909ms、最长响应282ms，仍不代表独立复验或真实付费通过。
