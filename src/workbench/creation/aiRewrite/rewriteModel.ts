import i18n from '../../../i18n'
import { getTextBrain } from '../../api/promptLibraryApi'
import { runWorkbenchTextTaskStream, textTaskFailureText } from '../../api/taskApi'
import { isProjectExecutionContextCurrent, withProjectAction } from '../../project/projectCanvasReadSurface'
import { useWorkbenchStore } from '../../workbenchStore'
import { buildRewritePrompt, cleanRewriteOutput } from './rewritePrompt'
import type { RewriteRequirement } from './rewriteSession'

type RewriteModelOutcome =
  | { ok: true; text: string }
  | { ok: false; aborted: true }
  | { ok: false; aborted: false; reason: string }

function failure(reason: string): RewriteModelOutcome {
  return { ok: false, aborted: false, reason }
}

/**
 * 改写走的就是「提示词优化 / 翻译」同一条文本管线：Agent 面板选的模型（getTextBrain）+ 同一个流式文本任务
 * （runWorkbenchTextTaskStream）+ 当前选用的提示词模式与 Skill。不另接一套模型调用。
 *
 * 不抛异常：取消 / 项目换了 = aborted（调用方什么都不写）；其余失败都带一句人话原因，调用方原文不动、把原因写给用户看。
 */
export async function runRewriteModel(input: {
  original: string
  requirement: RewriteRequirement
  signal: AbortSignal
}): Promise<RewriteModelOutcome> {
  // 项目身份在用户点下去的这一刻同步签发（任何 await 之前），结果回来时核它还在不在。
  const project = withProjectAction((issued) => issued)
  if (!project) return failure(i18n.t('creationAi.rewrite.noProject'))
  try {
    const brain = await getTextBrain({ strict: true })
    if (!brain) return failure(i18n.t('creationAi.rewrite.noTextModel'))
    const prompt = buildRewritePrompt({
      original: input.original,
      instruction: input.requirement.instruction,
      skill: input.requirement.skill,
      modeId: useWorkbenchStore.getState().creationAiModeId,
    })
    let streamed = ''
    await runWorkbenchTextTaskStream(
      brain.vendor,
      { kind: 'prompt_refine', prompt, extras: { modelKey: brain.modelKey } },
      project.binding.projectId,
      { signal: input.signal, onDelta: (delta) => { streamed += delta } },
    )
    if (input.signal.aborted || !isProjectExecutionContextCurrent(project)) return { ok: false, aborted: true }
    const text = cleanRewriteOutput(streamed, input.original)
    if (!text) return failure(i18n.t('creationAi.rewrite.emptyResult'))
    if (text === input.original) return failure(i18n.t('creationAi.rewrite.unchanged'))
    return { ok: true, text }
  } catch (error) {
    if (input.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return { ok: false, aborted: true }
    // 主进程的错误带结构化标记（给错误卡分类用的 base64），直接摆 e.message 用户看到的是一长串乱码：经唯一的展示函数剥掉。
    return failure(textTaskFailureText(error) || i18n.t('creationAi.rewrite.unknownReason'))
  }
}
