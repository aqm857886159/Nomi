import type { JSX } from 'react'
import { IconCards, IconPhotoVideo, IconStack2, IconTypography } from '@tabler/icons-react'
import type { NomiSelectOption } from '../../../../design'
import { modeRowName, renderModeMenuText, type ModeDisplayKind, type ModeMenuRow } from './modeMenuModel'

type Translate = (key: string, values?: Record<string, unknown>) => string

/** 方式的图标（§6 登记）：文生视频 / 图生视频 / 首尾帧 / 全能参考。 */
function modeGlyph(kind: Exclude<ModeDisplayKind, 'other'>): JSX.Element {
  const Icon = kind === 'text' ? IconTypography : kind === 'image' ? IconPhotoVideo : kind === 'firstLast' ? IconCards : IconStack2
  return <Icon size={14} stroke={1.6} aria-hidden />
}

/** 底栏方式格的下拉行：名字、一句说明、置灰、图标（归不了类的行不配图标）。 */
export function modeMenuOptions(t: Translate, rows: readonly ModeMenuRow[]): NomiSelectOption[] {
  return rows.map((row) => ({
    value: row.id,
    label: modeRowName(t, row),
    description: renderModeMenuText(t, row.description),
    disabled: row.disabled,
    ...(row.kind === 'other' ? {} : { glyph: modeGlyph(row.kind) }),
  }))
}
