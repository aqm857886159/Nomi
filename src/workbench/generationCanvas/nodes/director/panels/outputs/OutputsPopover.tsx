/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design 的 WorkbenchButton / WorkbenchIconButton、../../../../../../vendor/tablerIcons、
 *          ../../DirectorEditorContext、../../OutputsContext 的 useOutputs / DirectorOutput、../../model/hotkeys、../Popover
 * [OUTPUT]: 对外提供 OutputsPopover（底栏文件夹图标 + 角标计数，aria 名「产出 N」+ 浮层：截图 / 视频两组缩略图，每项 发送到画布 / 删除）
 * [POS]: director/panels/outputs 的产物弹层（清单 §4.7 P3）：只展示工程 outputs 里的句柄，缩略图直接用资产 url；发送到画布由 OutputsContext 提供，
 *        没接画布（开发入口）时按钮禁用并说明。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { WorkbenchIconButton } from '../../../../../../design'
import { IconFolder, IconPhoto, IconSend2, IconTrash, IconVideo } from '../../../../../../vendor/tablerIcons'
import { useDirectorStore, useDirectorStoreApi } from '../../DirectorEditorContext'
import { DIRECTOR_HOTKEYS, formatHotkey } from '../../model/hotkeys'
import { useOutputs, type DirectorOutput } from '../../OutputsContext'
import { Popover } from '../Popover'

function OutputRow({ output }: { output: DirectorOutput }): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const outputs = useOutputs()
  return (
    <div className="group flex items-center gap-2 rounded-nomi-sm p-1 hover:bg-workbench-hover">
      <div className="flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded-nomi-sm border border-nomi-line bg-nomi-bg">
        {output.kind === 'image' ? (
          <img src={output.assetUrl} alt={output.name} className="h-full w-full object-cover" />
        ) : (
          <video src={output.assetUrl} poster={output.coverUrl} muted className="h-full w-full object-cover" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-caption text-nomi-ink">{output.name}</div>
        <div className="truncate text-micro text-nomi-ink-40">{output.kind === 'video' ? t('director.timeline.videoMeta', { width: output.width, height: output.height, duration: output.duration.toFixed(1) }) : output.cameraName}</div>
      </div>
      <span title={outputs.sendToCanvas ? undefined : t('director.timeline.outputSendUnavailable')}>
        <WorkbenchIconButton size="sm" icon={<IconSend2 size={14} stroke={2} />} label={t('director.timeline.outputSendToCanvas')} disabled={!outputs.sendToCanvas} onClick={() => outputs.sendToCanvas?.(output)} />
      </span>
      <WorkbenchIconButton size="sm" icon={<IconTrash size={14} stroke={2} />} label={t('director.timeline.outputDelete')} onClick={() => store.getState().removeOutput(output.id)} />
    </div>
  )
}

export function OutputsPopover(): JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const screenshots = useDirectorStore((state) => state.project.outputs.screenshots)
  const videos = useDirectorStore((state) => state.project.outputs.videos)
  const count = screenshots.length + videos.length
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      align="end"
      panelClassName="w-[320px] p-2"
      trigger={
        <span className="relative inline-flex">
          <WorkbenchIconButton size="sm" icon={<IconFolder size={16} stroke={1.9} />} label={t('director.timeline.outputsButton', { count })} data-testid="director-outputs" aria-pressed={open} onClick={() => setOpen((value) => !value)} />
          {count > 0 ? (
            <span className="pointer-events-none absolute -right-0.5 -top-0.5 min-w-[14px] rounded-full bg-nomi-accent px-1 text-center font-nomi-mono text-micro leading-tight text-nomi-paper" aria-hidden>
              {count}
            </span>
          ) : null}
        </span>
      }
    >
      {count === 0 ? (
        <div className="px-1 py-2 text-caption text-nomi-ink-40">{t('director.timeline.outputsEmpty', { hotkey: formatHotkey(DIRECTOR_HOTKEYS.screenshot) })}</div>
      ) : (
        <div className="flex max-h-[360px] flex-col gap-1 overflow-auto">
          {screenshots.length ? (
            <div className="flex items-center gap-1 px-1 text-micro font-semibold text-nomi-ink-40">
              <IconPhoto size={12} stroke={2} />
              {t('director.timeline.outputsScreenshots')}
            </div>
          ) : null}
          {screenshots.map((item) => (
            <OutputRow key={item.id} output={{ kind: 'image', ...item }} />
          ))}
          {videos.length ? (
            <div className="mt-1 flex items-center gap-1 px-1 text-micro font-semibold text-nomi-ink-40">
              <IconVideo size={12} stroke={2} />
              {t('director.timeline.outputsVideos')}
            </div>
          ) : null}
          {videos.map((item) => (
            <OutputRow key={item.id} output={{ kind: 'video', ...item }} />
          ))}
        </div>
      )}
    </Popover>
  )
}
