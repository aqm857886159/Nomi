# 体验成绩单：批量生成恢复

验收源码：`b74242b4775b16af7383268fabc7a1986ea3d60e`。机器为 Mac、1280×860、中英亮色、隔离假服务商；没有真实付费或真人评分。

完整四段演练未通过，不能把分项通过写成整轮完成。旧口径把单卡不弹普通确认卡判为失败，已由更新合同撤销；当前按既定单卡政策验收。失败尝试的本地原始日志保留，当前有效结果如下。

| 分项 | 结果 | 原始收据 |
| --- | --- | --- |
| en-a4LockExitJourney.json | 过 | [JSON](receipts/en-a4LockExitJourney.json) |
| zh-CN-a4LockExitJourney.json | 过 | [JSON](receipts/zh-CN-a4LockExitJourney.json) |
| en-agentMountedLockExitJourney.json | 过 | [JSON](receipts/en-agentMountedLockExitJourney.json) |
| en-agentUnmountedLockExitJourney.json | 过 | [JSON](receipts/en-agentUnmountedLockExitJourney.json) |
| zh-CN-agentMountedLockExitJourney.json | 过 | [JSON](receipts/zh-CN-agentMountedLockExitJourney.json) |
| zh-CN-agentUnmountedLockExitJourney.json | 过 | [JSON](receipts/zh-CN-agentUnmountedLockExitJourney.json) |
| en-editedCanvasLockExitJourney.json | 过 | [JSON](receipts/en-editedCanvasLockExitJourney.json) |
| en-editedListLockExitJourney.json | 未通过 | [JSON](receipts/en-editedListLockExitJourney.json) |
| en-editedStoryboardLockExitJourney.json | 过 | [JSON](receipts/en-editedStoryboardLockExitJourney.json) |
| zh-CN-editedCanvasLockExitJourney.json | 过 | [JSON](receipts/zh-CN-editedCanvasLockExitJourney.json) |
| zh-CN-editedListLockExitJourney.json | 未通过 | [JSON](receipts/zh-CN-editedListLockExitJourney.json) |
| zh-CN-editedStoryboardLockExitJourney.json | 过 | [JSON](receipts/zh-CN-editedStoryboardLockExitJourney.json) |
| en-httpEightLockExitJourney.json | 过 | [JSON](receipts/en-httpEightLockExitJourney.json) |
| zh-CN-httpEightLockExitJourney.json | 过 | [JSON](receipts/zh-CN-httpEightLockExitJourney.json) |
| en-matrixLockExitJourney.json | 过 | [JSON](receipts/en-matrixLockExitJourney.json) |
| zh-CN-matrixLockExitJourney.json | 过 | [JSON](receipts/zh-CN-matrixLockExitJourney.json) |
| en-listEntryLockExitJourney.json | 过 | [JSON](receipts/en-listEntryLockExitJourney.json) |
| en-threePageLockExitJourney.json | 过 | [JSON](receipts/en-threePageLockExitJourney.json) |
| zh-CN-listEntryLockExitJourney.json | 过 | [JSON](receipts/zh-CN-listEntryLockExitJourney.json) |
| zh-CN-threePageLockExitJourney.json | 过 | [JSON](receipts/zh-CN-threePageLockExitJourney.json) |
| en-singleActionsLockExitJourney.json | 未通过 | [JSON](receipts/en-singleActionsLockExitJourney.json) |
| zh-CN-singleActionsLockExitJourney.json | 未通过 | [JSON](receipts/zh-CN-singleActionsLockExitJourney.json) |

修前按最终同一脚本运行，预期红；修改过的生产文件均按字节还原。修后完整免费演练第三次分镜阶段与五分钟静置完成，随后被错误的按钮断言中断；已修脚本，没有第四次运行。

真人 SEQ、误点、回退、求助、首次成功均未采集。Windows、真实模型、付费与独立验收未验证。

价格风险：资产期间用户改成更贵模型，第二阶段读最新方案而原确认明细未更新；按裁决单独停止。

完整分项、HTTP 计数、反例 SHA、性能与截图限制见 [verification.json](verification.json)。
