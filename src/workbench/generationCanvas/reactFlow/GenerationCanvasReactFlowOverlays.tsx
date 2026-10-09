import React, { type JSX } from 'react'
import { lazyWithChunkBoundary } from '../../../ui/chunkBoundary'
import { CanvasEmptyState } from '../components/CanvasEmptyState'
import { CanvasNavigationStack } from '../components/CanvasNavigationStack'
import NodeContextMenu, { type NodeContextMenuAction } from '../components/NodeContextMenu'
import FrameContextMenu, { type FrameContextMenuAction } from '../components/FrameContextMenu'
import type { CanvasFrameMenuState } from '../components/useCanvasFrameActions'
import { NodeAddMenu } from '../components/CanvasToolbar'
import { NodeDeriveMenu } from '../quickActions/NodeDeriveMenu'
import { SelectionPromptSaveController } from '../components/SelectionPromptSaveController'
import { CanvasArrivalHint } from '../components/CanvasArrivalHint'
import type { ArrivalHint } from '../components/canvasArrivalModel'
import { hasClipboardContent } from '../store/canvasClipboard'
import type { CanvasContextNodeMenu } from '../components/useCanvasContextNodeMenu'
import type { CanvasAssetInputPicker, CanvasConnectionCreateMenu } from './useGenerationCanvasReactFlowMenus'
import { CanvasPickModeLayer } from '../components/CanvasPickModeLayer'
import AssetPicker from '../../assets/AssetPicker'
import AssetPickerPopover from '../../assets/AssetPickerPopover'
import { useOpenProjectId } from '../../project/useOpenProjectId'
import { addAssetInput, addUploadedInput } from '../quickActions/nodeInputActions'
import type { GenerationCanvasNode, GenerationNodeKind } from '../model/generationCanvasTypes'

const BatchPlanOverlay = lazyWithChunkBoundary('批量生成面板', () =>
  import('../components/BatchPlanOverlay').then((module) => ({ default: module.BatchPlanOverlay })),
)

type GenerationCanvasReactFlowOverlaysProps = {
  readOnly: boolean
  activeCategoryId: string
  nodes: GenerationCanvasNode[]
  allNodes: GenerationCanvasNode[]
  selectedNodeIds: readonly string[]
  selectedSet: Set<string>
  screenshotOverlay: React.ReactNode
  contextNodeMenu: CanvasContextNodeMenu | null
  connectionCreateMenu: Pick<CanvasConnectionCreateMenu, 'verdicts' | 'clientX' | 'clientY' | 'sourceSide' | 'sourceNodeId' | 'sourceKind'> | null
  onCloseConnectionCreateMenu: () => void
  /** 左「+」菜单底下两项：从素材库添加… / 在画布上点选。 */
  onAddInputFromAssets: () => void
  onAddInputPickOnCanvas: () => void
  assetInputPicker: CanvasAssetInputPicker | null
  onCloseAssetInputPicker: () => void
  /** 空画布任务卡建节点的期望落点（同左缘工具条）。 */
  getInsertionPosition: () => { x: number; y: number }
  onNodeContextAction: (action: NodeContextMenuAction) => void
  /** 节点菜单自己关（Esc / 点外面 / 选完）。空白「添加节点」菜单仍走原来的 window 监听。 */
  onCloseContextNodeMenu: () => void
  onAddContextNode: (kind: GenerationNodeKind) => void
  onImportContextFiles: (files: File[]) => void
  onAddConnectedNode: (kind: GenerationNodeKind) => void
  hasBatchPlanPreview: boolean
  zoom: number
  zoomPercent: number
  offset: { x: number; y: number }
  stageSize: { width: number; height: number }
  minimapVisible: boolean
  onToggleMinimap: () => void
  onJumpToCanvasPoint: (point: { x: number; y: number }) => void
  onFitView: () => void
  onResetView: () => void
  onTidy: () => void
  onZoomTo: (nextZoom: number) => void
  frameMenu: CanvasFrameMenuState | null
  onFrameMenuAction: (action: FrameContextMenuAction) => void
  frameToolArmed: boolean
  onToggleFrameTool: () => void
  /** 新东西落在屏外 / 别的分类时的边缘提示；null = 没有要指的。 */
  arrivalHint: ArrivalHint | null
  onGoToArrivals: () => void
}

export function GenerationCanvasReactFlowOverlays({
  readOnly,
  activeCategoryId,
  nodes,
  allNodes,
  selectedNodeIds,
  selectedSet,
  screenshotOverlay,
  contextNodeMenu,
  connectionCreateMenu,
  onAddInputFromAssets,
  onAddInputPickOnCanvas,
  assetInputPicker,
  onCloseAssetInputPicker,
  getInsertionPosition,
  onNodeContextAction,
  onCloseContextNodeMenu,
  onAddContextNode,
  onImportContextFiles,
  onAddConnectedNode,
  onCloseConnectionCreateMenu,
  hasBatchPlanPreview,
  zoom,
  zoomPercent,
  offset,
  stageSize,
  minimapVisible,
  onToggleMinimap,
  onJumpToCanvasPoint,
  onFitView,
  onResetView,
  onTidy,
  onZoomTo,
  frameMenu,
  onFrameMenuAction,
  frameToolArmed,
  onToggleFrameTool,
  arrivalHint,
  onGoToArrivals,
}: GenerationCanvasReactFlowOverlaysProps): JSX.Element {
  const openProjectId = useOpenProjectId()
  // 「从素材库添加…」选择器上传期间保持打开（显示上传中）；完成时它还开着才接线。
  const [uploadingInput, setUploadingInput] = React.useState(false)
  const latestPickerRef = React.useRef(assetInputPicker)
  latestPickerRef.current = assetInputPicker
  // 左「+」菜单要说「剪辑节点不收文字」，得知道本卡是哪一类。
  const menuTarget = connectionCreateMenu?.sourceSide === 'left' && connectionCreateMenu.sourceKind === 'node'
    ? allNodes.find((node) => node.id === connectionCreateMenu.sourceNodeId)
    : undefined
  return (
    <>
      {screenshotOverlay}
      {nodes.length === 0 ? <CanvasEmptyState activeCategoryId={activeCategoryId} getInsertionPosition={getInsertionPosition} /> : null}
      <CanvasPickModeLayer />
      {contextNodeMenu && contextNodeMenu.target !== 'blank' ? (
        // 刀 1：这一个菜单走 `WorkbenchMenu`（Portal 到 body + 视口坐标），
        // 所以不再传 stage 相对的 style，层级也交给原语的 popover 档（不再写 z-[20]）。
        // 两个识别类留着——走查按它们找菜单（canvas-node-context-menu.walk.mjs 等三处）。
        <NodeContextMenu
          className="generation-canvas-react-flow__node-context-menu generation-canvas-v2__node-context-menu"
          point={{ x: contextNodeMenu.clientX, y: contextNodeMenu.clientY }}
          canPaste={hasClipboardContent()}
          canGroup={selectedNodeIds.length >= 2}
          onPointerDown={(event) => event.stopPropagation()}
          onClose={onCloseContextNodeMenu}
          onAction={onNodeContextAction}
          onDuplicateVariant={selectedNodeIds.length === 1 ? () => onNodeContextAction('duplicate-variant') : undefined}
        />
      ) : contextNodeMenu ? (
        <NodeAddMenu
          className="generation-canvas-react-flow__context-node-menu generation-canvas-v2__context-node-menu z-[20]"
          style={{ left: contextNodeMenu.stageX, top: contextNodeMenu.stageY }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
          onAddNode={onAddContextNode}
          onImportFiles={onImportContextFiles}
        />
      ) : null}
      {frameMenu ? (
        <FrameContextMenu
          className="generation-canvas-react-flow__frame-menu generation-canvas-v2__frame-menu z-[20]"
          style={{ left: frameMenu.stageX, top: frameMenu.stageY }}
          frameName={frameMenu.frameName}
          canGenerate={frameMenu.canGenerate}
          canSendToTimeline={frameMenu.canSendToTimeline}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
          onAction={onFrameMenuAction}
        />
      ) : null}
      {connectionCreateMenu ? (
        // 点「+」圈和拖线到空白处松手是同一个菜单：右「用这个节点生成」、左「给它加输入」，接不上的灰掉并说原因（`quickActions/NodeDeriveMenu`）。
        <NodeDeriveMenu
          side={menuTarget ? 'left' : 'right'}
          target={menuTarget}
          verdicts={connectionCreateMenu.verdicts}
          point={{ x: connectionCreateMenu.clientX, y: connectionCreateMenu.clientY }}
          onPick={onAddConnectedNode}
          onFromAssets={onAddInputFromAssets}
          onPickOnCanvas={onAddInputPickOnCanvas}
          onClose={onCloseConnectionCreateMenu}
        />
      ) : null}
      {assetInputPicker ? (
        // 「从素材库添加…」：同一个素材选择器（AssetPicker），只列这张卡收得下的种类；选中 / 上传后建素材卡并接进来。
        <div className="fixed z-[60]" style={{ left: assetInputPicker.clientX, top: assetInputPicker.clientY }}>
          <AssetPickerPopover onClose={onCloseAssetInputPicker}>
            <AssetPicker
              projectId={openProjectId}
              accept={assetInputPicker.accept}
              onPick={(asset) => { addAssetInput(assetInputPicker.targetNodeId, asset); onCloseAssetInputPicker() }}
              uploading={uploadingInput}
              onUpload={(file) => {
                // 选择器开到上传完成：完成时它还开着就接线，途中被用户关掉就只留素材卡（nodeInputActions.addUploadedInput）。
                const session = assetInputPicker
                setUploadingInput(true)
                void addUploadedInput(session.targetNodeId, file, { shouldConnect: () => latestPickerRef.current === session })
                  .finally(() => { setUploadingInput(false); if (latestPickerRef.current === session) onCloseAssetInputPicker() })
              }}
            />
          </AssetPickerPopover>
        </div>
      ) : null}
      <CanvasNavigationStack
        readOnly={readOnly}
        nodes={nodes}
        selectedIds={selectedSet}
        zoom={zoom}
        zoomPercent={zoomPercent}
        offset={offset}
        stageSize={stageSize}
        minimapVisible={minimapVisible}
        onToggleMinimap={onToggleMinimap}
        onJumpToCanvasPoint={onJumpToCanvasPoint}
        onFitView={onFitView}
        onResetView={onResetView}
        onTidy={onTidy}
        onZoomTo={onZoomTo}
        frameToolArmed={frameToolArmed}
        onToggleFrameTool={onToggleFrameTool}
        batchPlanOverlay={
          hasBatchPlanPreview ? (
            <React.Suspense fallback={null}>
              <BatchPlanOverlay />
            </React.Suspense>
          ) : null
        }
      />
      {arrivalHint ? <CanvasArrivalHint hint={arrivalHint} onGo={onGoToArrivals} /> : null}
      <SelectionPromptSaveController nodes={allNodes} disabled={readOnly} />
    </>
  )
}
