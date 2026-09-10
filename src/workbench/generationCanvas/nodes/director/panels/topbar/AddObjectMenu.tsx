/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design 的 WorkbenchButton、../../../../../../vendor/tablerIcons、../Popover 的 Popover / PopoverItem、
 *          ../../DirectorEditorContext、../CreationModeContext 的 useCreationMode、../../model/cameraPresets、../../model/directorIds、../../model/directorTypes、
 *          ../../model/cameraCoordinateSpace / sceneObjectGraph（当前视角与选中主体按完整层级转换）、../../scene/ViewportApiContext、../usePanoramaImport、../imageFile
 * [OUTPUT]: 对外提供 AddObjectMenu：顶栏「＋ 添加 ▾」——角色（女 / 男 → 放置模式）、机位（14 预设，相对选中主体）、灯光（3 种）、方块（画框模式）、导入 720 全景
 * [POS]: director/panels/topbar 的创建入口，取代 2026-09-09 之前的视口左缘竖排创建栏（设计系统 §1.5.3「归位」：这四项本来就是
 *        「往场景里加东西」一个心智，四个平铺竖条正是 §1.5.4 的反例）。只发意图，落地 / 画框仍由 scene/creation 的 hook 执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { WorkbenchButton } from '../../../../../../design'
import { IconBulb, IconChevronDown, IconChevronRight, IconCube, IconMan, IconPhoto, IconPlus, IconUser, IconVideo, IconWoman } from '../../../../../../vendor/tablerIcons'
import { useDirectorStore, useDirectorStoreApi } from '../../DirectorEditorContext'
import { transformCameraPose } from '../../model/cameraCoordinateSpace'
import { CAMERA_PRESETS, buildCameraFromPreset } from '../../model/cameraPresets'
import { createCameraId } from '../../model/directorIds'
import type { DirectorLightType } from '../../model/directorTypes'
import { frameTransform, invertFrame, objectWorldFrame, sceneFrame } from '../../model/sceneObjectGraph'
import { useViewportApi } from '../../scene/ViewportApiContext'
import { useCreationMode } from '../CreationModeContext'
import { PANORAMA_ACCEPT } from '../imageFile'
import { Popover, PopoverItem } from '../Popover'
import { usePanoramaImport } from '../usePanoramaImport'

const LIGHT_TYPES: DirectorLightType[] = ['directional', 'point', 'spot']
type Sub = 'character' | 'camera' | 'light' | null

export function AddObjectMenu(): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const apiRef = useViewportApi()
  const { placement, boxDraw } = useCreationMode()
  const [open, setOpen] = React.useState(false)
  const [sub, setSub] = React.useState<Sub>(null)
  const subject = useDirectorStore((state) => state.findObject(state.selection.objectId) ?? null)
  const { importPanoramaFile, status: panoramaStatus } = usePanoramaImport()
  const panoramaInputRef = React.useRef<HTMLInputElement | null>(null)

  const close = () => {
    setOpen(false)
    setSub(null)
  }

  const addCameraFromPreset = (presetId: string) => {
    const preset = CAMERA_PRESETS.find((item) => item.id === presetId)
    if (!preset) return
    const state = store.getState()
    const count = state.activeScene().cameras.length + 1
    const view = apiRef.current?.getViewPose()
    // 预设机位直接叫预设名（「正面中景」），只有「当前视角」叫「机位 N」
    const camera = buildCameraFromPreset({
      preset,
      id: createCameraId(),
      name: preset.isCurrent ? t('director.creation.cameraName', { index: count }) : t(`director.cameraPreset.${preset.id}`),
      subject: subject ? frameTransform(objectWorldFrame(state.activeScene().objects, subject.id)) : null,
      currentView: view ? transformCameraPose(view, invertFrame(sceneFrame(state.activeScene().sceneConfig))) : null,
    })
    const id = state.addCamera(camera)
    // 新机位同时成为预览机位（画中画切过去），主体取消选中
    state.setPreviewCamera(id)
    state.select({ cameraId: id, objectId: null, lightId: null, multiObjectIds: [] })
    close()
  }

  const addLight = (type: DirectorLightType) => {
    const state = store.getState()
    const count = state.activeScene().lights.filter((light) => light.type === type).length + 1
    state.addLight(type, t(`director.creation.lightName.${type}`, { index: count }))
    close()
  }

  const startPlacement = (gender: 'female' | 'male') => {
    boxDraw.cancel()
    placement.start(gender)
    close()
  }

  const toggleBox = () => {
    placement.cancel()
    if (boxDraw.active) boxDraw.cancel()
    else boxDraw.start()
    close()
  }

  const modeActive = placement.active || boxDraw.active
  const Row = ({ icon, label, onClick, hasSub }: { icon: React.ReactNode; label: string; onClick: () => void; hasSub?: boolean }): JSX.Element => (
    <PopoverItem onClick={onClick}>
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {hasSub ? <IconChevronRight size={14} stroke={1.9} className="text-nomi-ink-40" /> : null}
    </PopoverItem>
  )

  return (
    <>
      <Popover
        open={open}
        onClose={close}
        panelClassName="w-[228px] max-h-[420px] overflow-auto"
        trigger={
          <WorkbenchButton
            size="sm"
            className={modeActive ? 'gap-1 bg-nomi-accent-soft text-nomi-accent' : 'gap-1'}
            aria-label={t('director.topbar.addAria')}
            aria-expanded={open}
            data-testid="director-add-menu"
            onClick={() => (open ? close() : setOpen(true))}
          >
            <IconPlus size={16} stroke={1.9} />
            {t('director.topbar.add')}
            <IconChevronDown size={14} stroke={1.9} />
          </WorkbenchButton>
        }
      >
        {sub === null ? (
          <>
            <div className="px-2 py-1 text-micro font-semibold uppercase tracking-wide text-nomi-ink-40">{t('director.addMenu.sectionAdd')}</div>
            <Row icon={<IconUser size={16} stroke={1.9} />} label={t('director.creation.character')} onClick={() => setSub('character')} hasSub />
            <Row icon={<IconVideo size={16} stroke={1.9} />} label={t('director.creation.camera')} onClick={() => setSub('camera')} hasSub />
            <Row icon={<IconBulb size={16} stroke={1.9} />} label={t('director.creation.light')} onClick={() => setSub('light')} hasSub />
            <Row icon={<IconCube size={16} stroke={1.9} />} label={t('director.creation.box')} onClick={toggleBox} />
            <div className="mx-1 my-1 h-px bg-nomi-line-soft" />
            <div className="px-2 py-1 text-micro font-semibold uppercase tracking-wide text-nomi-ink-40">{t('director.addMenu.sectionImport')}</div>
            <PopoverItem title={t('director.bottomBar.panoramaImportHint')} onClick={() => { panoramaInputRef.current?.click(); close() }}>
              <IconPhoto size={16} stroke={1.9} />
              <span className="flex-1 text-left">{t('director.bottomBar.panoramaImport')}</span>
            </PopoverItem>
          </>
        ) : null}
        {sub === 'character' ? (
          <>
            <PopoverItem onClick={() => setSub(null)}>← {t('director.creation.character')}</PopoverItem>
            <div className="mx-1 my-1 h-px bg-nomi-line-soft" />
            <PopoverItem onClick={() => startPlacement('female')}>
              <IconWoman size={16} stroke={1.9} />
              {t('director.creation.female')}
            </PopoverItem>
            <PopoverItem onClick={() => startPlacement('male')}>
              <IconMan size={16} stroke={1.9} />
              {t('director.creation.male')}
            </PopoverItem>
          </>
        ) : null}
        {sub === 'light' ? (
          <>
            <PopoverItem onClick={() => setSub(null)}>← {t('director.creation.light')}</PopoverItem>
            <div className="mx-1 my-1 h-px bg-nomi-line-soft" />
            {LIGHT_TYPES.map((type) => (
              <PopoverItem key={type} onClick={() => addLight(type)}>
                {t(`director.lightType.${type}`)}
              </PopoverItem>
            ))}
          </>
        ) : null}
        {sub === 'camera' ? (
          <>
            <PopoverItem onClick={() => setSub(null)}>← {t('director.creation.camera')}</PopoverItem>
            <div className="px-2 py-1 text-caption font-semibold text-nomi-accent" data-testid="director-camera-subject">
              {subject ? t('director.creation.relativeTo', { name: subject.name }) : t('director.creation.relativeToOrigin')}
            </div>
            {/* 没选中主体时只给「当前视角」，预设都是相对主体的 */}
            {CAMERA_PRESETS.filter((preset) => subject || preset.isCurrent).map((preset) => (
              <PopoverItem key={preset.id} onClick={() => addCameraFromPreset(preset.id)}>
                {t(`director.cameraPreset.${preset.id}`)}
              </PopoverItem>
            ))}
          </>
        ) : null}
      </Popover>
      {panoramaStatus}
      <input
        ref={panoramaInputRef}
        type="file"
        accept={PANORAMA_ACCEPT}
        className="hidden"
        aria-label={t('director.bottomBar.panoramaImport')}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) importPanoramaFile(file)
        }}
      />
    </>
  )
}
