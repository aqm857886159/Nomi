// Design Lab · 「去掉强调色描边」样张的取景台（docs/plan/2026-10-10-no-accent-outline.md）。
//
// 每格成对出两张：「现在」= 生产组件原样；「改后」= 同一个生产组件外面包一层 `.nao-after`，
// 由这里的覆盖样式把强调色描边改成规则里定的样子。生产组件一行不动。
// 覆盖样式只作用于 `.nao-after` 子树，不是全局 CSS。它是样张，不是落地实现：落地要改的是共享件和 token。
import React, { type JSX } from 'react'
import { HandlesStage, FIXTURES } from '../canvasHandles/canvasHandlesLabKit'
import { CanvasGroupingStage } from '../canvasGrouping/canvasGroupingLabKit'
import { AssetGridCell } from '../../../workbench/assets/AssetLibraryPanelParts'
import CategoryItem from '../../../workbench/sidebar/CategoryItem'
import { DesignButton } from '../../../design/actions'
import { TooltipProvider } from '../../../design'
import { V4ConsentCard } from '../../../workbench/ai/v4/AgentPanelV4Consent'
import { V4_COMPOSER_STATES } from '../v4/states/02-composer'
import type { ProjectCategory } from '../../../workbench/project/projectCategories'
import type { AssetRef } from '../../../workbench/assets/assetTypes'

export type NaoCellId = 'single' | 'multi' | 'group' | 'asset' | 'list' | 'input' | 'keyboard' | 'card'
export type NaoVariant = 'now' | 'after'

/**
 * 「改后」的覆盖样式（只在 `.nao-after` 之下生效）。规则对应设计卡的五类：
 *  · 常驻的强调色描边 → 普通灰线（decor）；
 *  · 键盘焦点环 → 深色（ink）；
 * 单选不加框、多选深色线、素材勾角标这几条，要看每格的真实形态后再逐格收，见报告。
 */
export const NAO_AFTER_CSS = `
.nao-after { --nomi-focus: color-mix(in srgb, var(--nomi-ink) 55%, transparent); }
.nao-after [data-frame-selected="true"] { border-color: var(--nomi-line) !important; }
.nao-after [class*="ring-nomi-accent"] { --tw-ring-color: transparent !important; }
.nao-after [class*="border-nomi-accent"] { border-color: var(--nomi-ink-20) !important; }
.nao-after [class*="outline-nomi-accent"] { outline-color: var(--nomi-ink-20) !important; }
.nao-after [class*="--nomi-accent-soft"] { box-shadow: none !important; }
.nao-after [class*="border-nomi-accent"][class*="--nomi-accent-soft"] { border-color: var(--nomi-ink-40) !important; }
.nao-after :focus-visible { outline-color: var(--nomi-ink) !important; --tw-ring-color: var(--nomi-ink) !important; }
`

/** 一格的包装：「现在」原样，「改后」套 `.nao-after` 并注入覆盖样式。 */
export function NaoCell({ variant, children }: { variant: NaoVariant; children: React.ReactNode }): JSX.Element {
  return (
    <div className={variant === 'after' ? 'nao-after' : 'nao-now'} data-nao-variant={variant} style={{ position: 'relative', width: '100%', height: '100%' }}>
      {variant === 'after' ? <style>{NAO_AFTER_CSS}</style> : null}
      <TooltipProvider delayDuration={250}>{children}</TooltipProvider>
    </div>
  )
}

const noop = (): void => {}

function sampleAsset(id: string, name: string, url: string): AssetRef {
  return { id, kind: 'image', name, renderUrl: url, thumbUrl: url, source: 'project', origin: { source: 'project', projectId: 'design-lab', relativePath: name } }
}

const SAMPLE_ASSETS: readonly AssetRef[] = [
  sampleAsset('nao-asset-a', '海边公路.png', '/prompt-media/expressions/builtin-expr-joy-1.webp'),
  sampleAsset('nao-asset-b', '沙漠公路.png', '/prompt-media/expressions/builtin-expr-fear-1.webp'),
  sampleAsset('nao-asset-c', '夜景.png', '/prompt-media/expressions/builtin-expr-surprise-1.webp'),
  sampleAsset('nao-asset-d', '雨天.png', '/prompt-media/expressions/builtin-expr-joy-1.webp'),
]

const SAMPLE_CATEGORY: ProjectCategory = {
  id: 'nao-cat-shots',
  name: '镜头',
  icon: '',
  iconName: 'IconPhoto',
  defaultNodeRenderKind: 'shot-frame',
  order: 1,
  isBuiltin: true,
}

/** 按钮键盘焦点：挂载后程序化聚焦第一颗（焦点环由 :focus-visible 决定，和真实 Tab 进入一致）。 */
function KeyboardFocusRow(): JSX.Element {
  const first = React.useRef<HTMLButtonElement | null>(null)
  React.useEffect(() => {
    first.current?.focus()
  }, [])
  return (
    <div className="flex flex-wrap items-center gap-3 p-6">
      <DesignButton ref={first}>保存</DesignButton>
      <DesignButton>取消</DesignButton>
      <DesignButton>生成</DesignButton>
    </div>
  )
}

const COMPOSER_IDLE_FOCUSED = V4_COMPOSER_STATES.find((state) => state.id === 'v4-composer-idle')

/** 八格的生产组件本体。「现在」「改后」共用同一份渲染，差别只在包装。 */
export function renderNaoCell(cell: NaoCellId, variant: NaoVariant): JSX.Element {
  const body = ((): JSX.Element => {
    switch (cell) {
      case 'single':
        return <HandlesStage locale="zh-CN" nodes={[FIXTURES.genImage(), FIXTURES.asset()]} selectedId="h-gen" />
      case 'multi':
        return <CanvasGroupingStage />
      case 'group':
        return <CanvasGroupingStage initialGrouped />
      case 'asset':
        return (
          <div className="grid grid-cols-2 gap-3 p-6" style={{ width: 560 }}>
            {SAMPLE_ASSETS.map((asset, index) => (
              <AssetGridCell key={asset.id} asset={asset} selectable selected={index < 2} onSelect={noop} onToggleSelect={noop} />
            ))}
          </div>
        )
      case 'list':
        return (
          <div className="flex w-[260px] flex-col gap-1 p-6">
            <CategoryItem category={SAMPLE_CATEGORY} count={12} active collapsed={false} onActivate={noop} />
            <CategoryItem category={{ ...SAMPLE_CATEGORY, id: 'nao-cat-scenes', name: '场景', iconName: 'IconBox', order: 2 }} count={5} active={false} collapsed={false} onActivate={noop} />
          </div>
        )
      case 'input':
        return COMPOSER_IDLE_FOCUSED ? <>{COMPOSER_IDLE_FOCUSED.render()}</> : <div />
      case 'keyboard':
        return <KeyboardFocusRow />
      case 'card':
        return <div className="p-6" style={{ width: 360 }}><V4ConsentCard forceVisible /></div>
    }
  })()
  return <NaoCell variant={variant}>{body}</NaoCell>
}
