/**
 * [INPUT]: 依赖 react、react-i18next、../../agent/cameraMoveVocab 的 CAMERA_MOVE_LABEL(_EN)、../../model/directorShotSummaries、../../model/directorEvalMeasurement 的 EvalShotSize
 * [OUTPUT]: 对外提供 useShotLabels / makeShotLabels（纯函数版）：把一镜实测摘要翻成界面文字（景别 · 运镜、小窗「镜头 N · 景别 · 运镜」、这一镜的角色动作）
 * [POS]: 导演视图三处（镜头卡、预览小窗、顶栏标题）共用的一份措辞：同一镜在三处读出来必须一字不差，所以只在这里拼。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { CAMERA_MOVE_LABEL, CAMERA_MOVE_LABEL_EN } from '../../agent/cameraMoveVocab'
import type { EvalShotSize } from '../../model/directorEvalMeasurement'
import type { DirectorShotSummary } from '../../model/directorShotSummaries'

// 景别刻度的中文名就是测量模块的枚举值；英文按同一刻度一一对应
const SHOT_SIZE_EN: Record<EvalShotSize, string> = {
  远景: 'Far', 全景: 'Wide', 中景: 'Medium', 中近景: 'Medium close',
  近景: 'Close', 特写: 'Close-up', 大特写: 'Extreme close-up',
}

export type ShotLabels = {
  headline: (shot: DirectorShotSummary) => string
  pip: (shot: DirectorShotSummary, index: number) => string
  actions: (shot: DirectorShotSummary) => string
}

type Translate = (key: string, options?: Record<string, unknown>) => string

/**
 * 纯函数版（界面经 useShotLabels 用；测试直接调）。景别量不到（没有可测主体）就只写运镜——
 * 「未测量 · 固定」里的「未测量」对用户没有信息，只占地方（外包卡 20，用户 10-05 拍板）。
 */
export function makeShotLabels(t: Translate, english: boolean): ShotLabels {
  const size = (shot: DirectorShotSummary) => (shot.shotSize ? (english ? SHOT_SIZE_EN[shot.shotSize] : shot.shotSize) : null)
  const move = (shot: DirectorShotSummary) => (english ? CAMERA_MOVE_LABEL_EN : CAMERA_MOVE_LABEL)[shot.move] ?? shot.move
  return {
    headline: (shot) => {
      const measured = size(shot)
      return measured ? t('director.view.shotHeadline', { size: measured, move: move(shot) }) : move(shot)
    },
    pip: (shot, index) => {
      const measured = size(shot)
      return measured ? t('director.view.pipShotLabel', { index: index + 1, size: measured, move: move(shot) }) : t('director.view.pipShotMoveOnly', { index: index + 1, move: move(shot) })
    },
    actions: (shot) => shot.actions.length
      ? shot.actions.map((action) => t('director.view.shotAction', { name: action.objectName, action: t(`director.action.library.${action.actionPose}` as 'director.action.library.Idle_Loop', { defaultValue: action.clipName }) })).join(' · ')
      : t('director.view.noShotAction'),
  }
}

export function useShotLabels(): ShotLabels {
  const { t, i18n } = useTranslation()
  const english = i18n.language.startsWith('en')
  return React.useMemo(() => makeShotLabels(t as unknown as Translate, english), [english, t])
}
