import React from 'react'
import { IconDownload, IconPhoto, IconPlugConnected } from '@tabler/icons-react'
import type { WorkspaceMode } from '../workbenchStore'
import { importImageFilesToGenerationCanvas } from '../generationCanvasV2/adapters/assetImportAdapter'
import { NomiBrand, NomiStepper, WorkbenchButton } from '../../design'

type NomiAppBarProps = {
  workspaceMode: WorkspaceMode
  onWorkspaceModeChange: (mode: WorkspaceMode) => void
  onBackToLibrary?: () => void
  onOpenModelCatalog?: () => void
}

export default function NomiAppBar({ workspaceMode, onWorkspaceModeChange, onBackToLibrary, onOpenModelCatalog }: NomiAppBarProps): JSX.Element {
  const assetInputRef = React.useRef<HTMLInputElement>(null)
  const [editingProjectName, setEditingProjectName] = React.useState(false)
  const [projectTitle, setProjectTitle] = React.useState('未命名 Nomi 项目')

  const commitProjectTitle = React.useCallback(() => {
    setProjectTitle((value) => value.trim() || '未命名 Nomi 项目')
    setEditingProjectName(false)
  }, [])

  const handleAssetFilesSelected = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files || []).filter((file) => file.type.startsWith('image/'))
    event.currentTarget.value = ''
    if (!files.length) return
    onWorkspaceModeChange('generation')
    void importImageFilesToGenerationCanvas(files, {
      basePosition: { x: 120, y: 90 },
    })
  }, [onWorkspaceModeChange])

  const handleOpenModelCatalog = React.useCallback(() => {
    onOpenModelCatalog?.()
  }, [onOpenModelCatalog])

  return (
    <header className="nomi-appbar" aria-label="Nomi 工作台">
      <div className="nomi-appbar__left">
        <NomiBrand />
        <span className="nomi-appbar__divider" aria-hidden="true" />

        {/* Breadcrumb: [项目库] › [项目名] — unified bordered container */}
        <div className="nomi-appbar__breadcrumb" role="navigation" aria-label="位置导航">
          {onBackToLibrary ? (
            <>
              <WorkbenchButton
                className="nomi-appbar__breadcrumb-seg nomi-appbar__breadcrumb-seg--lib"
                aria-label="返回项目库"
                onClick={onBackToLibrary}
              >
                项目库
              </WorkbenchButton>
              <span className="nomi-appbar__breadcrumb-arrow" aria-hidden="true">›</span>
            </>
          ) : null}
          {editingProjectName ? (
            <input
              className="nomi-appbar__breadcrumb-input"
              value={projectTitle}
              autoFocus
              aria-label="项目名称"
              onBlur={commitProjectTitle}
              onChange={(event) => setProjectTitle(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitProjectTitle()
                if (event.key === 'Escape') setEditingProjectName(false)
              }}
            />
          ) : (
            <WorkbenchButton
              className="nomi-appbar__breadcrumb-seg nomi-appbar__breadcrumb-seg--name"
              title={projectTitle}
              onClick={() => setEditingProjectName(true)}
            >
              {projectTitle}
            </WorkbenchButton>
          )}
        </div>
      </div>

      <NomiStepper value={workspaceMode} onChange={onWorkspaceModeChange} />

      <div className="nomi-appbar__right" role="toolbar" aria-label="全局操作">
        <input
          ref={assetInputRef}
          className="nomi-appbar__asset-input"
          type="file"
          accept="image/*"
          multiple
          aria-label="图片素材文件选择器"
          onChange={handleAssetFilesSelected}
        />
        <WorkbenchButton className="nomi-appbar__ghost" aria-label="打开图片素材导入" onClick={() => assetInputRef.current?.click()}>
          <IconPhoto size={15} stroke={1.7} />
          <span className="nomi-appbar__action-text">素材库</span>
        </WorkbenchButton>
        <WorkbenchButton className="nomi-appbar__ghost" aria-label="打开模型接入" onClick={handleOpenModelCatalog}>
          <IconPlugConnected size={15} stroke={1.7} />
          <span className="nomi-appbar__action-text">模型接入</span>
        </WorkbenchButton>
        <WorkbenchButton className="nomi-appbar__primary" aria-label="前往预览导出" onClick={() => onWorkspaceModeChange('preview')}>
          <IconDownload size={15} stroke={1.7} />
          <span className="nomi-appbar__action-text">导出</span>
        </WorkbenchButton>
      </div>
    </header>
  )
}
