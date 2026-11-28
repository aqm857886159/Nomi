import React, { type JSX } from 'react'
import { IconCoin } from '../../../vendor/tablerIcons'
import { ICON_TIERS } from '../../../design'
import type { SendCostUnit } from './sendCostUnitStore'

/**
 * 约价数字的唯一写法：发送键、单位菜单触发钮、节点下方「出高清 / 重拍样片」钮、第二次出高清确认框主钮都用它。
 * 数字本身只由 sendCostPillText 按 useSendCostUnit 那份偏好出；这里只管单位记号：积分带硬币，人民币 / 美元只写 ≈ 数、不带硬币。
 */
export function SendCostAmount({ text, unit }: { text: string; unit: SendCostUnit | undefined }): JSX.Element {
  return (
    <>
      {(unit ?? 'credits') === 'credits' ? <IconCoin size={ICON_TIERS.corner.size} stroke={ICON_TIERS.corner.stroke} aria-hidden /> : null}
      {text}
    </>
  )
}
