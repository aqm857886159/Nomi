// 项目库页的更新通知位：热修横幅 + 「已更新到 x」卡。两个都没有要出的内容时这个容器自己隐藏（empty:hidden）。
// 外壳线（feat/shell-redesign）合入后，谁后合谁把它挪进新项目库页的 `notices` 位（data-library-notices）。
import React, { type JSX } from 'react'
import { HotfixBanner } from './HotfixBanner'
import { UpdatedCard } from './UpdatedCard'

export function UpdateNotices(): JSX.Element {
  return (
    <div data-library-notices="true" className="flex shrink-0 flex-col gap-3 empty:hidden">
      <HotfixBanner />
      <UpdatedCard />
    </div>
  )
}
