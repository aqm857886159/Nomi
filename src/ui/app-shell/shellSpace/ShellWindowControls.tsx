// 窗口按钮的**位**（样张占位）。生产实现不画按钮：
//   - Windows：Electron `titleBarOverlay`（高 40，颜色随光 / 暗切换）由系统画三颗原生按钮，我们只让位；
//     让位宽度实现时读 CSS `env(titlebar-area-width)`，这里先用 3 × 46 = 138 的占位。
//   - macOS：`titleBarStyle: 'hiddenInset'` + `trafficLightPosition` 把红绿灯放进 40px 栏的最左，品牌往右让。
// 样张里画出的是灰色占位（不是真按钮、不可点），只为证明位置与让位够不够。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconMinus, IconSquare, IconX } from '@tabler/icons-react'
import { SHELL_MAC_TRAFFIC_WIDTH, SHELL_WIN_CONTROLS_WIDTH } from '../shellSpaceSpecimen'

export function ShellWinControlsSlot(): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className="flex h-full shrink-0 items-stretch text-nomi-ink-60"
      style={{ width: SHELL_WIN_CONTROLS_WIDTH }}
      data-shell-window-controls="win"
      data-specimen-placeholder="titleBarOverlay"
      title={t('shellSpace.topbar.winControls')}
      aria-hidden="true"
    >
      {[IconMinus, IconSquare, IconX].map((Icon, index) => (
        <span key={index} className="grid flex-1 place-items-center">
          <Icon size={index === 1 ? 12 : 15} stroke={1.4} />
        </span>
      ))}
    </div>
  )
}

export function ShellMacTrafficSlot(): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className="flex h-full shrink-0 items-center gap-2 pl-3"
      style={{ width: SHELL_MAC_TRAFFIC_WIDTH }}
      data-shell-window-controls="mac"
      data-specimen-placeholder="hiddenInset"
      title={t('shellSpace.topbar.macControls')}
      aria-hidden="true"
    >
      {[0, 1, 2].map((index) => <span key={index} className="size-3 rounded-full bg-nomi-ink-20" />)}
    </div>
  )
}
