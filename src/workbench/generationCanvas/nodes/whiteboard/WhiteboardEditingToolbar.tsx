import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconArrowBackUp, IconArrowForwardUp, IconBrush, IconCamera, IconEraser, IconFlipHorizontal, IconFlipVertical, IconLayersSubtract, IconPhoto, IconPhotoPlus, IconPointer, IconStack2, IconTrash, IconTypography, IconWand } from '@tabler/icons-react'
import { resolveAnchoredPopoverPlacement } from '../../../../design/anchoredPopoverPlacement'
import { DesignNumberInput } from '../../../../design/forms'
import { NomiLoadingMark } from '../../../../design/identity'
import { ToolbarActionPanel } from '../ToolbarActionMenu'
import { FloatingToolbarShell, ToolbarButton, ToolbarDivider, ToolbarIconButton } from '../NodeFloatingToolbar'
import { collectBottomDockRects, resolveUsableBottomAboveDocks } from '../../../generation/workspaceBottomDocks'
import { ASPECT_RATIOS, COMMON_COLORS, type AspectRatioKey, type ToolKey } from './lib/canvas'
import type { CanvasObjectTarget } from './whiteboardCanvasTypes'

export type WhiteboardPanel = 'materials' | 'layers' | 'colors' | 'ratio' | null
export type WhiteboardEditingToolbarProps = {
  activeTool: ToolKey; onToolChange: (tool: ToolKey) => void
  color: string; onColorChange: (color: string) => void
  brushSize: number; onBrushSizeChange: (value: number) => void
  textValue?: string; onTextValueChange: (value: string) => void
  textSize?: number; onTextSizeChange: (value: number) => void
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void
  onUpload: () => void; uploading: boolean
  panel: WhiteboardPanel; onPanelChange: (panel: WhiteboardPanel) => void; panelContent: React.ReactNode
  selectedTargets: CanvasObjectTarget[]; onFlip: (axis: 'x' | 'y') => void
  onGroup: () => void; onDelete: () => void; onRemoveBackground: () => void; removeBgBusy: boolean
  ratio: AspectRatioKey; onRatioChange: (ratio: AspectRatioKey) => void
  dimensions: { width: number; height: number }; onDimensionsChange: (value: { width: number; height: number }) => void
  onScreenshot?: () => void; screenshotBusy: boolean; screenshotLabel: string; onDone?: () => void; feedback?: string | null
}

function WhiteboardNumberInput({ value, min, max, onChange, label, className }: { value: number; min: number; max: number; onChange: (value: number) => void; label: string; className: string }): React.JSX.Element {
  const [draft, setDraft] = React.useState<string | number>(value)
  React.useEffect(() => setDraft(value), [value])
  return <DesignNumberInput value={draft} min={min} max={max} clampBehavior="blur" hideControls size="xs" aria-label={label} className={className} onChange={next => {
    setDraft(next)
    if (typeof next === 'number' && next >= min && next <= max) onChange(next)
  }} />
}

/** Shared node toolbar and shared rich-content popover; every panel uses the whole bar's centre. */
export function WhiteboardEditingToolbar(p: WhiteboardEditingToolbarProps): React.JSX.Element {
  const { t } = useTranslation()
  const anchorRef = React.useRef<HTMLDivElement | null>(null)
  const boundaryRect = (size: { width: number; height: number }) => {
    const anchor = anchorRef.current
    const stage = anchor?.closest<HTMLElement>('.generation-canvas-v2__stage')
    if (!anchor || !stage) return new DOMRect(0, 0, window.innerWidth, window.innerHeight)
    const rect = stage.getBoundingClientRect()
    const bar = anchor.getBoundingClientRect()
    const popup = resolveAnchoredPopoverPlacement(bar, size, 'center', 8, rect)
    const left = popup.left - rect.left
    const bottom = resolveUsableBottomAboveDocks({
      viewport: { top: 0, bottom: rect.height },
      span: { left, right: left + size.width },
      docks: collectBottomDockRects(stage, rect),
    })
    return new DOMRect(rect.left, rect.top, rect.width, bottom)
  }
  const labels: Record<string, string> = {
    title: t('generationCommon.whiteboard.title'),
    select: t('generationCommon.whiteboard.select'),
    brush: t('generationCommon.whiteboard.brush'),
    eraser: t('generationCommon.whiteboard.eraser'),
    text: t('generationCommon.whiteboard.text'),
    undo: t('generationCommon.whiteboard.undo'),
    redo: t('generationCommon.whiteboard.redo'),
    importImage: t('generationCommon.whiteboard.importImage'),
    materials: t('generationCommon.whiteboard.materials'),
    layers: t('generationCommon.whiteboard.layers'),
    flipHorizontal: t('generationCommon.whiteboard.flipHorizontal'),
    flipVertical: t('generationCommon.whiteboard.flipVertical'),
    group: t('generationCommon.whiteboard.group'),
    removeBackground: t('generationCommon.whiteboard.removeBackground'),
    deleteSelected: t('generationCommon.whiteboard.deleteSelected'),
    customBrushColor: t('generationCommon.whiteboard.customBrushColor'),
    brushSize: t('generationCommon.whiteboard.brushSize'),
    fontSize: t('generationCommon.whiteboard.fontSize'),
    canvasSize: t('generationCommon.whiteboard.canvasSize'),
    width: t('generationCommon.whiteboard.width'),
    height: t('generationCommon.whiteboard.height'),
    done: t('generationCommon.whiteboard.done'),
  }
  const label = (key: string) => labels[key]
  const openLocal = (value: 'colors' | 'ratio') => p.onPanelChange(p.panel === value ? null : value)
  const openPanel = (value: Exclude<WhiteboardPanel, null>) => p.onPanelChange(p.panel === value ? null : value)
  const close = () => p.onPanelChange(null)
  const iconButton = (key: string, icon: React.ReactNode, onClick: () => void, disabled = false) => (
    <ToolbarIconButton key={key} actionId={`whiteboard-${key}`} icon={icon} title={label(key)} ariaLabel={label(key)} onClick={onClick} disabled={disabled} />
  )
  const icon = { size: 16, stroke: 1.6 }
  return <>
    <FloatingToolbarShell ariaLabel={label('title')} nodeId={null} side="below" centerOnNode avoidBottomDocks toolbarRef={anchorRef}>
      {([
        ['select', <IconPointer {...icon} />], ['brush', <IconBrush {...icon} />], ['eraser', <IconEraser {...icon} />],
        ['text', <IconTypography {...icon} />],
      ] as const).map(([tool, glyph]) => <ToolbarButton key={tool} actionId={`whiteboard-${tool}`} icon={glyph} accent={p.activeTool === tool} title={label(tool)} ariaLabel={label(tool)} className="w-8 px-0" onClick={() => { close(); p.onToolChange(tool) }} />)}
      {(p.activeTool === 'brush' || p.textValue !== undefined) && <button type="button" data-toolbar-action="whiteboard-colors" className="grid size-8 place-items-center rounded-nomi-sm hover:bg-nomi-ink-05" aria-label={label('customBrushColor')} onClick={() => openLocal('colors')}><span className="size-4 rounded-full border border-nomi-line" style={{ backgroundColor: p.color }} /></button>}
      {(p.activeTool === 'brush' || p.activeTool === 'eraser') && <><input className="w-16 accent-nomi-accent" type="range" min={4} max={96} value={p.brushSize} aria-label={label('brushSize')} onChange={event => p.onBrushSizeChange(Number(event.target.value))} /><output className="w-5 text-center text-caption tabular-nums text-nomi-ink-60">{p.brushSize}</output></>}
      {p.textValue !== undefined && <>
        <input className="h-7 w-24 rounded-nomi-sm border border-nomi-line bg-nomi-bg px-2 text-caption" value={p.textValue} aria-label={label('text')} onChange={event => p.onTextValueChange(event.target.value)} />
        <WhiteboardNumberInput className="w-12" min={8} max={160} value={p.textSize ?? 24} label={label('fontSize')} onChange={p.onTextSizeChange} />
      </>}
      <ToolbarDivider />
      {iconButton('undo', <IconArrowBackUp {...icon} />, p.onUndo, !p.canUndo)}
      {iconButton('redo', <IconArrowForwardUp {...icon} />, p.onRedo, !p.canRedo)}
      {iconButton('importImage', <IconPhotoPlus {...icon} />, p.onUpload, p.uploading)}
      {iconButton('materials', <IconPhoto {...icon} />, () => openPanel('materials'))}
      {iconButton('layers', <IconStack2 {...icon} />, () => openPanel('layers'))}
      {p.selectedTargets.length > 0 && <>
        <ToolbarDivider />
        {p.selectedTargets.length === 1 && iconButton('flipHorizontal', <IconFlipHorizontal {...icon} />, () => p.onFlip('x'))}
        {p.selectedTargets.length === 1 && iconButton('flipVertical', <IconFlipVertical {...icon} />, () => p.onFlip('y'))}
        {p.selectedTargets.length > 1 && iconButton('group', <IconLayersSubtract {...icon} />, p.onGroup)}
        {p.selectedTargets.length === 1 && p.selectedTargets[0].kind === 'asset' && iconButton('removeBackground', <IconWand {...icon} />, p.onRemoveBackground, p.removeBgBusy)}
        {p.selectedTargets.length === 1 && iconButton('deleteSelected', <IconTrash {...icon} />, p.onDelete)}
      </>}
      <ToolbarDivider />
      <button type="button" data-toolbar-action="whiteboard-ratio" className="h-8 rounded-nomi-sm px-2 text-caption tabular-nums text-nomi-ink-60 hover:bg-nomi-ink-05" aria-label={label('canvasSize')} onClick={() => openLocal('ratio')}>{p.dimensions.width} × {p.dimensions.height}</button>
      {p.onScreenshot && <ToolbarIconButton actionId="whiteboard-capture" icon={<IconCamera {...icon} />} title={p.screenshotLabel} ariaLabel={p.screenshotLabel} onClick={p.onScreenshot} disabled={p.screenshotBusy} />}
      {/* While Done is exporting and saving (seconds on a large board), the button itself says so within the same frame: the editor must stay mounted until the export has read the live canvas. */}
      <ToolbarButton actionId="whiteboard-done" icon={p.screenshotBusy ? <NomiLoadingMark size={14} /> : null} label={p.screenshotBusy ? t('generationCommon.whiteboard.doneSaving') : label('done')} accent ariaBusy={p.screenshotBusy} disabled={p.screenshotBusy || p.uploading || p.removeBgBusy} onClick={p.onDone} />
    </FloatingToolbarShell>
    {p.panel && <ToolbarActionPanel anchorRef={anchorRef} boundaryRect={boundaryRect} align="center" side="bottom" gap={8} onClose={close}>
      <div data-whiteboard-panel={p.panel} className="nodrag nopan nokey nowheel w-max max-w-[560px] overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper text-nomi-ink shadow-nomi-md" onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
        {p.panel === 'colors' ? <div className="flex items-center gap-2 p-2">
          {COMMON_COLORS.map(color => <button type="button" key={color} aria-label={t('generationCommon.whiteboard.colorAria', { color })} aria-pressed={color === p.color} className="size-6 rounded-full border border-nomi-line focus-visible:outline-nomi-ink" style={{ backgroundColor: color }} onClick={() => p.onColorChange(color)} />)}
          <input type="color" value={p.color} aria-label={label('customBrushColor')} onChange={event => p.onColorChange(event.target.value)} className="size-7 cursor-pointer border-0 bg-transparent p-0" />
        </div> : p.panel === 'ratio' ? <div className="grid gap-2 p-3">
          <div className="flex items-center justify-center gap-1">{ASPECT_RATIOS.map(ratio => <button type="button" key={ratio.label} aria-pressed={ratio.label === p.ratio} className="h-7 rounded-nomi-sm px-2 text-caption hover:bg-nomi-ink-05" onClick={() => p.onRatioChange(ratio.label)}>{ratio.label}</button>)}</div>
          <div className="flex items-center justify-center gap-2">{(['width', 'height'] as const).map(key => <label key={key} className="flex items-center gap-1 text-caption text-nomi-ink-60">{label(key)}<WhiteboardNumberInput min={64} max={4096} value={p.dimensions[key]} label={label(key)} className="w-20" onChange={value => p.onDimensionsChange({ ...p.dimensions, [key]: value })} /></label>)}</div>
        </div> : p.panelContent}
      </div>
    </ToolbarActionPanel>}
    {p.feedback && <div role="status" className="pointer-events-none absolute bottom-2 left-1/2 max-w-full -translate-x-1/2 rounded-nomi-sm bg-nomi-paper px-2 py-1 text-caption text-workbench-danger shadow-nomi-sm">{p.feedback}</div>}
  </>
}
