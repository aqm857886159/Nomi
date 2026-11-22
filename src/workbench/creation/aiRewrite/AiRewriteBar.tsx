import React, { type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { Editor } from '@tiptap/react'
import { IconArrowUp, IconBooks, IconChevronDown, IconRefresh } from '@tabler/icons-react'
import { WorkbenchIconButton } from '../../../design/actions'
import { NomiLoadingMark, NomiLogoMark } from '../../../design/identity'
import { cn } from '../../../utils/cn'
import { listWorkbenchSkills, type SkillListItemDto } from '../../api/skillApi'
import { onSkillLibraryChanged } from '../../skillLibrary/skillLibraryChanged'
import { skillDisplayTitle } from '../../skillLibrary/skillDisplay'
import type { AiRewrite } from './aiRewriteBinding'
import {
  REWRITE_PRESET_INSTRUCTIONS,
  REWRITE_TONE_INSTRUCTIONS,
  REWRITE_TRANSLATE_INSTRUCTIONS,
  isWritingSkill,
  toRewriteSkillRef,
} from './rewritePrompt'
import { REWRITE_SLOT_ATTRIBUTE, getRewriteSession, shouldAutoFocusRewriteInput, type RewriteRequirement } from './rewriteSession'

/** 条的落脚处：文档里跟在这一段后面的那个块级空位（插件的装饰画出来的，每次事务后可能换一份 DOM，所以跟着事务重找）。 */
function useRewriteSlot(editor: Editor | null, sessionId: number | null): HTMLElement | null {
  const [slot, setSlot] = React.useState<HTMLElement | null>(null)
  React.useLayoutEffect(() => {
    if (!editor || sessionId === null) {
      setSlot(null)
      return undefined
    }
    const find = (): void => {
      if (editor.isDestroyed) return
      setSlot(editor.view.dom.querySelector<HTMLElement>(`[${REWRITE_SLOT_ATTRIBUTE}="${sessionId}"]`))
    }
    find()
    editor.on('transaction', find)
    return () => {
      editor.off('transaction', find)
    }
  }, [editor, sessionId])
  return slot
}

/** 创作写作区里可用的写作类 Skill（用户自己的、只要文本模型的单段 Skill）。 */
function useWritingSkills(enabled: boolean): SkillListItemDto[] {
  const [skills, setSkills] = React.useState<SkillListItemDto[]>([])
  React.useEffect(() => {
    if (!enabled) return undefined
    let alive = true
    const load = (): void => {
      listWorkbenchSkills()
        .then((all) => { if (alive) setSkills(all.filter(isWritingSkill)) })
        .catch(() => { if (alive) setSkills([]) })
    }
    load()
    const off = onSkillLibraryChanged(load)
    return () => {
      alive = false
      off()
    }
  }, [enabled])
  return skills
}

const CHIP_CLASS = cn(
  'inline-flex h-7 items-center gap-1 rounded-workbench-control border-0 bg-transparent px-2.5',
  'cursor-pointer whitespace-nowrap text-caption text-workbench-ink',
  'hover:bg-workbench-hover',
)

type OpenGroup = 'tone' | 'translate' | null

export function AiRewriteBar({ editor, rewrite }: { editor: Editor | null; rewrite: AiRewrite }): JSX.Element | null {
  const { t, i18n } = useTranslation()
  const { controller, session } = rewrite
  const barRef = React.useRef<HTMLDivElement | null>(null)
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [draft, setDraft] = React.useState('')
  const [openGroup, setOpenGroup] = React.useState<OpenGroup>(null)
  const skills = useWritingSkills(session !== null)
  const sessionId = session?.id ?? null
  const status = session?.status ?? null
  const slot = useRewriteSlot(editor, sessionId)

  // 新会话：输入框清空（保留上一次要求只在同一个会话里）。
  React.useEffect(() => {
    setDraft('')
    setOpenGroup(null)
  }, [sessionId])

  // 会话里记着要求（第一次提交之后）：输入框显示它，方便改了再追加、或原样重来。
  const committedText = session?.requirement?.text ?? ''
  React.useEffect(() => {
    if (committedText) setDraft(committedText)
  }, [committedText])

  // 打开菜单，或焦点仍在条内 / 待改区间内时状态变化（出结果 / 失败）把焦点放回输入框；若用户已去别处打字则绝不抢焦点。
  const placed = slot !== null
  React.useEffect(() => {
    if (!editor || editor.isDestroyed || sessionId === null || status === null || !placed) return
    const live = getRewriteSession(editor.state)
    if (!live) return
    const active = document.activeElement
    if (
      shouldAutoFocusRewriteInput({
        state: editor.state,
        session: live,
        editorFocused: Boolean(active && editor.view.dom.contains(active)),
        barContainsFocus: Boolean(active && barRef.current?.contains(active)),
        bodyOrNullFocused: active === null || active === document.body,
      })
    ) {
      inputRef.current?.focus({ preventScroll: true })
    }
  }, [editor, sessionId, status, placed])

  if (!editor || !controller || !session || !slot) return null

  const running = session.status === 'running'

  const submit = (requirement: RewriteRequirement): void => {
    setOpenGroup(null)
    setDraft(requirement.text)
    controller.submit(requirement)
  }
  const submitDraft = (): void => {
    const text = draft.trim()
    if (!text) return
    // 没改过输入框里的字 = 原要求（连同它挂着的 Skill）；改过 = 一条新要求，仍从同一段原文改。
    if (session.requirement && text === session.requirement.text.trim()) controller.retry()
    else submit({ text, instruction: text, skill: null })
  }
  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      controller.discard()
      return
    }
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    event.stopPropagation()
    if (running) return
    const unchanged = session.requirement !== null && draft.trim() === session.requirement.text.trim()
    if (session.status === 'result' && unchanged) controller.accept()
    else submitDraft()
  }

  const preset = (id: keyof typeof REWRITE_PRESET_INSTRUCTIONS): RewriteRequirement => ({
    text: t(`creationAi.rewrite.preset.${id}`),
    instruction: REWRITE_PRESET_INSTRUCTIONS[id],
    skill: null,
  })

  return createPortal(
    <div
      ref={barRef}
      className={cn(
        'workbench-ai-rewrite-bar',
        'relative flex w-full flex-col gap-1.5 p-1.5 text-left font-sans',
        'rounded-nomi-lg border border-workbench-border bg-workbench-overlay',
        'shadow-workbench-pop backdrop-blur-[18px]',
      )}
      role="group"
      aria-label={t('creationAi.rewrite.barAria')}
      data-rewrite-status={session.status}
    >
      <div className="flex h-8 items-center gap-2 rounded-workbench-control bg-workbench-hover pl-2.5 pr-1.5">
        <NomiLogoMark size={16} />
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={t('creationAi.rewrite.inputPlaceholder')}
          aria-label={t('creationAi.rewrite.inputAria')}
          className="min-w-0 flex-1 border-0 bg-transparent text-body-sm text-workbench-ink outline-none placeholder:text-workbench-muted"
        />
        {running ? (
          <NomiLoadingMark size={16} label={t('creationAi.rewrite.working')} />
        ) : session.status === 'menu' ? (
          <WorkbenchIconButton
            size="sm"
            className="!size-7"
            label={t('creationAi.rewrite.send')}
            disabled={!draft.trim()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={submitDraft}
            icon={<IconArrowUp size={16} />}
          />
        ) : (
          <WorkbenchIconButton
            size="sm"
            className="!size-7"
            label={t('creationAi.rewrite.retry')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => controller.retry()}
            icon={<IconRefresh size={14} />}
          />
        )}
      </div>
      {session.status === 'failed' && session.failure ? (
        <p role="alert" className="m-0 px-2.5 text-caption text-workbench-danger-ink">
          {t('creationAi.rewrite.failed', { reason: session.failure })}
        </p>
      ) : null}
      {session.status === 'menu' ? (
        <>
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('creationAi.rewrite.presetsAria')}>
            {(['rewrite', 'shorter', 'longer'] as const).map((id) => (
              <button key={id} type="button" className={CHIP_CLASS} onMouseDown={(event) => event.preventDefault()} onClick={() => submit(preset(id))}>
                {t(`creationAi.rewrite.preset.${id}`)}
              </button>
            ))}
            <button
              type="button"
              className={CHIP_CLASS}
              aria-expanded={openGroup === 'tone'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setOpenGroup(openGroup === 'tone' ? null : 'tone')}
            >
              {t('creationAi.rewrite.preset.tone')}
              <IconChevronDown size={14} />
            </button>
            <button
              type="button"
              className={CHIP_CLASS}
              aria-expanded={openGroup === 'translate'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setOpenGroup(openGroup === 'translate' ? null : 'translate')}
            >
              {t('creationAi.rewrite.preset.translate')}
              <IconChevronDown size={14} />
            </button>
            {skills.length > 0 ? <span className="mx-0.5 h-4 w-px bg-workbench-border" aria-hidden="true" /> : null}
            {skills.map((skill) => {
              const title = skillDisplayTitle(skill, i18n.language)
              return (
                <button
                  key={skill.directoryName}
                  type="button"
                  className={cn(CHIP_CLASS, 'text-workbench-accent')}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => submit({ text: title, instruction: `按「${title}」的写作方法来改。`, skill: toRewriteSkillRef(skill, title) })}
                >
                  <IconBooks size={14} />
                  {title}
                </button>
              )
            })}
          </div>
          {openGroup === 'tone' ? (
            <div className="flex flex-wrap items-center gap-1 border-t border-workbench-border-soft pt-1.5">
              {(Object.keys(REWRITE_TONE_INSTRUCTIONS) as Array<keyof typeof REWRITE_TONE_INSTRUCTIONS>).map((id) => (
                <button
                  key={id}
                  type="button"
                  className={CHIP_CLASS}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => submit({ text: t(`creationAi.rewrite.tone.${id}`), instruction: REWRITE_TONE_INSTRUCTIONS[id], skill: null })}
                >
                  {t(`creationAi.rewrite.tone.${id}`)}
                </button>
              ))}
            </div>
          ) : null}
          {openGroup === 'translate' ? (
            <div className="flex flex-wrap items-center gap-1 border-t border-workbench-border-soft pt-1.5">
              {(Object.keys(REWRITE_TRANSLATE_INSTRUCTIONS) as Array<keyof typeof REWRITE_TRANSLATE_INSTRUCTIONS>).map((id) => (
                <button
                  key={id}
                  type="button"
                  className={CHIP_CLASS}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => submit({
                    text: `${t('creationAi.rewrite.preset.translate')} · ${t(`creationAi.rewrite.language.${id}`)}`,
                    instruction: REWRITE_TRANSLATE_INSTRUCTIONS[id],
                    skill: null,
                  })}
                >
                  {t(`creationAi.rewrite.language.${id}`)}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>,
    slot,
  )
}
