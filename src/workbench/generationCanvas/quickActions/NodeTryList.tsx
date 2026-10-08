import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconPointer, IconWriting } from '../../../vendor/tablerIcons'
import { WorkbenchButton } from '../../../design'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getGenerationNodeIcon } from '../nodes/renderRegistry'
import { nodeTryRecipes, runNodeTryRecipe } from './nodeTryRecipes'
import { pickCanvasInputFor } from './nodeInputActions'

type RowIcon = (props: { size?: number; stroke?: number }) => JSX.Element

/** 卡内的点击不能变成拖卡 / 框选：按下就截住（同 NodeEmptyAction）。 */
const stopCanvasGesture = (event: React.PointerEvent) => event.stopPropagation()

/**
 * 空节点「试试」——所有种类**一个**列表组件（2026-10-08 拍板 ③）。替换那一句操作说明，不叠加。
 * 一行 = 一个列表项（不是按钮外观）：行高 28、圆角、悬停 ink-05，与菜单项同一套节奏；点一下跑配方（只搭结构、一步撤销）。
 * 没有配方的种类不出现（返回 null）。
 */
export function NodeTryList({ node }: { node: GenerationCanvasNode }): JSX.Element | null {
  const { t } = useTranslation()
  const recipes = nodeTryRecipes(node)
  if (!recipes.length) return null
  return (
    <div data-node-try={node.kind} className="pointer-events-auto flex min-w-[11rem] flex-col gap-0.5 text-left">
      <span className="px-2 pb-0.5 text-micro text-nomi-ink-40">{t('generationCommon.nodeTry.label')}</span>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0" aria-label={t('generationCommon.nodeTry.label')}>
        {recipes.map((recipe) => {
          const Icon = (recipe.icon === 'write' ? IconWriting : getGenerationNodeIcon(recipe.icon)) as unknown as RowIcon
          return (
            <li key={recipe.id}>
              <button
                type="button"
                data-node-try-recipe={recipe.id}
                className="inline-flex min-h-7 w-full cursor-pointer items-center gap-2 rounded-nomi border-0 bg-transparent px-2 text-left font-[inherit] text-caption text-nomi-ink-80 hover:bg-nomi-ink-05"
                onPointerDown={stopCanvasGesture}
                onClick={(event) => {
                  event.stopPropagation()
                  runNodeTryRecipe(node.id, recipe.id)
                }}
              >
                <Icon size={14} stroke={1.7} />
                <span>{t(recipe.labelKey)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * 剪辑卡空态：直说「把视频节点连进来」，给一个「在画布上点选」（画布共享的点选模式，点中即连进这张剪辑卡）。
 */
export function ClipEmptyTry({ nodeId, readOnly = false }: { nodeId: string; readOnly?: boolean }): JSX.Element {
  const { t } = useTranslation()
  return (
    <span className="pointer-events-auto inline-flex items-center gap-3" data-node-try="clip">
      <span className="text-caption text-nomi-ink-60">{t('generationCommon.nodeTry.clip.hint')}</span>
      {readOnly ? null : <WorkbenchButton
        size="sm"
        onPointerDown={stopCanvasGesture}
        onClick={(event) => {
          event.stopPropagation()
          pickCanvasInputFor(nodeId)
        }}
      >
        <IconPointer size={14} stroke={1.7} />
        {t('generationCommon.quickActions.addInput.pickOnCanvas')}
      </WorkbenchButton>}
    </span>
  )
}
