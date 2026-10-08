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
 * 空节点「试试」——所有种类**一个**列表组件（2026-10-08 拍板 ③）。替换那句操作说明，不叠加。
 * 排法（2026-10-08 用户「排版都不对齐」后）：全部内容只对齐一条居中轴——动作是一排居中的胶囊按钮（工作区次要按钮 sm，
 * 图标 + 两三个字），放不下就换行、仍居中。不再有孤零零的「试试」小字：胶囊本身带图标和动词，一眼就是可点的建议；
 * 「试试」两个字只留给读屏的分组名（aria-label）——前缀版在 180–340px 宽的卡里换行时会落单成一行，反而又歪。
 * 点一下跑配方（只搭结构、一步撤销）；没有配方的种类不出现（返回 null）。
 */
export function NodeTryList({ node }: { node: GenerationCanvasNode }): JSX.Element | null {
  const { t } = useTranslation()
  const recipes = nodeTryRecipes(node)
  if (!recipes.length) return null
  return (
    <ul
      data-node-try={node.kind}
      className="pointer-events-auto m-0 flex max-w-full list-none flex-wrap items-center justify-center gap-1.5 p-0"
      aria-label={t('generationCommon.nodeTry.label')}
    >
      {recipes.map((recipe) => {
        const Icon = (recipe.icon === 'write' ? IconWriting : getGenerationNodeIcon(recipe.icon)) as unknown as RowIcon
        return (
          <li key={recipe.id}>
            <WorkbenchButton
              size="sm"
              data-node-try-recipe={recipe.id}
              onPointerDown={stopCanvasGesture}
              onClick={(event) => {
                event.stopPropagation()
                runNodeTryRecipe(node.id, recipe.id)
              }}
            >
              <Icon size={14} stroke={1.7} />
              <span>{t(recipe.labelKey)}</span>
            </WorkbenchButton>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * 剪辑卡空态：直说「把视频节点连进来」，给一个「在画布上点选」（画布共享的点选模式，点中即连进这张剪辑卡）。
 */
export function ClipEmptyTry({ nodeId, readOnly = false }: { nodeId: string; readOnly?: boolean }): JSX.Element {
  const { t } = useTranslation()
  return (
    <span className="pointer-events-auto inline-flex items-center justify-center gap-2" data-node-try="clip">
      <span className="text-caption text-nomi-ink-40">{t('generationCommon.nodeTry.clip.hint')}</span>
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
