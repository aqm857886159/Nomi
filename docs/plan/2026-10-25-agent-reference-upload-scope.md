# Agent 参考图上传期间授权范围设计卡

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

改动名：Agent 参考图生成的上传范围校验与可见拒绝  线/负责人：fix/agent-reference-upload-scope  类别：[花钱][长跑][其他]

| 格 | 结论 | 证据 |
|---|---|---|
| ★0 先查别人 | `electron/productionRun/canvasLandingHost.ts:60-78` 先等 Nomi 自己的画布投影收敛、再封付费授权；这确认“自家投影写入不应作废确认”，但只适用于已知的自家落地链，本次仍需在上传边界做语义范围比较。`electron/capabilityCore/productionReferenceUrls.ts:24-55` 在上传前、上传后均复核素材身份；这确认参考身份必须是内容哈希+版本，而不是 URL。`src/workbench/ai/v4/spendCardFailure.ts:35-50` 与 `src/i18n/locales/agentPanelV4.ts:496-507,970-976` 已把宿主拒绝接到统一中英 toast；这确认不新增界面元素，直接增加结构化失败码映射即可。`docs/engineering/concept-owners/production.spend-approval-binding.json:20-34` 记录付费门不应再把整个活项目 revision 当作已批准范围；这确认范围应落在授权信封/本镜候选与参考身份，而不是全项目 revision。 | `cat`/`rg` 上述文件；本卡采用“共享范围快照 + 参考身份/本镜 Run 语义状态比较”，保留身份 fail-closed。 |
| ★1 用户怎么用 | 当 Agent 已起草带 `references:[assetId]` 的镜头、确认卡已显示时，用户点“生成这张”；Nomi 先走真实参考图上传，再继续授权和提交。上传期间 Nomi 自己落地节点、写缓存或推进投影时照常继续；用户改了本镜候选/参考身份、切换项目身份或另一方推进了本镜 Run 时，拒绝并在卡上显示“范围变了，重新确认”。不改变用户批准的镜头、模型、参数、价格语义。真实任务：素材库图片改图；上传慢时 Agent 同步落画布；用户在等待期间替换参考图。主指标：上传期间自家写入后的确认成功率（量具：新增延迟 loopback 集成测试）；护栏指标：用户改本镜/参考后 100% 拒绝且供应商 0 次（量具：同测试矩阵）；可见性指标：中英 toast 各出现一次语义文案（量具：`spendCardFailure.test.ts` 与中英走查截图）。 |
| ★1b 连带界面 | Agent 付费确认卡沿用现有错误 toast：上传期间范围发生用户可见变化时，中文说明“确认期间参考范围变了，这次没有开拍；请重新检查参考图后再确认”；英文对应同义句。卡保持原样，用户可重新确认；控制台仍保留 `spend-confirm-refused` 结构化日志。 | `src/workbench/ai/v4/useAgentPanelSpendConfirm.ts:312-329`、现有 `spendActionFailureCopy`。 |
| ★2 谁说了算 | `production.spend-approval-binding` 仍是付费授权范围 owner；新增 `generationReferenceScope` 共享判据只读项目身份、授权操作的计划候选/参考身份与本镜 Run 语义状态。允许 appIntegration 与 mcpStdioServer 两宿主调用同一个 guard；项目 revision 只作为授权信封内部审计字段，不再作为上传期间“自家写入”判据。状态只存一份快照，上传 URL 是临时传输值，不进入范围 owner。 | `node scripts/door-map.mjs prepareProductionGenerationAuthorizationWithReferences`；`docs/engineering/concept-owners/production.spend-approval-binding.json`。 |
| ★3 一致与复用 | 复用 `resolveProductionReferenceUrls` 的身份校验、`stableAuthorizationJson` 的确定性序列化、现有 `spendActionFailureCopy` 和 `SHOT_ACTION_FAILURE_COPY` 的 i18n 表。删除 appIntegration/mcpStdioServer 中两份 `assertCurrent`；新增共享 `generationReferenceScope.ts` 只保留一份判据。 | `git grep`：`generation_reference_scope_changed`、`stableAuthorizationJson`、`spendActionFailureCopy`。 |
| ★4 全状态 | 空：没有参考图时不进入上传范围分支，沿用原授权；加载：卡仍显示，上传过程不新增元素；成功：授权并提交原镜头；失败：`generation_not_started + approval_stale`，卡保留，toast 给“参考范围变了/重新确认”；部分成功：不在本次上传前授权路径产生，若账本已有提交意图仍沿用“结果未知”；取消中：沿用现有取消动作与账本；过期：沿用 `approval_expired`；能力不可用：沿用现有 provider/上传通道文案与下一步。 | `src/i18n/locales/generationCommon.ts:1658-1680,3370-3392`、`src/workbench/ai/v4/spendCardFailure.ts`。 |
| 5 中途表 | 上传中停手：卡保留，未创建提交意图；关窗：沿用桥断/结果未知判据；断网：上传失败且未提交时回 `generation_not_started`，卡保留；重启：持久化草稿/卡照旧恢复，重新点确认会重新抓范围；连点：现有 busy 闸阻止第二次动作。每格均复用现有账本事实，不改变扣费/退款语义。 | `appIntegrationSpendConfirm.ts:failed`、`useAgentPanelSpendConfirm.ts:act`、现有 spend 走查。 |
| ★7 性能 | 不新增用户操作；真实新增等待在参考上传已有链路内。最坏规模为单镜最多 4 张参考图、每张 200MB；本次 guard 为 O(参考数 + 本镜 Run 状态) 且不复制项目大文档，CPU 预算 <100ms，上传耗时由供应商决定。无新增性能场景，写 `不适用：纯 bug 修复，上传预算已有 asset-localization 场景`。 | `electron/catalog/assetLocalization.ts`、`docs/engineering/perf-scenarios.md`。 |
| 8 真实条件 | Windows / 真付费：unverified（协调合并前执行）；本工作树跑 Mac 隔离 loopback；中文/英文走查：本轮生成 spend-confirm 截图并亲眼读取；真实素材：使用仓库测试夹具，不碰用户资料。 | 本报告“中英截图”与门岗记录。 |
| ★9 验收与回滚 | 验收清单：① main 上真实延迟 loopback 上传先红，记录 project/Run revision 与写入调用栈；② 延迟上传期间 Nomi 自写项目缓存/节点投影后成功授权且供应商恰收 1 次；③ 用户改本镜候选或替换参考后拒绝、供应商 0 次、卡保留；④ appIntegration 与 mcpStdioServer 均走共享 guard；⑤ 临时立即 URL 映射被禁用或测试能识别绕过；⑥ 中英 toast 截图；⑦ 反例：恢复整项目 revision 比较第一条红；把夹具改回立即 URL 映射时测试必须失败/报绕过；⑧ `check:root-cause-contracts`、typecheck、ESLint、相关 vitest。回滚：revert 本提交；无开关。独立验收：验收线待派。 | `agentPanelSpendReferences.e2e.test.ts` 已证明真实 multipart 上传被 release 扣住时 Nomi 自写仍放行且旧整 revision 判据为红；同文件证明用户改候选后 `approval_stale`、供应商 0 次、卡保留。`agent-reference-upload-scope.walk.mjs` 在真实 Electron 中跑中文/英文素材库导入、确认卡、延迟上传和卡上改提示词，截图已逐张读取：中文 toast 说明“没有开始生成……点「取消」……再告诉 Nomi 要怎么改”，英文 toast 对应 “That did not go through… click Cancel and tell Nomi what to change”；两者下一步都明确为取消并重新说明/确认。报告：`/Users/aoqimin/Nomi-coord/Nomi-service/coord-handoff/reports/I-refscope-b.md`。 |

### 功能分类
- [x] 花钱
- [x] 长跑 / 可等待的外部上传
- [ ] 新界面（纯 bugfix，复用现有 toast）
- [ ] 新增功能 / 性能

拍板图清单：不适用：pure-bugfix / internal-no-visible-change；只接现有 toast，不新增界面元素。
