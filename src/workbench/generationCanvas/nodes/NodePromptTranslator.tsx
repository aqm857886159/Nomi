/**
 * 节点提示词的「翻译」按钮（2026-09-21 用户拍板）：B 簇里优化左边那颗。
 * 选中一段 → 只翻那段；没选中 → 翻整段。方向按中文/英文占比自动定，结果**原地替换**，
 * 一次编辑器事务写入，所以 Cmd+Z 一步回到原文——不弹预览确认窗（译文是可逆的，不值得多一次点击）。
 *
 * 复用优化器同一条文本管线（getTextBrain + runWorkbenchTextTaskStream + prompt_refine），
 * 不新建通道、不新增 TaskKind（P1）。纯逻辑（方向/引用保护/指令）在 promptTranslate.ts。
 */
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconLanguage } from '@tabler/icons-react'
import type { Editor } from '@tiptap/react'
import { NodePromptToolIconButton } from './NodePromptToolCluster'
import { getTextBrain } from '../../api/promptLibraryApi'
import { runWorkbenchTextTaskStream } from '../../api/taskApi'
import { isProjectExecutionContextCurrent, withProjectAction } from '../../project/projectCanvasReadSurface'
import type { PromptReference } from '../../assets/promptMentions'
import { promptTextBetween, replacePromptRange, translateRange } from './promptTranslateDoc'
import {
  buildTranslatePrompt,
  cleanTranslationOutput,
  detectTranslateDirection,
  protectMentions,
  restoreMentions,
  splitOuterWhitespace,
} from './promptTranslate'

export function NodePromptTranslator({
  editor,
  prompt,
  mentionReferences,
  onFeedback,
}: {
  editor: Editor | null
  prompt: string
  mentionReferences: readonly PromptReference[]
  onFeedback: (message: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [running, setRunning] = React.useState(false)
  const abortRef = React.useRef<AbortController | null>(null)
  const empty = !prompt.trim()

  // 一颗按钮一个动作：运行中再点 = 取消；否则开始翻译。
  const onClick = React.useCallback(async () => {
    if (abortRef.current) {
      abortRef.current.abort()
      return
    }
    if (!editor || editor.isDestroyed) return
    const range = translateRange(editor.state)
    const source = promptTextBetween(editor.state.doc, range.from, range.to)
    const { lead, core, trail } = splitOuterWhitespace(source)
    const direction = detectTranslateDirection(core)
    if (!direction) {
      onFeedback(t('generationCommon.translator.nothingToTranslate'))
      return
    }
    // 翻译属于节点所在项目：点击那一刻签发，换项目后不再写回。
    const project = withProjectAction((issued) => issued)
    if (!project) return
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setRunning(true)
    try {
      const brain = await getTextBrain({ strict: true })
      if (!brain) {
        onFeedback(t('generationCommon.optimizer.configureTextModel'))
        return
      }
      const guarded = protectMentions(core)
      let acc = ''
      await runWorkbenchTextTaskStream(
        brain.vendor,
        { kind: 'prompt_refine', prompt: buildTranslatePrompt(guarded.text, direction, guarded.mentions.length), extras: { modelKey: brain.modelKey } },
        project.binding.projectId,
        { signal: ctrl.signal, onDelta: (delta) => { acc += delta } },
      )
      if (!isProjectExecutionContextCurrent(project) || editor.isDestroyed) return
      const output = cleanTranslationOutput(acc)
      if (!output) {
        onFeedback(t('generationCommon.translator.emptyResult'))
        return
      }
      const restored = restoreMentions(output, guarded.mentions)
      if (!restored.ok) {
        onFeedback(t('generationCommon.translator.placeholderMismatch'))
        return
      }
      // 等模型那几秒里用户可能改过提示词：原范围的内容对不上就不替换，免得覆盖他刚写的字。
      const { doc } = editor.state
      if (range.to > doc.content.size || promptTextBetween(doc, range.from, range.to) !== source) {
        onFeedback(t('generationCommon.translator.promptChanged'))
        return
      }
      editor.view.dispatch(replacePromptRange(editor.state, range, `${lead}${restored.prompt}${trail}`, mentionReferences).scrollIntoView())
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      onFeedback(e instanceof Error && e.message
        ? t('generationCommon.translator.failedWithReason', { reason: e.message })
        : t('generationCommon.translator.failed'))
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }, [editor, mentionReferences, onFeedback, t])

  return (
    <NodePromptToolIconButton
      toolId="translate"
      icon={<IconLanguage size={16} stroke={2} />}
      label={running ? t('generationCommon.translator.running') : t('generationCommon.translator.aria')}
      active={running}
      disabled={empty && !running}
      disabledReason={t('generationCommon.translator.emptyReason')}
      onClick={() => void onClick()}
    />
  )
}
