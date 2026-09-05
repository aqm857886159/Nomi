// 「优先供应商」设置区（设置 → AI 策略）。
//
// 解决的摩擦：同一个模型常常好几家都能跑（Seedream 4.5 在火山方舟 / APIMart / Kie 各有一份）。
// 用户心里通常有一家更信得过——便宜、快、或者额度在那边。以前这件事没有任何地方能表达，
// 只能每开一张卡手动换一次家。这里排一次序，之后自动选家、批量统一模型、模型下拉的第一顺位都跟着它。
//
// 为什么家在「AI 策略」而不是「模型」（设计系统 §1.7.2 的分界线）：
//   接入决定「有没有」，策略决定「怎么用」。填 key、连地址是接入（家在「模型」）；
//   「已经接好的几家里默认走哪家」是策略——和它同屏的「新建卡片默认模型」是同一族
//   （那块管默认选哪个**模型**，这块管默认走哪个**供应商**），两块必须住一起，
//   否则「默认用什么」会有两个家（§1.5.2 一功能一个家）。
//
// 只列**已配置**的家：没填 key 的家排进优先级没有意义（排第一也走不了），
// 而且会让人误以为排了就能用。要多一家先去「模型」tab 接入。
import React from 'react'
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import { IconActionButton } from '../../design'
import { saveVendorPreferenceOrder, useVendorPreferenceOrder } from '../common/useVendorPreference'
import { orderConfiguredVendors, type VendorPreferenceEntry } from './vendorPreferenceOrder'

export function VendorPreferenceOrderSection({ entries }: { entries: readonly VendorPreferenceEntry[] }): JSX.Element | null {
  const { t } = useTranslation()
  const savedOrder = useVendorPreferenceOrder()
  const ordered = React.useMemo(() => orderConfiguredVendors(entries, savedOrder), [entries, savedOrder])

  // 顺序写在主进程（版本化原子 JSON）。写失败必须**说出来**：这个控件唯一的反馈就是行序变了，
  // 失败时行序不动 = 和「点了没反应」在屏幕上完全一样，用户只会以为按钮坏了。
  const [saveError, setSaveError] = React.useState(false)
  const move = React.useCallback(async (index: number, delta: -1 | 1) => {
    const next = ordered.map((entry) => entry.vendorKey)
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    try {
      await saveVendorPreferenceOrder(next)
      setSaveError(false)
    } catch {
      setSaveError(true)
    }
  }, [ordered])

  // 只有一家（或一家都没有）时整块不出现：一个只能排第一的列表是纯噪音，
  // 而且会诱导用户以为「这里能加供应商」（加的家在「模型」tab）。
  if (ordered.length < 2) return null

  return (
    <section
      data-settings-section="vendor-preference-order"
      data-vendor-preference-order
      className="mb-6"
      aria-labelledby="settings-vendor-preference-title"
    >
      <h3 id="settings-vendor-preference-title" className="mb-1 text-caption font-medium text-nomi-ink-60">
        {t('settings.ai.vendorPreference.title')}
      </h3>
      <div className="mb-3 text-micro leading-relaxed text-nomi-ink-40">
        {t('settings.ai.vendorPreference.hint')}
      </div>
      {saveError ? (
        <div role="alert" data-vendor-preference-error className="mb-3 text-micro leading-relaxed text-workbench-danger">
          {t('settings.ai.vendorPreference.saveFailed')}
        </div>
      ) : null}
      <ol className="grid gap-2">
        {ordered.map((entry, index) => (
          <li
            key={entry.vendorKey}
            data-vendor-preference-row={entry.vendorKey}
            className="flex min-h-8 min-w-0 items-center gap-3"
          >
            <span
              aria-label={t('settings.ai.vendorPreference.rank', { rank: index + 1 })}
              className="grid size-5 shrink-0 place-items-center rounded-full bg-nomi-accent-soft text-micro font-semibold text-nomi-accent"
            >
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-caption text-nomi-ink-80">{entry.name}</span>
            {/* `disabled:bg-transparent`：Mantine 的 subtle 档给 disabled 铺了一块灰底，
                而首尾两端**必然**有一个箭头是禁用的——铺了底反倒比能点的那个更抢眼，
                读起来像「被选中」而不是「点不了」（设计系统 §1.6 C1）。这里只按淡化处理。 */}
            <span className="flex shrink-0 gap-1">
              <IconActionButton
                aria-label={t('settings.ai.vendorPreference.moveUp')}
                title={t('settings.ai.vendorPreference.moveUp')}
                disabled={index === 0}
                onClick={() => { void move(index, -1) }}
                className="size-7 text-nomi-ink-40 hover:text-nomi-accent disabled:bg-transparent"
                icon={<IconChevronUp size={15} stroke={1.7} aria-hidden="true" />}
              />
              <IconActionButton
                aria-label={t('settings.ai.vendorPreference.moveDown')}
                title={t('settings.ai.vendorPreference.moveDown')}
                disabled={index === ordered.length - 1}
                onClick={() => { void move(index, 1) }}
                className="size-7 text-nomi-ink-40 hover:text-nomi-accent disabled:bg-transparent"
                icon={<IconChevronDown size={15} stroke={1.7} aria-hidden="true" />}
              />
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
