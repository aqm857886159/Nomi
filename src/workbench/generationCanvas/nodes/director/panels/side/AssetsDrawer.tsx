/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design 的 WorkbenchIconButton、../../../../../../vendor/tablerIcons、
 *          ../topbar/topChrome 的 DIRECTOR_TOP_CHROME_PX、../context/useDismissOnEscape、./AssetsTab
 * [OUTPUT]: 对外提供 AssetsDrawer：精修左侧的资产库抽屉（卡头「资产库」+ ×，内容是原右栏上卡的 AssetsTab 原样）
 * [POS]: director/panels/side 的资产库宿主（精修「选中才出」布局）。资产库 10 次里 1–3 次才用，不再常驻成右栏页签，
 *        从「＋ 添加 ▾」底部「资产库」一次点击打开。住左边：右边归「选中的那个东西」的属性卡，两者可以同时开，互不顶掉；
 *        往场景里加完一个东西它不自己关——用户常常一次加好几个。
 *        它从顶栏下一直拉到视口底，会盖住左下的预览小窗（z-30）；抽屉是用户点开的，所以压在上面（z-40），关掉抽屉小窗原样回来。
 *        和旧右栏卡一样**不用 backdrop-blur**：模糊会让真实鼠标的双击送不到资产行（2026-09-09 实测「双击资产入场」失效）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { WorkbenchIconButton } from '../../../../../../design'
import { IconX } from '../../../../../../vendor/tablerIcons'
import { useDismissOnEscape } from '../context/useDismissOnEscape'
import { DIRECTOR_TOP_CHROME_PX } from '../topbar/topChrome'
import { AssetsTab } from './AssetsTab'

const DRAWER_WIDTH = 300
const EDGE = 12

export function AssetsDrawer({ onClose }: { onClose: () => void }): JSX.Element {
  const { t } = useTranslation()
  useDismissOnEscape(true, onClose)
  return (
    <div
      className="pointer-events-none absolute z-40 flex flex-col"
      style={{ left: EDGE, top: DIRECTOR_TOP_CHROME_PX, bottom: EDGE, width: DRAWER_WIDTH }}
      data-testid="director-assets-drawer"
      data-nomi-escape-layer="director-assets-drawer"
      data-nomi-hotkeys="pass"
    >
      <div className="pointer-events-auto flex h-full min-h-0 flex-col overflow-hidden rounded-nomi-lg border border-nomi-line bg-nomi-paper shadow-nomi-lg">
        <div className="flex h-[46px] shrink-0 items-center gap-2 border-b border-nomi-line-soft pl-3 pr-2 text-body-sm font-medium text-nomi-ink">
          <span className="min-w-0 flex-1 truncate">{t('director.regions.assets')}</span>
          <WorkbenchIconButton size="sm" icon={<IconX size={16} stroke={1.9} />} label={t('common.close')} data-testid="director-assets-close" onClick={onClose} />
        </div>
        <div className="min-h-0 flex-1">
          <AssetsTab />
        </div>
      </div>
    </div>
  )
}
