// Agent 工具失败码 → 用户读到的那句话（C5，2026-09-18）。
//
// 为什么要这张表：失败正文由主进程的 `renderLaneToolFailure` 拼成**英文散文**给模型读
// （「message + Next: …」），而 `laneViewModel` 过去只摘掉成功信封的尾行，失败正文原样进
// `.tsx`。中文界面上于是出现
// `The current target could not accept this action (surface_port_stale). Next: …`
// ——审计 §5 / B03 截图。老的翻译门 `humanizeToolFailure` 只能去**正则那段英文**，
// 认得出的只有 schema 校验一种，其余一律落回英文。
//
// 现在结构化信封（`details.failure`）一路带到渲染层，这里按 `code` 查词条。
// 码表真相源有两处：传输那一族是 `electron/shared/surfacePortBinding.ts` 的
// `SURFACE_PORT_WIRE_ERROR_CODE_LIST` + `CAPABILITY_TRANSPORT_VERIFICATION_ERROR_CODE_LIST`，
// lane 工具自有的是 `laneToolFailureEnvelope.ts` 的 `LANE_TOOL_OWN_FAILURE_CODE_LIST`；
// 少一条或多一条由 `check:error-surface` 规则④ 报红。
//
// 写法约束（R2 用户视角 + 极简）：每句只说**发生了什么** + **他现在该做什么**。
// 不出现 lane / port / capability / binding 这些我们内部的词——用户那里没有这些指称。
export const zhAgentToolFailure = {
  task_reference_required: '任务信息不完整。请刷新任务或画布后重试，尚未取消任何任务。',
  generation_operation_not_found: '当前项目中没有找到这个生成任务。请刷新任务信息，先核对原任务，勿重复提交。',
  production_run_not_found: '当前项目中没有找到这个任务。请刷新任务信息，勿重复提交。',
  generation_execution_failed: '生成操作未能完成，原任务可能已经提交。请先查询并核对结果，勿再次提交。',
  generation_not_started: '这一步没成，Nomi 没有开始生成。',
  generation_provider_unavailable: '当前生成服务无法执行这一步。请检查服务设置，并先核对已有任务。',
  // ── 传输：端口身份那一族 ──
  surface_port_stale: '刚才那一步针对的位置已经变了，没有执行。回到那个页面再让它做一次。',
  surface_port_suspended: '那个页面现在不接受改动，先把它打开再让它做。',
  surface_port_unavailable: '要改的那个页面没开着，打开它再让它做。',
  surface_owner_mismatch: '另一个窗口正拿着这个项目，关掉那个窗口再试。',
  project_binding_stale: '项目在这一步执行途中换了，什么都没改。回到项目里重新让它做。',
  project_identity_unavailable: '找不到项目文件夹，重新打开一次项目。',
  // ── 传输：这次调用本身 ──
  capability_execution_failed: '这一步没做成。看一眼当前状态，再让它重试。',
  capability_cancelled: '这一步被中断了，没有改动。',
  capability_input_invalid: '它给的参数不对，这一步没有执行。',
  capability_target_stale: '它针对的那个对象已经变了，这一步没有执行。',
  capability_unsupported: '这件事在当前页面做不了，它会换一种做法。要做的话，到对应的页面再说一次。',
  document_position_unavailable: '要用文稿里选中的那段或光标位置，得在创作页里说；不在创作页时，它只能读、改整篇。',
  capability_receipt_unresolved: '这一步不确定做成了没有。先看一眼改动在不在，再决定要不要让它重做。',
  capability_invocation_unverified: '这次调用没通过校验，什么都没改。',
  capability_authority_invalid: '这次调用没有权限，什么都没改。',
  capability_policy_stale: '权限设置在执行途中变了，这一步没有执行。',
  capability_output_invalid: '它返回的结果不合规，已经丢掉，没有落到项目里。',
  capability_timeout: '这一步等太久被停掉了，可能没做完。看一眼当前状态再决定要不要重来。',
  undo_conflict: '这项改动之后同一对象又被改过，不能安全撤销。',
  // ── lane 工具自有 ──
  tool_arguments_invalid: '它这次的参数不对，这一步没有执行。',
  tool_execution_failed: '这一步没做成。看一眼当前状态，再让它重试。',
  tool_timed_out: '这一步等太久被停掉了。看一眼当前状态再决定要不要重来。',
  wrong_verb: '它用错了方式，这一步没有执行——它会换一种再来。',
  generation_surface_unavailable: '生成面现在用不了，打开画布再让它生成。',
  // ── 兜底 ──
  unknown: '这一步没做成（{{code}}）。看一眼当前状态，再决定要不要让它重试。',
  // ── 结构化细节（不是散文，是把信封里的字段摆出来）──
  fieldExpected: '{{field}}：应该是 {{expected}}，它给的是 {{received}}',
  allowedValues: '可选值：{{values}}',
  useInstead: '应该用「{{verb}}」',
} as const

export const enAgentToolFailure = {
  task_reference_required: 'The task reference is incomplete. Refresh tasks or the canvas and try again. No task was cancelled.',
  generation_operation_not_found: 'This generation task was not found in the current project. Refresh task information and reconcile the original task before submitting it again.',
  production_run_not_found: 'This task was not found in the current project. Refresh task information before submitting again.',
  generation_execution_failed: 'The generation action could not complete. The original task may already be submitted. Query and reconcile it before submitting again.',
  generation_not_started: 'That did not go through. Nomi has not started generating.',
  generation_provider_unavailable: 'The generation service cannot perform this action. Check its settings and reconcile existing tasks first.',
  surface_port_stale: 'What that step targeted has changed, so nothing ran. Go back to that page and ask again.',
  surface_port_suspended: 'That page is not accepting changes right now. Open it, then ask again.',
  surface_port_unavailable: 'The page it needs to change is not open. Open it, then ask again.',
  surface_owner_mismatch: 'Another window is holding this project. Close that window and try again.',
  project_binding_stale: 'The project changed while this step was running, so nothing was changed. Reopen the project and ask again.',
  project_identity_unavailable: 'The project folder could not be found. Reopen the project.',
  capability_execution_failed: 'That step did not go through. Check the current state, then ask it to retry.',
  capability_cancelled: 'That step was interrupted. Nothing was changed.',
  capability_input_invalid: 'It passed the wrong arguments, so the step did not run.',
  capability_target_stale: 'What it targeted has changed, so the step did not run.',
  capability_unsupported: 'That cannot be done on the current page; it will try another way. To do it, ask again from the page it belongs to.',
  document_position_unavailable: 'Using the selected text or the cursor position in the script only works from the creation page; elsewhere it can only read or change the whole script.',
  capability_receipt_unresolved: 'Not sure whether that step went through. Check whether the change is there before asking it to redo it.',
  capability_invocation_unverified: 'That call failed verification. Nothing was changed.',
  capability_authority_invalid: 'That call was not authorized. Nothing was changed.',
  capability_policy_stale: 'Permissions changed while it was running, so the step did not run.',
  capability_output_invalid: 'What it returned was malformed and was discarded. Nothing reached the project.',
  capability_timeout: 'That step took too long and was stopped; it may be half-done. Check the current state before retrying.',
  undo_conflict: 'The same object changed after this action, so it was not safely undone.',
  tool_arguments_invalid: 'It passed the wrong arguments, so the step did not run.',
  tool_execution_failed: 'That step did not go through. Check the current state, then ask it to retry.',
  tool_timed_out: 'That step took too long and was stopped. Check the current state before retrying.',
  wrong_verb: 'It used the wrong action, so nothing ran — it will try a different one.',
  generation_surface_unavailable: 'Generation is unavailable right now. Open the canvas, then ask it to generate.',
  unknown: 'That step did not go through ({{code}}). Check the current state before deciding whether to retry.',
  fieldExpected: '{{field}}: expected {{expected}}, got {{received}}',
  allowedValues: 'Allowed: {{values}}',
  useInstead: 'Use “{{verb}}” instead',
} satisfies TranslationShape<typeof zhAgentToolFailure>

type TranslationShape<T> = {
  [K in keyof T]: T[K] extends string ? string : TranslationShape<T[K]>
}
