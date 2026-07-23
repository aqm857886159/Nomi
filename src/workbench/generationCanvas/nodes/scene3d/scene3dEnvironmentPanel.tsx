import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconPhoto, IconTrash, IconUpload } from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import { toast } from '../../../../ui/toast'
import { Switch } from '../../../../ui/switch'
import { hostedAssetUrl, importWorkbenchLocalAssetFile } from '../../../api/assetUploadApi'
import {
  degreesToRadians,
  radiansToDegrees,
  SCENE3D_DARK_BACKGROUND,
  SCENE3D_LIGHT_BACKGROUND,
  SPHERE_RADIUS_MAX,
  SPHERE_RADIUS_MIN,
} from './scene3dConstants'
import type { Scene3DState } from './scene3dTypes'
import {
  isStandardPanoramaDimensions,
  PANORAMA_IMPORT_MAX_BYTES,
  type ImageDimensions,
} from './panoramaImport'

function readImageFileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      if (result) resolve(result)
      else reject(new Error('failed to read panorama image'))
    }
    reader.onerror = () => reject(new Error('failed to read panorama image'))
    reader.readAsDataURL(file)
  })
}

function readImageDimensions(src: string): Promise<ImageDimensions> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve({ width: image.naturalWidth, height: image.naturalHeight })
      } else {
        reject(new Error('invalid panorama image dimensions'))
      }
    }
    image.onerror = () => reject(new Error('failed to inspect panorama image'))
    image.src = src
  })
}

function EnvironmentColorField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const color = /^#[0-9a-f]{6}$/i.test(value) ? value : '#808080'
  const displayValue = color.toUpperCase()

  return (
    <div className="grid gap-1">
      <span className="text-micro text-[var(--nomi-ink-60)]">{label}</span>
      <div className="grid grid-cols-[32px_minmax(0,1fr)] items-center gap-2">
        <label
          className={cn(
            'relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-nomi-sm border border-[var(--nomi-line)]',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-[var(--nomi-accent)]',
          )}
          title={disabled ? undefined : t('scene3d.inspector.selectColor')}
        >
          <span className="absolute inset-0" style={{ backgroundColor: color }} />
          <input
            className="absolute inset-0 size-full cursor-inherit opacity-0"
            disabled={disabled}
            type="color"
            value={color}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
        </label>
        <input
          aria-label={t('scene3d.inspector.colorValueAria', { label })}
          className="h-8 min-w-0 rounded-nomi-sm border border-[var(--nomi-line)] bg-[var(--nomi-ink-05)] px-2 font-mono text-caption font-medium uppercase text-[var(--nomi-ink)] outline-none disabled:opacity-50"
          disabled={disabled}
          readOnly
          value={displayValue}
        />
      </div>
    </div>
  )
}

export function Scene3DEnvironmentPanel({
  environment,
  readOnly,
  onEnvironmentPatch,
}: {
  environment: Scene3DState['environment']
  readOnly: boolean
  onEnvironmentPatch: (patch: Partial<Scene3DState['environment']>) => void
}): JSX.Element {
  const { t } = useTranslation()
  const panoramaInputRef = React.useRef<HTMLInputElement | null>(null)
  const panoramaImportRunRef = React.useRef(0)
  // 从预览 img 的 naturalWidth/Height 派生（不进持久化状态），给非 2:1 图挂常驻「可能拉伸」提示。
  const [previewDimensions, setPreviewDimensions] = React.useState<ImageDimensions | null>(null)

  React.useEffect(() => {
    setPreviewDimensions(null)
  }, [environment.panoramaUrl])

  const handlePanoramaFile = React.useCallback((file: File) => {
    if (readOnly) return
    if (!file.type.startsWith('image/')) {
      toast(t('scene3d.environment.imageOnly'), 'warning')
      return
    }
    if (file.size > PANORAMA_IMPORT_MAX_BYTES) {
      toast(t('scene3d.environment.fileTooLarge'), 'warning')
      return
    }

    const previewUrl = URL.createObjectURL(file)
    const importRunId = panoramaImportRunRef.current + 1
    panoramaImportRunRef.current = importRunId

    void (async () => {
      try {
        let dimensions: ImageDimensions
        try {
          dimensions = await readImageDimensions(previewUrl)
        } catch {
          toast(t('scene3d.environment.dimensionsUnreadable'), 'warning')
          return
        }
        if (panoramaImportRunRef.current !== importRunId) return
        // 非 2:1 不拒收（equirect 对任意比例渲染安全），降级为「可能拉伸」警告照常导入。
        const standardRatio = isStandardPanoramaDimensions(dimensions)
        if (!standardRatio) {
          toast(t('scene3d.environment.nonStandardImported', { width: dimensions.width, height: dimensions.height }), 'warning')
        }

        onEnvironmentPatch({
          panoramaUrl: previewUrl,
          panoramaFileName: file.name || t('scene3d.environment.defaultName'),
          showSky: false,
          environmentMode: 'panorama',
        })

        const asset = await importWorkbenchLocalAssetFile(file, file.name || 'panorama')
        const hostedUrl = hostedAssetUrl(asset)
        if (!hostedUrl) throw new Error('panorama asset missing url')
        if (panoramaImportRunRef.current !== importRunId) return
        onEnvironmentPatch({
          panoramaUrl: hostedUrl,
          panoramaFileName: file.name || t('scene3d.environment.defaultName'),
        })
        if (standardRatio) toast(t('scene3d.environment.imported'), 'success')
      } catch {
        try {
          const dataUrl = await readImageFileDataUrl(file)
          if (panoramaImportRunRef.current !== importRunId) return
          onEnvironmentPatch({
            panoramaUrl: dataUrl,
            panoramaFileName: file.name || t('scene3d.environment.defaultName'),
          })
          toast(t('scene3d.environment.importedTemporary'), 'info')
        } catch {
          if (panoramaImportRunRef.current === importRunId) {
            onEnvironmentPatch({ panoramaUrl: undefined, panoramaFileName: undefined })
          }
          toast(t('scene3d.environment.importFailed'), 'error')
        }
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(previewUrl), 30_000)
      }
    })()
  }, [onEnvironmentPatch, readOnly, t])

  const handlePanoramaInputChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file) handlePanoramaFile(file)
  }, [handlePanoramaFile])

  const clearPanorama = React.useCallback(() => {
    if (readOnly) return
    panoramaImportRunRef.current += 1
    onEnvironmentPatch({
      panoramaUrl: undefined,
      panoramaFileName: undefined,
      panoramaRotation: 0,
    })
  }, [onEnvironmentPatch, readOnly])

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2 text-caption text-[var(--nomi-ink-60)]">
        <label htmlFor="scene3d-dark-mode">{t('scene3d.environment.darkScene')}</label>
        <Switch
          id="scene3d-dark-mode"
          checked={environment.darkMode}
          disabled={readOnly}
          onCheckedChange={(darkMode) => onEnvironmentPatch({
            darkMode,
            backgroundColor: darkMode ? SCENE3D_DARK_BACKGROUND : SCENE3D_LIGHT_BACKGROUND,
          })}
        />
      </div>
      <div className="flex items-center justify-between gap-2 text-caption text-[var(--nomi-ink-60)]">
        <label htmlFor="scene3d-show-grid">{t('scene3d.environment.gridGround')}</label>
        <Switch
          id="scene3d-show-grid"
          checked={environment.showGrid}
          disabled={readOnly}
          onCheckedChange={(checked) => onEnvironmentPatch({ showGrid: checked })}
        />
      </div>
      <div className="flex items-center justify-between gap-2 text-caption text-[var(--nomi-ink-60)]">
        <label htmlFor="scene3d-show-axes">{t('scene3d.environment.axes')}</label>
        <Switch
          id="scene3d-show-axes"
          checked={environment.showAxes}
          disabled={readOnly}
          onCheckedChange={(checked) => onEnvironmentPatch({ showAxes: checked })}
        />
      </div>
      <div className="flex items-center justify-between gap-2 text-caption text-[var(--nomi-ink-60)]">
        <label htmlFor="scene3d-show-sky">{t('scene3d.environment.skyBackground')}</label>
        <Switch
          id="scene3d-show-sky"
          checked={environment.showSky}
          disabled={readOnly}
          onCheckedChange={(checked) => onEnvironmentPatch({ showSky: checked })}
        />
      </div>
      <EnvironmentColorField
        label={t('scene3d.environment.backgroundColor')}
        value={environment.backgroundColor}
        disabled={readOnly}
        onChange={(backgroundColor) => onEnvironmentPatch({ backgroundColor })}
      />
      <div className="grid gap-2 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-caption font-medium text-[var(--nomi-ink)]">
            <IconPhoto size={14} className="shrink-0 text-[var(--nomi-ink-60)]" />
            <span className="truncate">{t('scene3d.environment.panorama')}</span>
          </span>
          {environment.panoramaUrl ? (
            <button
              className="grid size-7 place-items-center rounded-nomi-sm text-[var(--nomi-ink-40)] hover:bg-[var(--workbench-danger-soft)] hover:text-[var(--workbench-danger)] disabled:opacity-40"
              disabled={readOnly}
              type="button"
              title={t('scene3d.environment.removePanorama')}
              onClick={clearPanorama}
            >
              <IconTrash size={14} />
            </button>
          ) : null}
        </div>
        {environment.panoramaUrl ? (
          <div className="grid gap-2">
            <div className="aspect-[2/1] overflow-hidden rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-10)]">
              <img
                className="size-full object-cover"
                src={environment.panoramaUrl}
                alt=""
                draggable={false}
                onLoad={(event) => {
                  const { naturalWidth, naturalHeight } = event.currentTarget
                  if (naturalWidth > 0 && naturalHeight > 0) {
                    setPreviewDimensions({ width: naturalWidth, height: naturalHeight })
                  }
                }}
              />
            </div>
            <div className="min-w-0 truncate text-micro text-[var(--nomi-ink-60)]">
              {environment.panoramaFileName || t('scene3d.environment.defaultName')}
            </div>
            {previewDimensions && !isStandardPanoramaDimensions(previewDimensions) ? (
              <div className="text-micro text-[var(--nomi-ink-60)]">
                {t('scene3d.environment.nonStandardHint', {
                  width: previewDimensions.width,
                  height: previewDimensions.height,
                })}
              </div>
            ) : null}
            <label className="grid gap-1">
              <span className="text-micro text-[var(--nomi-ink-60)]">{t('scene3d.environment.horizontalRotation')}</span>
              <div className="grid grid-cols-[1fr_48px] items-center gap-2">
                <input
                  className="h-1.5 w-full accent-[var(--nomi-ink)] disabled:opacity-50"
                  disabled={readOnly}
                  max={180}
                  min={-180}
                  step={1}
                  type="range"
                  value={Math.round(radiansToDegrees(environment.panoramaRotation || 0))}
                  onChange={(event) => onEnvironmentPatch({
                    panoramaRotation: degreesToRadians(Number(event.currentTarget.value)),
                  })}
                />
                <span className="text-right font-mono text-micro text-[var(--nomi-ink-60)]">
                  {Math.round(radiansToDegrees(environment.panoramaRotation || 0))}°
                </span>
              </div>
            </label>
            <div className="grid gap-2 rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-2">
              <span className="text-micro text-[var(--nomi-ink-60)]">{t('scene3d.environment.displayMode')}</span>
              <div className="grid grid-cols-2 gap-1">
                {([
                  ['panorama', t('scene3d.environment.panoramaBackground')],
                  ['sphere', t('scene3d.environment.panoramaSphere')],
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    className={cn(
                      'h-7 rounded-nomi-sm text-caption transition',
                      environment.environmentMode === mode
                        ? 'bg-[var(--nomi-ink)] text-[var(--nomi-paper)]'
                        : 'bg-[var(--nomi-ink-05)] text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-10)] hover:text-[var(--nomi-ink)]',
                    )}
                    disabled={readOnly}
                    type="button"
                    onClick={() => onEnvironmentPatch({ environmentMode: mode })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {environment.environmentMode === 'sphere' ? (
              <div className="grid gap-2 rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-2">
                <span className="text-micro font-medium text-[var(--nomi-ink)]">{t('scene3d.environment.sphereRadius')}</span>
                <label className="grid gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-micro text-[var(--nomi-ink-60)]">{t('scene3d.environment.radius')}</span>
                    <span className="font-mono text-micro text-[var(--nomi-ink-40)]">
                      {environment.sphereRadius.toFixed(0)}
                    </span>
                  </div>
                  <input
                    className="h-1.5 w-full accent-[var(--nomi-ink)] disabled:opacity-50"
                    disabled={readOnly}
                    max={SPHERE_RADIUS_MAX}
                    min={SPHERE_RADIUS_MIN}
                    step={5}
                    type="range"
                    value={environment.sphereRadius}
                    onChange={(event) => onEnvironmentPatch({ sphereRadius: Number(event.currentTarget.value) })}
                  />
                </label>
              </div>
            ) : null}
          </div>
        ) : (
          <button
            className="flex h-9 items-center justify-center gap-1.5 rounded-nomi-sm border border-dashed border-[var(--nomi-ink-20)] bg-[var(--nomi-paper)] text-caption text-[var(--nomi-ink-60)] transition hover:border-[var(--nomi-accent)] hover:text-[var(--nomi-accent)] disabled:opacity-50"
            disabled={readOnly}
            type="button"
            onClick={() => panoramaInputRef.current?.click()}
          >
            <IconUpload size={14} />
            {t('scene3d.environment.importPanorama')}
          </button>
        )}
        <input
          ref={panoramaInputRef}
          className="hidden"
          type="file"
          accept="image/*"
          onChange={handlePanoramaInputChange}
        />
      </div>
    </div>
  )
}
