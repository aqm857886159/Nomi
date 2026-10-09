import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { nodeTryRecipes, runNodeTryRecipe } from './nodeTryRecipes'
import { pickCanvasInputFor } from './nodeInputActions'

/** 卡内的点击不能变成拖卡 / 框选：按下就截住（同 NodeEmptyAction）。 */
const stopCanvasGesture = (event: React.PointerEvent) => event.stopPropagation()

const TRY_ACTION_CLASS = [
  'inline-flex h-6 cursor-pointer items-center whitespace-nowrap rounded-nomi-sm border-0 bg-transparent px-1.5 font-[inherit] text-caption text-nomi-ink-80',
  'transition-colors hover:bg-nomi-ink-05 active:bg-nomi-ink-10',
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-nomi-accent',
].join(' ')

/** 纯文字动作之间的「·」（Claude Design 拍板稿：不套胶囊框，悬停才出浅底）。 */
function TrySeparator(): JSX.Element {
  return <span aria-hidden="true" className="text-caption text-nomi-ink-30">·</span>
}

/**
 * 空节点「试试」——所有种类**一个**列表组件（2026-10-08 拍板 ③ + 同日 Claude Design 拍板稿）。
 * 排法：纯文字按钮用「·」隔开、悬停才出浅底、不套框；**永远单行**（flex-nowrap，不靠 JS 量）——中英文文案按最小节点宽度写短，走查断言每种节点两种语言下动作行都是单行；
 * 「试试」两个字只留给读屏的分组名。点一下跑配方（只搭结构、一步撤销）；没有配方的种类不出现（返回 null）。
 */
export function NodeTryList({ node }: { node: GenerationCanvasNode }): JSX.Element | null {
  const { t } = useTranslation()
  const recipes = nodeTryRecipes(node)
  if (!recipes.length) return null
  return (
    <ul
      data-node-try={node.kind}
      className="pointer-events-auto m-0 flex max-w-full list-none flex-nowrap items-center justify-center gap-x-0.5 p-0"
      aria-label={t('generationCommon.nodeTry.label')}
    >
      {recipes.map((recipe, index) => (
        <React.Fragment key={recipe.id}>
          {index > 0 ? <li role="presentation"><TrySeparator /></li> : null}
          <li>
            <button
              type="button"
              data-node-try-recipe={recipe.id}
              className={TRY_ACTION_CLASS}
              onPointerDown={stopCanvasGesture}
              onClick={(event) => {
                event.stopPropagation()
                runNodeTryRecipe(node.id, recipe.id)
              }}
            >
              {t(recipe.labelKey)}
            </button>
          </li>
        </React.Fragment>
      ))}
    </ul>
  )
}

/**
 * 剪辑卡空态：它是一条 132px 高的时间轴条，放不下「图标 + 名 + 状态 + 动作」四层，所以收成一行：
 * 状态小字 + 「在画布上点选 · 从素材库添加」（点选 = 画布共享的点选模式，点中即连进这张剪辑卡；
 * 从素材库添加 = 时间轴左边「+」同一个素材选择器）。
 */
export function ClipEmptyTry({ nodeId, readOnly = false, onAddMaterial }: { nodeId: string; readOnly?: boolean; onAddMaterial?: () => void }): JSX.Element {
  const { t } = useTranslation()
  return (
    <span className="pointer-events-auto inline-flex flex-nowrap items-center justify-center gap-x-1" data-node-try="clip">
      <span className="text-caption text-nomi-ink-40">{t('generationCommon.nodeTry.status.clip')}</span>
      {readOnly ? null : (
        <>
          <TrySeparator />
          <button
            type="button"
            data-node-try-recipe="clip.pick"
            title={t('generationCommon.quickActions.addInput.pickOnCanvas')}
            className={TRY_ACTION_CLASS}
            onPointerDown={stopCanvasGesture}
            onClick={(event) => {
              event.stopPropagation()
              pickCanvasInputFor(nodeId)
            }}
          >
            {t('generationCommon.nodeTry.clip.pick')}
          </button>
          {onAddMaterial ? (
            <>
              <TrySeparator />
              <button
                type="button"
                data-node-try-recipe="clip.library"
                title={t('generationCommon.nodeTry.clip.fromLibrary')}
                className={TRY_ACTION_CLASS}
                onPointerDown={stopCanvasGesture}
                onClick={(event) => {
                  event.stopPropagation()
                  onAddMaterial()
                }}
              >
                {t('generationCommon.nodeTry.clip.library')}
              </button>
            </>
          ) : null}
        </>
      )}
    </span>
  )
}
