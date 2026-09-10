/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design（NomiSegmented / WorkbenchButton / WorkbenchIconButton）、../../../../../../vendor/tablerIcons、
 *          ../../../../../../ui/toast、../../useAiSceneBuilder、../../model/storeAiSceneActions 的 AiSceneTarget、../CanvasImagesContext、../imageFile 的 readFileAsDataUrl、../Popover
 * [OUTPUT]: 对外提供 AiSceneBar（open / onOpen / onClose）：折叠态是视口底部中央的常驻胶囊入口，展开态是浮条
 * [POS]: director/panels/ai 的 AI 搭场景浮条（清单 §2.3 V8）：描述框（Enter 提交、Shift+Enter 换行、粘贴图片）+ 参考图 ≤3（本地上传 / 从画布选）+ 目标（当前图层 / 新图层）
 *        + 运行 / 取消 + 状态与秒表。只组合设计原语，编排在 useAiSceneBuilder。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { NomiSegmented, WorkbenchButton, WorkbenchIconButton } from '../../../../../../design'
import { toast } from '../../../../../../ui/toast'
import { IconPhoto, IconPlayerStop, IconSparkles, IconUpload, IconX } from '../../../../../../vendor/tablerIcons'
import type { AiSceneTarget } from '../../model/storeAiSceneActions'
import { useAiSceneBuilder } from '../../useAiSceneBuilder'
import { useCanvasImages } from '../CanvasImagesContext'
import { readFileAsDataUrl } from '../imageFile'
import { Popover, PopoverItem } from '../Popover'

const MAX_REFERENCE_IMAGES = 3

export function AiSceneBar({ open, onOpen, onClose }: { open: boolean; onOpen: () => void; onClose: () => void }): JSX.Element | null {
  const { t } = useTranslation()
  const builder = useAiSceneBuilder()
  const canvasImages = useCanvasImages()
  const [description, setDescription] = React.useState('')
  const [images, setImages] = React.useState<string[]>([])
  const [target, setTarget] = React.useState<AiSceneTarget>('current_layer')
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [imageQuery, setImageQuery] = React.useState('')
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const running = builder.status.phase === 'running'

  const addImage = React.useCallback(
    (url: string) => {
      setImages((current) => {
        if (current.length >= MAX_REFERENCE_IMAGES) {
          toast(t('director.ai.tooManyImages', { max: MAX_REFERENCE_IMAGES }), 'warning')
          return current
        }
        return current.includes(url) ? current : [...current, url]
      })
    },
    [t],
  )

  const addFiles = React.useCallback(
    async (files: File[]) => {
      for (const file of files.filter((candidate) => candidate.type.startsWith('image/'))) {
        const url = await readFileAsDataUrl(file).catch(() => '')
        if (url) addImage(url)
      }
    },
    [addImage],
  )

  const submit = React.useCallback(() => {
    void builder.run(description, images, target)
  }, [builder, description, images, target])

  // 折叠态是视口底部中央的常驻入口：2026-09-09 五簇重排后底栏那条胶囊没了，
  // AI 搭场景不再靠别处的开关，自己就是入口（一功能一个家）。
  if (!open) {
    return (
      <button
        type="button"
        className="pointer-events-auto flex h-12 w-[440px] max-w-[calc(100%-24px)] items-center gap-3 rounded-full border border-nomi-line bg-nomi-paper/95 pl-4 pr-1.5 text-left shadow-nomi-lg backdrop-blur transition-colors duration-nomi-fast ease-nomi-fast hover:border-nomi-ink-30"
        aria-label={t('director.ai.toggle')}
        title={t('director.ai.toggleHint')}
        data-testid="director-ai-pill"
        onClick={onOpen}
      >
        <span className="flex-1 truncate text-body-sm text-nomi-ink-40">{t('director.ai.placeholderShort')}</span>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-nomi-accent text-nomi-paper">
          <IconSparkles size={18} stroke={1.9} />
        </span>
      </button>
    )
  }

  return (
    <div className="pointer-events-auto w-[560px] max-w-[calc(100%-24px)] rounded-nomi-lg border border-nomi-line bg-nomi-paper/95 p-3 shadow-nomi-lg backdrop-blur" role="dialog" aria-label={t('director.ai.title')} data-testid="director-ai-bar">
      <div className="mb-2 flex items-center gap-2">
        <IconSparkles size={16} stroke={2} className="text-nomi-accent" />
        <span className="text-body-sm font-semibold text-nomi-ink">{t('director.ai.title')}</span>
        <span className="text-micro text-nomi-ink-40">{t('director.ai.hint')}</span>
        <span className="flex-1" />
        <WorkbenchIconButton size="sm" icon={<IconX size={14} stroke={2} />} label={t('director.ai.close')} onClick={onClose} />
      </div>
      <textarea
        className="mb-2 w-full resize-none rounded-nomi-sm border border-nomi-line bg-nomi-bg px-2 py-1.5 text-caption text-nomi-ink outline-none focus:border-nomi-accent"
        rows={2}
        placeholder={t('director.ai.placeholder')}
        value={description}
        disabled={running}
        onChange={(event) => setDescription(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            if (!running) submit()
          }
        }}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData?.files ?? [])
          if (files.length) {
            event.preventDefault()
            void addFiles(files)
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        {images.map((url, index) => (
          <div key={url} className="group relative h-10 w-10 overflow-hidden rounded-nomi-sm border border-nomi-line">
            <img src={url} alt="" className="h-full w-full object-cover" />
            <button type="button" className="absolute inset-0 hidden items-center justify-center bg-nomi-ink/60 text-nomi-paper group-hover:flex" aria-label={t('director.ai.removeImage')} disabled={running} onClick={() => setImages((current) => current.filter((_, i) => i !== index))}>
              <IconX size={14} stroke={2} />
            </button>
          </div>
        ))}
        <WorkbenchIconButton size="sm" icon={<IconUpload size={14} stroke={2} />} label={t('director.ai.addImage')} disabled={running || images.length >= MAX_REFERENCE_IMAGES} onClick={() => fileInputRef.current?.click()} />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          aria-label={t('director.ai.addImage')}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? [])
            event.currentTarget.value = ''
            void addFiles(files)
          }}
        />
        <Popover
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          align="start"
          panelClassName="w-[260px] p-1"
          trigger={
            <span title={canvasImages.length ? undefined : t('director.ai.canvasEmpty')}>
              <WorkbenchIconButton size="sm" icon={<IconPhoto size={14} stroke={2} />} label={t('director.ai.pickFromCanvas')} disabled={running || canvasImages.length === 0 || images.length >= MAX_REFERENCE_IMAGES} onClick={() => setPickerOpen((value) => !value)} />
            </span>
          }
        >
          <input className="mb-1 w-full rounded-nomi-sm border border-nomi-line bg-nomi-bg px-2 py-1 text-caption text-nomi-ink outline-none" placeholder={t('director.assets.search')} value={imageQuery} onChange={(event) => setImageQuery(event.target.value)} />
          {canvasImages.filter((image) => image.name.toLocaleLowerCase().includes(imageQuery.trim().toLocaleLowerCase())).map((image) => (
            <PopoverItem key={image.id} onClick={() => { addImage(image.url); setPickerOpen(false) }}>
              <img src={image.url} alt="" className="h-8 w-8 rounded-nomi-sm object-cover" />
              <span className="truncate">{image.name}{image.historical ? ` · ${t('director.ai.history')}` : ''}</span>
            </PopoverItem>
          ))}
        </Popover>
        <NomiSegmented
          ariaLabel={t('director.ai.target')}
          density="compact"
          fit="content"
          value={target}
          options={[
            { value: 'current_layer', label: t('director.ai.targetCurrent'), disabled: running },
            { value: 'new_layer', label: t('director.ai.targetNew'), disabled: running },
          ]}
          onChange={(value) => setTarget(value as AiSceneTarget)}
        />
        <span className="flex-1" />
        {running ? (
          <WorkbenchButton size="sm" className="gap-1" onClick={builder.cancel}>
            <IconPlayerStop size={14} stroke={2} />
            {t('director.ai.cancel')}
          </WorkbenchButton>
        ) : (
          <WorkbenchButton size="sm" variant="primary" className="gap-1" onClick={submit}>
            <IconSparkles size={14} stroke={2} />
            {t('director.ai.run')}
          </WorkbenchButton>
        )}
      </div>
      {builder.status.phase !== 'idle' ? (
        <div className="mt-2 flex items-center gap-2 text-micro text-nomi-ink-60" data-testid="director-ai-status">
          <span className="truncate">{builder.status.message}</span>
          {running ? <span className="font-nomi-mono text-nomi-ink-40">{t('director.ai.elapsed', { seconds: builder.status.elapsedSeconds })}</span> : null}
          {running && builder.status.streamedChars > 0 ? <span className="font-nomi-mono text-nomi-ink-40">{t('director.ai.streaming', { chars: builder.status.streamedChars })}</span> : null}
        </div>
      ) : null}
    </div>
  )
}
