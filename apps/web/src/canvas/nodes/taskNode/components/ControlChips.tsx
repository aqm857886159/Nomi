import React from 'react'
import { Menu } from '@mantine/core'
import { IconBrain, IconDeviceFloppy } from '@tabler/icons-react'
import { DesignButton, IconActionButton } from '../../../../design'

const DEFAULT_IMAGE_ASPECT_RATIO_OPTIONS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'].map((value) => ({
  value,
  label: value,
  disabled: false,
}))

const DEFAULT_IMAGE_SIZE_OPTIONS = ['1K', '2K', '4K'].map((value) => ({
  value,
  label: value,
  disabled: false,
}))

type ControlChipsProps = {
  summaryChipStyles: React.CSSProperties
  controlValueStyle: React.CSSProperties
  summaryModelLabel: string
  summaryDuration: string
  summaryQuality?: string
  summaryResolution: string
  summaryExec: string
  showModelMenu: boolean
  modelList: { value: string; label: string; vendor?: string | null }[]
  onModelChange: (value: string) => void
  showTimeMenu: boolean
  durationOptions: ReadonlyArray<{ value: string; label: string }>
  onDurationChange: (value: number) => void
  showQualityMenu?: boolean
  qualityOptions?: { value: string; label: string }[]
  onQualityChange?: (value: string) => void
  showResolutionMenu: boolean
  resolutionTitle?: string
  resolutionOptions?: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>
  onResolutionChange: (value: string) => void
  showImageSizeMenu: boolean
  imageSize: string
  imageSizeOptions?: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>
  onImageSizeChange: (value: string) => void
  showOrientationMenu: boolean
  orientation: 'portrait' | 'landscape'
  onOrientationChange: (value: 'portrait' | 'landscape') => void
  orientationOptions?: ReadonlyArray<{ value: 'portrait' | 'landscape'; label: string }>
  showSampleMenu: boolean
  sampleOptions: ReadonlyArray<number>
  sampleCount: number
  onSampleChange: (value: number) => void
  mappedControls?: ReadonlyArray<{
    key: string
    title: string
    summary: string
    options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>
    onChange: (value: string) => void
  }>
  isCharacterNode: boolean
  isRunning: boolean
  smartAction?: {
    title: string
    onClick: () => void
    loading?: boolean
    disabled?: boolean
  } | null
  requiredCreditsLabel?: string | null
  onSave: () => void
}

export function ControlChips({
  summaryChipStyles,
  controlValueStyle,
  summaryModelLabel,
  summaryDuration,
  summaryQuality,
  summaryResolution,
  summaryExec,
  showModelMenu,
  modelList,
  onModelChange,
  showTimeMenu,
  durationOptions,
  onDurationChange,
  showQualityMenu,
  qualityOptions,
  onQualityChange,
  showResolutionMenu,
  resolutionTitle = '分辨率',
  resolutionOptions,
  onResolutionChange,
  showImageSizeMenu,
  imageSize,
  imageSizeOptions,
  onImageSizeChange,
  showOrientationMenu,
  orientation,
  onOrientationChange,
  orientationOptions,
  showSampleMenu,
  sampleOptions,
  sampleCount,
  onSampleChange,
  mappedControls = [],
  isCharacterNode,
  isRunning,
  smartAction = null,
  requiredCreditsLabel = null,
  onSave,
}: ControlChipsProps) {
  const resolvedResolutionOptions = resolutionOptions || DEFAULT_IMAGE_ASPECT_RATIO_OPTIONS
  const resolvedImageSizeOptions = imageSizeOptions || DEFAULT_IMAGE_SIZE_OPTIONS

  return (
    <div className="control-chips" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', minWidth: 0, overflow: 'hidden' }}>
      {showModelMenu && (
        <Menu className="control-chips-menu control-chips-menu--model" withinPortal position="bottom-start" transition="pop-top-left">
          <Menu.Target className="control-chips-menu-target">
            <DesignButton
              className="control-chips-button"
              type="button"
              variant="transparent"
              radius={0}
              size="compact-sm"
              style={{
                ...summaryChipStyles,
                minWidth: 0,
                maxWidth: 220,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={`模型 · ${summaryModelLabel}`}
            >
              <span
                className="control-chips-value"
                style={{ ...controlValueStyle, display: 'block', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {summaryModelLabel}
              </span>
            </DesignButton>
          </Menu.Target>
          <Menu.Dropdown className="control-chips-menu-dropdown">
            {modelList.map((option) => (
              <Menu.Item className="control-chips-menu-item" key={option.value} onClick={() => onModelChange(option.value)}>
                {option.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
      {mappedControls.map((control) => (
        <Menu
          className="control-chips-menu"
          key={control.key}
          withinPortal
          position="bottom-start"
          transition="pop-top-left"
        >
          <Menu.Target className="control-chips-menu-target">
            <DesignButton
              className="control-chips-button"
              type="button"
              variant="transparent"
              radius={0}
              size="compact-sm"
              style={{
                ...summaryChipStyles,
                minWidth: 0,
              }}
              title={control.title}
            >
              <span className="control-chips-value" style={controlValueStyle}>
                {control.summary}
              </span>
            </DesignButton>
          </Menu.Target>
          <Menu.Dropdown className="control-chips-menu-dropdown">
            {control.options.map((option) => (
              <Menu.Item
                className="control-chips-menu-item"
                key={option.value}
                disabled={option.disabled}
                onClick={() => control.onChange(option.value)}
              >
                {option.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      ))}
      {showTimeMenu && (
        <Menu className="control-chips-menu" withinPortal position="bottom-start" transition="pop-top-left">
          <Menu.Target className="control-chips-menu-target">
            <DesignButton
              className="control-chips-button"
              type="button"
              variant="transparent"
              radius={0}
              size="compact-sm"
              style={{
                ...summaryChipStyles,
                minWidth: 0,
              }}
              title="时长"
            >
              <span className="control-chips-value" style={controlValueStyle}>{summaryDuration}</span>
            </DesignButton>
          </Menu.Target>
          <Menu.Dropdown className="control-chips-menu-dropdown">
            {durationOptions.map((option) => (
              <Menu.Item className="control-chips-menu-item" key={option.value} onClick={() => onDurationChange(Number(option.value))}>
                {option.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
      {showQualityMenu && summaryQuality && (
        <Menu className="control-chips-menu" withinPortal position="bottom-start" transition="pop-top-left">
          <Menu.Target className="control-chips-menu-target">
            <DesignButton
              className="control-chips-button"
              type="button"
              variant="transparent"
              radius={0}
              size="compact-sm"
              style={{
                ...summaryChipStyles,
                minWidth: 0,
              }}
              title="质量"
            >
              <span className="control-chips-value" style={controlValueStyle}>{summaryQuality}</span>
            </DesignButton>
          </Menu.Target>
          <Menu.Dropdown className="control-chips-menu-dropdown">
            {(qualityOptions || []).map((option) => (
              <Menu.Item className="control-chips-menu-item" key={option.value} onClick={() => onQualityChange?.(option.value)}>
                {option.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
      {showResolutionMenu && (
        <Menu className="control-chips-menu" withinPortal position="bottom-start" transition="pop-top-left">
          <Menu.Target className="control-chips-menu-target">
            <DesignButton
              className="control-chips-button"
              type="button"
              variant="transparent"
              radius={0}
              size="compact-sm"
              style={summaryChipStyles}
              title={resolutionTitle}
            >
              <span className="control-chips-value" style={controlValueStyle}>{summaryResolution}</span>
            </DesignButton>
          </Menu.Target>
          <Menu.Dropdown className="control-chips-menu-dropdown">
            {resolvedResolutionOptions.map((option) => (
              <Menu.Item className="control-chips-menu-item" key={option.value} disabled={option.disabled} onClick={() => onResolutionChange(option.value)}>
                {option.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
      {showImageSizeMenu && (
        <Menu className="control-chips-menu" withinPortal position="bottom-start" transition="pop-top-left">
          <Menu.Target className="control-chips-menu-target">
            <DesignButton
              className="control-chips-button"
              type="button"
              variant="transparent"
              radius={0}
              size="compact-sm"
              style={summaryChipStyles}
              title="图像尺寸"
            >
              <span className="control-chips-value" style={controlValueStyle}>{imageSize}</span>
            </DesignButton>
          </Menu.Target>
          <Menu.Dropdown className="control-chips-menu-dropdown">
            {resolvedImageSizeOptions.map((option) => (
              <Menu.Item className="control-chips-menu-item" key={option.value} disabled={option.disabled} onClick={() => onImageSizeChange(option.value)}>
                {option.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
      {showOrientationMenu && (
        <Menu className="control-chips-menu" withinPortal position="bottom-start" transition="pop-top-left">
          <Menu.Target className="control-chips-menu-target">
            <DesignButton
              className="control-chips-button"
              type="button"
              variant="transparent"
              radius={0}
              size="compact-sm"
              style={{
                ...summaryChipStyles,
                minWidth: 0,
              }}
              title="方向"
            >
              <span className="control-chips-value" style={controlValueStyle}>{orientation === 'portrait' ? '竖屏' : '横屏'}</span>
            </DesignButton>
          </Menu.Target>
          <Menu.Dropdown className="control-chips-menu-dropdown">
            {(orientationOptions || [
              { value: 'landscape', label: '横屏' },
              { value: 'portrait', label: '竖屏' },
            ]).map((option) => (
              <Menu.Item className="control-chips-menu-item" key={option.value} onClick={() => onOrientationChange(option.value as 'portrait' | 'landscape')}>
                {option.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
      {showSampleMenu && (
        <Menu className="control-chips-menu" withinPortal position="bottom-start" transition="pop-top-left">
          <Menu.Target className="control-chips-menu-target">
            <DesignButton
              className="control-chips-button"
              type="button"
              variant="transparent"
              radius={0}
              size="compact-sm"
              style={{
                ...summaryChipStyles,
                minWidth: 0,
              }}
              title="生成次数"
            >
              <span className="control-chips-value" style={controlValueStyle}>{summaryExec}</span>
            </DesignButton>
          </Menu.Target>
          <Menu.Dropdown className="control-chips-menu-dropdown">
            {sampleOptions.map((value) => (
              <Menu.Item className="control-chips-menu-item" key={value} onClick={() => onSampleChange(value)}>
                {value}x
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
      {!isCharacterNode && (
        <>
          {smartAction && (
            <IconActionButton
              className="control-chips-smart"
              size="md"
              title={smartAction.title}
              disabled={isRunning || !!smartAction.disabled}
              loading={!!smartAction.loading}
              onClick={smartAction.onClick}
              radius="md"
              style={{
                width: 20,
                height: 20,
                background: 'rgba(59, 130, 246, 0.12)',
                color: '#3b82f6',
              }}
              icon={<IconBrain className="control-chips-smart-icon" size={16} />}
            />
          )}
          {requiredCreditsLabel && (
            <span
              className="control-chips-required-credits"
              title={`当前生成将消耗 ${requiredCreditsLabel}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                height: 20,
                padding: '0 6px',
                borderRadius: 999,
                background: 'rgba(245, 158, 11, 0.12)',
                color: '#d97706',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.2,
                whiteSpace: 'nowrap',
              }}
            >
              {requiredCreditsLabel}
            </span>
          )}
          <IconActionButton
            className="control-chips-save"
            size="md"
            title="保存节点配置"
            disabled={isRunning}
            onClick={onSave}
            radius="md"
            style={{
              width: 20,
              height: 20,
              background: 'linear-gradient(135deg, #4c6ef5, #60a5fa)',
              boxShadow: '0 18px 30px rgba(76, 110, 245, 0.35)',
            }}
            icon={<IconDeviceFloppy className="control-chips-save-icon" size={18} />}
          />
        </>
      )}
    </div>
  )
}
