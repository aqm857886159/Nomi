import React from 'react'
import { Tooltip, type ActionIconProps } from '@mantine/core'
import { NodeToolbar, Position } from '@xyflow/react'
import { IconDownload, IconMaximize } from '@tabler/icons-react'
import { IconActionButton } from '../../../../design'

type ToolbarAction = { key: string; label: string; icon: JSX.Element; onClick: () => void; active?: boolean }

type TopToolbarProps = {
  isVisible: boolean
  hasContent: boolean
  toolbarBackground: string
  toolbarShadow: string
  toolbarActionIconStyles: ActionIconProps['styles']
  inlineDividerColor: string
  visibleDefs: ToolbarAction[]
  extraActions?: ToolbarAction[]
  onPreview: () => void
  onDownload: () => void
}

export function TopToolbar({
  isVisible,
  hasContent,
  toolbarBackground,
  toolbarShadow,
  toolbarActionIconStyles,
  inlineDividerColor,
  visibleDefs,
  extraActions = [],
  onPreview,
  onDownload,
}: TopToolbarProps) {
  if (!isVisible || !hasContent) return null
  const allActions = [...extraActions, ...visibleDefs]
  return (
    <NodeToolbar className="top-toolbar" position={Position.Top} align="center">
      <div className="top-toolbar-anchor" style={{ position: 'relative', display: 'inline-block' }}>
        <div
          className="top-toolbar-content"
          style={{
            position: 'relative',
            zIndex: 3001,
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: 8,
            padding: '6px 12px',
            borderRadius: 999,
            background: toolbarBackground,
            boxShadow: toolbarShadow,
            backdropFilter: 'blur(18px)',
            maxWidth: 'min(92vw, 980px)',
          }}
        >
          <Tooltip className="top-toolbar-tooltip" label="放大预览" position="bottom" withArrow>
            <IconActionButton
              className="top-toolbar-action"
              variant="transparent"
              radius={0}
              size="sm"
              aria-label="放大预览"
              styles={toolbarActionIconStyles}
              onClick={onPreview}
              icon={<IconMaximize className="top-toolbar-action-icon" size={16} />}
            />
          </Tooltip>
          <Tooltip className="top-toolbar-tooltip" label="下载" position="bottom" withArrow>
            <IconActionButton
              className="top-toolbar-action"
              variant="transparent"
              radius={0}
              size="sm"
              aria-label="下载节点结果"
              styles={toolbarActionIconStyles}
              onClick={onDownload}
              icon={<IconDownload className="top-toolbar-action-icon" size={16} />}
            />
          </Tooltip>
          {allActions.length > 0 && (
            <div className="top-toolbar-divider" style={{ width: 1, height: 24, background: inlineDividerColor }} />
          )}
          {allActions.map((d) => (
            <Tooltip className="top-toolbar-tooltip" key={d.key} label={d.label} position="bottom" withArrow>
              <IconActionButton
              className="top-toolbar-action"
              variant="transparent"
              radius={0}
              size="sm"
              aria-label={d.label}
              styles={toolbarActionIconStyles}
              onClick={d.onClick}
              style={d.active ? { background: 'rgba(59,130,246,0.16)', borderRadius: 10 } : undefined}
              icon={d.icon}
            />
            </Tooltip>
          ))}
        </div>
      </div>
    </NodeToolbar>
  )
}
