// 设置 → AI → 系统提示词（用户 2026-08-17 拍板样张 B，2026-08-18 扩出自定义提示词）。
// 起因：提示词过去只能在创作面板的技能 popover 里看，那是个 284px 宽 / 64px 高 / 截断 360 字的只读小框
// （ActiveSkillChip 旧实现，已按 P1 删除）。用户原话：「能看到但局限在一个非常小的框里」。
// 这里给它一个真正能读能改的家：模式 chip 选择 + 全文可编辑 textarea + 已自定义徽标 + 恢复默认。
//
// 两类条目、两套底部动作（这是本组件唯一的分叉，别再长出第三套）：
//   · 内置 7 个：有默认值 → 编辑 +「已自定义」徽标 +「恢复默认」；
//   · 用户自建：没有默认值 → 编辑 + 改名 +「删除」。「恢复默认」在这儿没有意义，不显示。
//
// 默认提示词的真相源仍是 creationAiModes.ts；本组件只写「覆盖层 + 自定义清单」
// （systemPromptOverrides.ts）。chip 清单一律 derive 自 listCreationAiModes()，不手写。
import React from 'react'
import { useTranslation } from 'react-i18next'

import { confirmDialog } from '../../design'
import { cn } from '../../utils/cn'
import {
  CUSTOM_PROMPT_MAX_COUNT,
  CUSTOM_PROMPT_NAME_MAX_LENGTH,
  type CustomSystemPrompt,
} from '../../../electron/settings/systemPromptsContract'
import {
  CREATION_AI_MODES,
  defaultCreationAiPrompt,
  listCreationAiModes,
  type CreationAiMode,
} from '../creation/creationAiModes'
import {
  hasPromptOverride,
  newCustomPromptId,
  pruneRedundantOverrides,
  readOverride,
  resolveEffectivePrompt,
  saveSystemPromptSnapshot,
  getSystemPromptSnapshot,
  withoutOverride,
  type SystemPromptOverrideMap,
} from '../creation/systemPromptOverrides'
import { useSystemPromptSnapshot } from '../creation/useSystemPromptOverrides'
import { useWorkbenchStore } from '../workbenchStore'
import {
  appendCustomPrompt,
  canAddCustomPrompt,
  clampCustomPromptName,
  removeCustomPrompt,
  selectionAfterDelete,
  updateCustomPrompt,
} from './customPromptEdits'
import { SystemPromptChipRow } from './SystemPromptChipRow'
import { SystemPromptCustomFooter, SystemPromptResetFooter } from './SystemPromptFooters'

// 打字时不要每敲一个字就打一次 IPC：停顿 400ms 才写盘。
const WRITE_DEBOUNCE_MS = 400

/**
 * 「这个模式的默认正文」一律问 defaultCreationAiPrompt()，不在这儿自己建表。
 *
 * 原来这里是个**模块级** Map（`CREATION_AI_MODES.map((m) => [m.id, m.prompt])`），在 import 那一刻
 * 就把中文源值定死了。于是 2026-09-02 加英文版提示词时，creationAiModes 那三个出口都按语言解析了，
 * 唯独这一处还在发中文——英文界面里编辑框照样显示整段中文，而所有单测都是绿的
 * （测的是 creationAiModes 的出口，测不到这张私建的表）。是 EN 真机走查照出来的。
 * 这就是 P1 说的并行读方：同一个「默认正文」有两个真相源，改了一个另一个不会跟。
 */
function defaultPromptOf(modeId: string): string | undefined {
  return defaultCreationAiPrompt(modeId)
}

const TEXTAREA_ID = 'settings-system-prompt-editor'
const NAME_INPUT_ID = 'settings-system-prompt-name'

export function SystemPromptSection(): JSX.Element {
  const { t } = useTranslation()
  const snapshot = useSystemPromptSnapshot()
  const creationAiModeId = useWorkbenchStore((state) => state.creationAiModeId)
  const setCreationAiModeId = useWorkbenchStore((state) => state.setCreationAiModeId)

  const [selectedId, setSelectedId] = React.useState<string>(CREATION_AI_MODES[0].id)
  // 正在编辑的那一份草稿：受控输入必须即时回显用户输入，不能等 debounce 写盘回来。
  const [draft, setDraft] = React.useState<string | null>(null)
  const writeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const nameInputRef = React.useRef<HTMLInputElement | null>(null)
  // 新建后要把焦点送进名字框——但要等这一轮 render 把输入框挂出来，所以记个「下一帧再聚焦」的标记。
  const focusNameRef = React.useRef(false)

  const modes = listCreationAiModes()
  const activeMode: CreationAiMode = modes.find((mode) => mode.id === selectedId) ?? modes[0]
  const isCustom = activeMode.custom === true

  const defaultPrompt = defaultPromptOf(activeMode.id)
  // 自定义条目没有默认值，正文就存在条目自己身上；内置的走「默认值 + 覆盖」合并。
  const storedPrompt = isCustom
    ? activeMode.prompt
    : resolveEffectivePrompt(defaultPrompt ?? '', readOverride(snapshot.overrides, activeMode.id))
  const value = draft ?? storedPrompt
  const customized = !isCustom && hasPromptOverride(snapshot.overrides, activeMode.id, defaultPrompt ?? '')
  const canCreate = canAddCustomPrompt(snapshot.custom)

  React.useEffect(
    () => () => {
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current)
    },
    [],
  )

  React.useEffect(() => {
    if (!focusNameRef.current) return
    focusNameRef.current = false
    nameInputRef.current?.focus()
    nameInputRef.current?.select()
  })

  /**
   * 唯一写盘口。内置覆盖写盘前必须过 pruneRedundantOverrides（把「改回默认值」的条目剔掉，
   * 否则默认值以后一改，老用户会被自己那份旧副本永久钉住）；自定义条目**不剪**——它们没有默认值。
   */
  const flushWrite = React.useCallback(
    (next: { overrides: SystemPromptOverrideMap; custom: CustomSystemPrompt[] }): void => {
      void saveSystemPromptSnapshot({
        overrides: pruneRedundantOverrides(next.overrides, defaultPromptOf),
        custom: next.custom,
      })
    },
    [],
  )

  /** 把正文草稿落进快照。内置的进 overrides，自定义的进它自己那条。 */
  const writePrompt = React.useCallback(
    (modeId: string, custom: boolean, text: string): void => {
      // 用最新快照做基底，避免 debounce 期间别处的改动被这次写入抹掉。
      const latest = getSystemPromptSnapshot()
      if (custom) {
        flushWrite({ overrides: latest.overrides, custom: updateCustomPrompt(latest.custom, modeId, { prompt: text }) })
        return
      }
      flushWrite({ overrides: { ...latest.overrides, [modeId]: text }, custom: latest.custom })
    },
    [flushWrite],
  )

  const onEditPrompt = React.useCallback(
    (nextText: string): void => {
      setDraft(nextText)
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current)
      const modeId = activeMode.id
      const custom = isCustom
      writeTimerRef.current = setTimeout(() => {
        writePrompt(modeId, custom, nextText)
        setDraft(null)
      }, WRITE_DEBOUNCE_MS)
    },
    [activeMode.id, isCustom, writePrompt],
  )

  /** 改名走同一条 debounce 之外的即时写入：名字短、改动少，没必要攒。 */
  const onEditName = React.useCallback(
    (nextName: string): void => {
      const latest = getSystemPromptSnapshot()
      flushWrite({
        overrides: latest.overrides,
        custom: updateCustomPrompt(latest.custom, activeMode.id, { name: clampCustomPromptName(nextName) }),
      })
    },
    [activeMode.id, flushWrite],
  )

  const onReset = React.useCallback((): void => {
    if (writeTimerRef.current) clearTimeout(writeTimerRef.current)
    setDraft(null)
    // 「恢复默认」= 删掉这一条覆盖，而不是把默认文本写回去（写回去会变成第二份副本）。
    const latest = getSystemPromptSnapshot()
    flushWrite({ overrides: withoutOverride(latest.overrides, activeMode.id), custom: latest.custom })
  }, [activeMode.id, flushWrite])

  const selectMode = React.useCallback(
    (modeId: string): void => {
      // 切模式前先把未落盘的编辑写掉，避免草稿丢失。
      if (writeTimerRef.current) {
        clearTimeout(writeTimerRef.current)
        writeTimerRef.current = null
        if (draft !== null) writePrompt(activeMode.id, isCustom, draft)
      }
      setDraft(null)
      setSelectedId(modeId)
    },
    [activeMode.id, draft, isCustom, writePrompt],
  )

  const onCreate = React.useCallback((): void => {
    const latest = getSystemPromptSnapshot()
    if (!canAddCustomPrompt(latest.custom)) return
    // 正文就是空的：用户先起名字、再慢慢写。净化器认「名字非空」为有效条目
    // （见 systemPromptsContract 的 normalizeCustomPrompts），空正文能安全落盘、重启还在。
    const entry: CustomSystemPrompt = {
      id: newCustomPromptId(),
      name: t('settings.ai.systemPrompt.defaultCustomName'),
      prompt: '',
    }
    flushWrite({ overrides: latest.overrides, custom: appendCustomPrompt(latest.custom, entry) })
    setDraft(null)
    setSelectedId(entry.id)
    focusNameRef.current = true
  }, [flushWrite, t])

  const onDelete = React.useCallback(async (): Promise<void> => {
    const target = activeMode
    const ok = await confirmDialog({
      title: t('settings.ai.systemPrompt.deleteTitle'),
      message: t('settings.ai.systemPrompt.deleteMessage', { name: target.label }),
      confirmLabel: t('settings.ai.systemPrompt.delete'),
      danger: true,
    })
    if (!ok) return
    if (writeTimerRef.current) {
      clearTimeout(writeTimerRef.current)
      writeTimerRef.current = null
    }
    setDraft(null)
    const latest = getSystemPromptSnapshot()
    flushWrite({ overrides: latest.overrides, custom: removeCustomPrompt(latest.custom, target.id) })
    // 两处选择都要回退，否则会留下指向死 id 的引用：
    //   · 本页的 chip 选中态（局部 state）；
    //   · 创作面板正在用的 creationAiModeId（全局 store）——删的要是它，chip 标签会认不出来。
    setSelectedId((current) => selectionAfterDelete(current, target.id))
    const nextGlobal = selectionAfterDelete(creationAiModeId, target.id)
    if (nextGlobal !== creationAiModeId) setCreationAiModeId(nextGlobal)
  }, [activeMode, creationAiModeId, flushWrite, setCreationAiModeId, t])

  return (
    <section
      data-settings-section="system-prompts"
      className="mt-6 border-t border-nomi-line pt-4"
      aria-labelledby="settings-system-prompt-title"
    >
      <h3 id="settings-system-prompt-title" className="mb-1 text-caption font-medium text-nomi-ink-60">
        {t('settings.ai.systemPrompt.title')}
      </h3>
      <div className="mb-3 text-caption leading-relaxed text-nomi-ink-40">{t('settings.ai.systemPrompt.hint')}</div>

      <SystemPromptChipRow
        modes={modes}
        selectedId={activeMode.id}
        onSelect={selectMode}
        onCreate={onCreate}
        canCreate={canCreate}
        createDisabledReason={t('settings.ai.systemPrompt.createDisabledReason', { max: CUSTOM_PROMPT_MAX_COUNT })}
      />

      {isCustom ? (
        <div className="mb-2">
          <label htmlFor={NAME_INPUT_ID} className="mb-1 block text-micro text-nomi-ink-60">
            {t('settings.ai.systemPrompt.nameLabel')}
          </label>
          <input
            id={NAME_INPUT_ID}
            ref={nameInputRef}
            data-settings-field="system-prompt-name"
            type="text"
            value={activeMode.label}
            maxLength={CUSTOM_PROMPT_NAME_MAX_LENGTH}
            placeholder={t('settings.ai.systemPrompt.namePlaceholder')}
            onChange={(event) => onEditName(event.currentTarget.value)}
            className={cn(
              'w-full rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5 py-1.5',
              'text-caption text-nomi-ink outline-none focus:border-nomi-accent',
            )}
          />
        </div>
      ) : null}

      <label htmlFor={TEXTAREA_ID} className="sr-only">
        {isCustom ? t('settings.ai.systemPrompt.customEditorLabel') : t('settings.ai.systemPrompt.editorLabel')}
      </label>
      <textarea
        id={TEXTAREA_ID}
        data-settings-field="system-prompt"
        value={value}
        spellCheck={false}
        placeholder={isCustom ? t('settings.ai.systemPrompt.customEditorPlaceholder') : undefined}
        onChange={(event) => onEditPrompt(event.currentTarget.value)}
        aria-label={isCustom ? t('settings.ai.systemPrompt.customEditorLabel') : t('settings.ai.systemPrompt.editorLabel')}
        className={cn(
          'h-44 w-full resize-y overflow-y-auto rounded-nomi-sm border border-nomi-line bg-nomi-paper p-3',
          'text-caption leading-relaxed text-nomi-ink outline-none focus:border-nomi-accent',
        )}
      />

      {isCustom ? (
        <SystemPromptCustomFooter onDelete={onDelete} />
      ) : (
        <SystemPromptResetFooter customized={customized} onReset={onReset} />
      )}
    </section>
  )
}
