import React, { type JSX } from 'react'
import { IconX } from '@tabler/icons-react'
import { cn } from '../../utils/cn'

/**
 * 缩略图角上的「×」：28px 点击区里一颗 16px 黑底白叉圆（`IconX` 12 / 2.67）。
 *
 * 输入框里的参考图（AssetTile 的 ×）与付费确认那一组的行尾（SpendCardQ1 板 card.pointer.exclude 起：「和输入框里参考图的 × 同一个样子」）
 * 读的是这一份——样子只在这里定义，两处都不许再抄一份类名（`ThumbCornerX.structure.test.ts` 数着）。
 * 摆在哪、什么时候露出来归调用方（`className`）：AssetTile 自己挂在 tile 的角上，付费确认那一组由组指向的 `PointerRow` 摆在行尾。
 */
export function ThumbCornerX({ className, ...props }: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'children'>): JSX.Element {
  return (
    <button
      type="button"
      data-thumb-corner-x="true"
      className={cn('flex size-7 cursor-pointer items-center justify-center border-0 bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-40', className)}
      {...props}
    >
      <i className="flex size-4 items-center justify-center rounded-full bg-nomi-ink text-nomi-paper" aria-hidden>
        <IconX size={12} stroke={2.67} />
      </i>
    </button>
  )
}
