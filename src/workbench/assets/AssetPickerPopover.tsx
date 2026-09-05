import React from 'react'
import { AnchoredPopover } from '../../design'

// 素材选择器的浮层：定位/翻转/夹进视口/点外面关，全部由 design/AnchoredPopover 负责
// （规范 §5：选择器绝不能被裁；之前 absolute 在 composer 卡内被切掉一大半、上传按钮看不见）。
// 这里只保留一件本地事：z 轴压在 60，不抢 composer 之上那些模态的位置。
const ASSET_PICKER_Z_INDEX = 60

export default function AssetPickerPopover({ onClose, children }: { onClose: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <AnchoredPopover align="start" zIndex={ASSET_PICKER_Z_INDEX} onClose={onClose}>
      {children}
    </AnchoredPopover>
  )
}
