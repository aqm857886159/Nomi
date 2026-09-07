/**
 * 视频节点浮条上的「提取深度」。
 *
 * 形态由 2026-09-07 用户两次拍板定下来：
 * ① 深度视频**不是一种节点**，是视频节点上的一个动作——所以这里没有「选源」，
 *    源就是用户选中的这一个。
 * ② **点了就跑**。原话：「其实如果这么砍了之后 也没啥设计的 只要保持一致 能挂入参考被模型
 *    使用就行」。所以这里也没有面板、没有三选一、没有「高级」：输出只有一种，配方只有一份
 *    （`VIDEO_DEPTH_RECIPE`）。用户在那一刻没有判断依据去挑 12 还是 30fps——问他等于
 *    把我们的功课推给他（D1）。
 *
 * 于是这颗按钮回到它本来的样子：和抽首帧、拆解排一排的**一个普通动作**，
 * 点一下、旁边长出一张卡、进度全在那张卡上。这里不存任何状态——**存了就会有第二份真相**，
 * 而按钮上那份必然先过时（用户点完随手点一下空白，浮条就卸载了）。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconShadow } from '@tabler/icons-react'
import { TOOLBAR_ICON as I, ToolbarButton } from '../nodes/NodeFloatingToolbar'
import { startVideoDepthDerivation } from './startVideoDepthDerivation'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

export default function NodeDepthActionButton({
  node,
  disabled = false,
}: {
  node: GenerationCanvasNode
  disabled?: boolean
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <ToolbarButton
      icon={<IconShadow size={I.size} stroke={I.stroke} />}
      label={t('videoDepth.action.label')}
      // 那句诚实边界（§12.4：深度参考不承载手指/表情/衣物，也不保证比原片更准）此前住在
      // 面板的「高级」里。面板砍了，它没有跟着消失——搬进这颗按钮的悬停说明，
      // 也就是用户在**按下之前**唯一会读的那一处（D4：缺口明着标，不藏）。
      title={t('videoDepth.action.hint')}
      disabled={disabled}
      onClick={() => {
        startVideoDepthDerivation(node)
      }}
    />
  )
}
