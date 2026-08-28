// 「运行测试」：把这条工作流**真提交给这台 ComfyUI**（后端零改动，走既有 tasks.run 通道）。
// plan: docs/plan/2026-08-12-model-settings-home-and-comfyui-workflow-page.md
//
// 为什么是真跑而不是假的「连通检查」：本地 ComfyUI 不花钱，真跑一次是唯一能回答
// 「我这条绑定到底对不对」的东西。连通检查只能证明机器活着，证不了绑定对——
// 那正是用户配错时最需要知道的（D4：别拿一个看起来像验证的东西糊弄过去）。
//
// 请求形状与生成画布同源（src/workbench/generationCanvas/runner/catalogTaskActions.ts）：
//   vendor = 这台 ComfyUI 的 vendorKey；extras.modelKey 指到这条工作流；
//   可调字段按 paramKey 直接进 extras —— 主进程 taskTemplateParams 把 extras 摊成
//   {{request.params.X}} 的取值表（electron/catalog/taskParams.ts）。
//
// 媒体输入（首帧/尾帧/源视频）**不带**：那要先把素材上传成 ComfyUI 的文件名，是画布的活。
// 试跑只验「图能不能跑通 + 参数有没有接对」；界面上已明说这一点，不假装带了。
import { mintSpendGrant, runComfyCandidateTestByVendor, type ComfyCandidateTestResultDto, type TaskKind } from '../../../workbench/api/taskApi'
import { workflowMediaBindings, type WorkflowBinding } from '../comfyuiWorkflowBinding'

export type TestRunResult = ComfyCandidateTestResultDto

/**
 * taskKind 必须与**导入时登记 mapping 的那一个逐字一致**
 * （electron/catalog/comfyuiWorkflowImport.ts buildImportedWorkflow，搜 hasFrameInput）：
 * 产物类型 × 有没有帧输入。
 *
 * ⚠️ 别在这里「简化」成只看产物类型。走查实锤过：一条绑了首帧的视频工作流登记在 image_to_video 下，
 * 若这里发 text_to_video，就**选不到它的 mapping**，请求落到通用视频通道 → POST /v1/videos/generations
 * → 404。那份文件的注释早写明了这个失配的后果，这里照抄它的判据，不另立一套。
 *
 * 视频输入不进判据（同上游）：ProfileKind 没有 video_to_video，源视频走「参考视频」通道。
 */
function taskKindOf(binding: WorkflowBinding): TaskKind {
  const hasFrameInput = workflowMediaBindings(binding).some((image) => image.mediaKind === 'image')
  if (binding.outputKind === 'model3d') return hasFrameInput ? 'image_to_3d' : 'text_to_3d'
  if (binding.outputKind === 'video') return hasFrameInput ? 'image_to_video' : 'text_to_video'
  return hasFrameInput ? 'image_edit' : 'text_to_image'
}

export async function runTestGeneration(input: {
  vendorKey: string
  candidateVendorKey: string
  revisionId: string
  modelKey: string
  binding: WorkflowBinding
  prompt: string
  extras: Record<string, string | number | boolean>
}): Promise<TestRunResult> {
  // nodeId 是主进程用来对账/可中断的句柄。这次试跑不属于画布上任何节点，
  // 给一个带前缀的独立 id，别去撞画布节点的 id 空间。
  const nodeId = `comfy-workflow-test-${input.revisionId}`
  try {
    // 付费守卫（electron/spendGrant.ts）硬拦所有未授权的 vendor 出口，试跑也不例外——
    // 走查实锤：不铸令牌就是 SpendNotAuthorizedError。**这颗令牌在「运行测试」按钮的 onClick
    // 事件链里铸**，正是守卫要求的信任边界（「铸令牌只挂在真人确认按钮 onClick」），
    // 且属它注释里点名的那一类非节点付费（onboarding / 测连接 / mapping 调试）。
    // maxAttemptsPerNode: 1 —— 试跑是一次性的，不给自动重试预算：失败要让用户看见失败、
    // 回去改绑定，而不是背着他重试三次。
    const grantId = await mintSpendGrant([nodeId], 1)
    return await runComfyCandidateTestByVendor(input.candidateVendorKey, {
      request: {
        kind: taskKindOf(input.binding),
        prompt: input.prompt,
        extras: {
          ...input.extras,
          modelKey: input.modelKey,
          modelAlias: input.modelKey,
          nodeId,
          grantId,
          certifyOutput: true,
          comfyCertificationRevisionId: input.revisionId,
        },
      },
    })
  } catch {
    return { ok: false, revisionId: input.revisionId, reasonCode: 'provider_failed', params: {} }
  }
}
