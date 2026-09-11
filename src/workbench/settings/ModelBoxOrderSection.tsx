// 「模型框里显示哪些、排在哪」设置区（设置 → AI 策略，紧贴「默认走哪家」那张表下面）。
//
// 解决的摩擦（2026-09-11 用户原话）：模型框里天天撞见的是三件事——列表里有一堆我从来不用的、
// 我常用的那个排在很后面、切走再切回它又跳回别家。三件事以前没有任何一个地方能回答，
// 各自散在不同代码路径里，有的根本没做。
//
// 为什么家在「AI 策略」而不是「模型」（设计系统 §1.7.2 的分界线）：填 key、连地址是**接入**（家在「模型」）；
// 「已经接好的这些，哪些进模型框、谁排前面」是**策略**。它和上面那张「同一个模型多家都有，默认走哪家」
// 回答的是同一句「怎么用」，必须同住一屏，否则用户要在两个 tab 里找「排序」这一件事（§1.5.2 一功能一个家）。
//
// 为什么隐藏用眼睛而不是勾选框：「模型」tab 里每个模型已经有一个勾选框，那是**启停**
// （能不能用，所有生成路径都认）。这里是**看不看得见**（纯展示层，不动已经用它生成过的旧节点）。
// 两层语义不同，共用同一种控件形状会让用户以为自己关掉了那个模型（Open WebUI 把 Hide 和 Enabled
// 分成两层，正是同一条经验）。眼睛/闭眼是公认图形，不是自造 icon。
import React from 'react'
import { IconChevronDown, IconChevronUp, IconEye, IconEyeOff } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import { IconActionButton, NomiSegmented } from '../../design'
import type { NodeKind } from '../../config/models'
import { useModelOptionsState } from '../../config/useModelOptions'
import { dedupeModelOptions } from '../../config/modelIdentity'
import { modelProviderLabel } from '../common/useDedupedModelSelect'
import { useVendorPreferenceOrder } from '../common/useVendorPreference'
import { saveModelBoxOrder, setModelHidden, useModelBoxPreference } from '../common/useModelBoxPreference'
import { buildModelBoxRows, mergeModelOrderForKind, moveModelRow, type ModelBoxRow } from './modelBoxOrder'

/**
 * 分段开关的三档 = 三个真实的模型框（图片节点 / 视频节点 / 音频节点各读自己那一类）。
 * 文案键**写死不拼**：拼出来的键静态查不出来，词条哪天被删掉，屏幕上就直接显示那串 key。
 */
const KINDS: readonly { value: NodeKind; labelKey: string }[] = [
  { value: 'image', labelKey: 'settings.ai.modelBox.kind.image' },
  { value: 'video', labelKey: 'settings.ai.modelBox.kind.video' },
  { value: 'audio', labelKey: 'settings.ai.modelBox.kind.audio' },
]

/** `muted` = 已隐藏那一组：它现在不进模型框，标出「默认走哪家」只会误导（样张里这组的标签是灰的）。 */
function RowChips({ chips, muted = false }: { chips: ModelBoxRow['chips']; muted?: boolean }): JSX.Element | null {
  if (chips.length === 0) return null
  return (
    <span className="flex shrink-0 items-center gap-1">
      {chips.map((chip) => (
        <span
          key={chip.vendorKey}
          data-model-box-chip={chip.vendorKey}
          data-model-box-chip-active={chip.active && !muted ? 'true' : undefined}
          className={chip.active && !muted
            ? 'max-w-[76px] truncate rounded-pill border border-nomi-accent bg-nomi-accent-soft px-1.5 py-[1px] text-micro leading-none text-nomi-accent'
            : 'max-w-[76px] truncate rounded-pill border border-nomi-line px-1.5 py-[1px] text-micro leading-none text-nomi-ink-40'}
        >
          {chip.label}
        </span>
      ))}
    </span>
  )
}

export function ModelBoxOrderSection(): JSX.Element | null {
  const { t } = useTranslation()
  const [kind, setKind] = React.useState<NodeKind>('image')
  const { options } = useModelOptionsState(kind)
  const orderedVendorKeys = useVendorPreferenceOrder()
  const preference = useModelBoxPreference()
  const [saveError, setSaveError] = React.useState(false)

  const deduped = React.useMemo(() => dedupeModelOptions([...options]), [options])
  const rows = React.useMemo(
    () => buildModelBoxRows(deduped, preference, orderedVendorKeys, modelProviderLabel),
    [deduped, preference, orderedVendorKeys],
  )

  // 顺序写在主进程（版本化原子 JSON）。写失败必须**说出来**：这个控件唯一的反馈就是行序变了，
  // 失败时行序不动 = 和「点了没反应」在屏幕上完全一样（与「默认走哪家」同一套处理，不另发明）。
  const move = React.useCallback(async (index: number, delta: -1 | 1) => {
    const visibleIds = rows.visible.map((row) => row.canonicalId)
    const kindIds = new Set([...visibleIds, ...rows.hidden.map((row) => row.canonicalId)])
    try {
      await saveModelBoxOrder(mergeModelOrderForKind(preference.modelOrder, moveModelRow(visibleIds, index, delta), kindIds))
      setSaveError(false)
    } catch {
      setSaveError(true)
    }
  }, [preference.modelOrder, rows])

  const toggleHidden = React.useCallback(async (canonicalId: string, hidden: boolean) => {
    try {
      await setModelHidden(canonicalId, hidden)
      setSaveError(false)
    } catch {
      setSaveError(true)
    }
  }, [])

  // 这一类一个模型都没有（还没接入任何能跑这类活的供应商）时整块不出现：
  // 一个空的排序列表既排不了东西，又会让人以为「这里能加模型」（加的家在「模型」tab）。
  if (rows.visible.length === 0 && rows.hidden.length === 0) return null

  return (
    <section
      data-settings-section="model-box-order"
      data-model-box-order
      className="mb-6"
      aria-labelledby="settings-model-box-order-title"
    >
      <div className="mb-1 flex items-center gap-3">
        <h3 id="settings-model-box-order-title" className="min-w-0 flex-1 text-caption font-medium text-nomi-ink-60">
          {t('settings.ai.modelBox.title')}
        </h3>
        <NomiSegmented
          ariaLabel={t('settings.ai.modelBox.kindSwitch')}
          fit="content"
          density="compact"
          value={kind}
          options={KINDS.map((kind) => ({ value: kind.value, label: t(kind.labelKey) }))}
          onChange={(value) => setKind(value as NodeKind)}
        />
      </div>
      <div className="mb-3 text-micro leading-relaxed text-nomi-ink-40">
        {t('settings.ai.modelBox.hint')}
      </div>
      {saveError ? (
        <div role="alert" data-model-box-error className="mb-3 text-micro leading-relaxed text-workbench-danger">
          {t('settings.ai.modelBox.saveFailed')}
        </div>
      ) : null}
      <ol className="grid gap-2">
        {rows.visible.map((row, index) => (
          <li
            key={row.canonicalId}
            data-model-box-row={row.canonicalId}
            className="flex min-h-8 min-w-0 items-center gap-3"
          >
            <span
              aria-label={t('settings.ai.modelBox.rank', { rank: index + 1 })}
              className="grid size-5 shrink-0 place-items-center rounded-full bg-nomi-accent-soft text-micro font-semibold text-nomi-accent"
            >
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-caption text-nomi-ink-80">{row.label}</span>
            <RowChips chips={row.chips} />
            {/* `disabled:bg-transparent`：首尾两端**必然**有一个箭头是禁用的，Mantine subtle 档给
                disabled 铺的灰底反倒比能点的更抢眼（设计系统 §1.6 C1）。与「默认走哪家」同一处理。 */}
            <span className="flex shrink-0 gap-1">
              <IconActionButton
                aria-label={t('settings.ai.modelBox.moveUp')}
                title={t('settings.ai.modelBox.moveUp')}
                disabled={index === 0}
                onClick={() => { void move(index, -1) }}
                className="size-7 text-nomi-ink-40 hover:text-nomi-accent disabled:bg-transparent"
                icon={<IconChevronUp size={15} stroke={1.7} aria-hidden="true" />}
              />
              <IconActionButton
                aria-label={t('settings.ai.modelBox.moveDown')}
                title={t('settings.ai.modelBox.moveDown')}
                disabled={index === rows.visible.length - 1}
                onClick={() => { void move(index, 1) }}
                className="size-7 text-nomi-ink-40 hover:text-nomi-accent disabled:bg-transparent"
                icon={<IconChevronDown size={15} stroke={1.7} aria-hidden="true" />}
              />
              <IconActionButton
                aria-label={t('settings.ai.modelBox.hide')}
                title={t('settings.ai.modelBox.hide')}
                onClick={() => { void toggleHidden(row.canonicalId, true) }}
                className="size-7 text-nomi-ink-40 hover:text-nomi-accent"
                icon={<IconEye size={15} stroke={1.7} aria-hidden="true" />}
              />
            </span>
          </li>
        ))}
      </ol>
      {rows.hidden.length > 0 ? (
        // 藏起来的东西必须看得见「去哪儿了、怎么找回」，否则隐藏就等于删除（方案 §7 卡点表②）。
        <div data-model-box-hidden-group className="mt-3.5 grid gap-2 border-t border-nomi-line-soft pt-3">
          <div className="text-micro leading-none text-nomi-ink-40">
            {t('settings.ai.modelBox.hiddenGroup', { count: rows.hidden.length })}
          </div>
          {rows.hidden.map((row) => (
            <div
              key={row.canonicalId}
              data-model-box-hidden-row={row.canonicalId}
              className="flex min-h-8 min-w-0 items-center gap-3"
            >
              <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full bg-nomi-ink-05 text-micro text-nomi-ink-40">·</span>
              <span className="min-w-0 flex-1 truncate text-caption text-nomi-ink-40">{row.label}</span>
              <RowChips chips={row.chips} muted />
              <span className="flex shrink-0 gap-1">
                <IconActionButton
                  aria-label={t('settings.ai.modelBox.show')}
                  title={t('settings.ai.modelBox.show')}
                  onClick={() => { void toggleHidden(row.canonicalId, false) }}
                  className="size-7 text-nomi-ink-40 hover:text-nomi-accent"
                  icon={<IconEyeOff size={15} stroke={1.7} aria-hidden="true" />}
                />
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
