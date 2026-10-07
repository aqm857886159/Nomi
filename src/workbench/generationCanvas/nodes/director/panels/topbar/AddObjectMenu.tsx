/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design 的 WorkbenchButton、../../../../../../vendor/tablerIcons、../Popover 的 Popover / PopoverItem、
 *          ../../DirectorEditorContext、../CreationModeContext 的 useCreationMode、../../model/cameraPresets、../../model/directorIds、../../model/directorTypes、
 *          ../../model/cameraCoordinateSpace / sceneObjectGraph（当前视角与选中主体按完整层级转换）、../../scene/ViewportApiContext、../usePanoramaImport、../imageFile
 * [OUTPUT]: 对外提供 AddObjectMenu：顶栏「＋」（公认图形，名字在 hover）——角色（女 / 男 / 群众 → 放置模式；群众在同一浮层设行 / 列 / 间距 / 动作）、机位（14 预设，相对选中主体）、灯光（3 种）、方块（画框模式）、导入 720 全景；
 *           菜单底部「资产库」打开左侧抽屉（精修「选中才出」布局，资产库不再常驻）
 * [POS]: director/panels/topbar 的创建入口，取代 2026-09-09 之前的视口左缘竖排创建栏（设计系统 §1.5.3「归位」：这四项本来就是
 *        「往场景里加东西」一个心智，四个平铺竖条正是 §1.5.4 的反例）。只发意图，落地 / 画框仍由 scene/creation 的 hook 执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { WorkbenchButton, WorkbenchIconButton } from '../../../../../../design'
import { IconBulb, IconChevronRight, IconCube, IconFolderOpen, IconMan, IconPhoto, IconPlus, IconUser, IconUsersGroup, IconVideo, IconWoman } from '../../../../../../vendor/tablerIcons'
import { useDirectorStore, useDirectorStoreApi } from '../../DirectorEditorContext'
import { transformCameraPose } from '../../model/cameraCoordinateSpace'
import { CAMERA_PRESETS, buildCameraFromPreset } from '../../model/cameraPresets'
import { DEFAULT_CROWD_ACTION_ID } from '../../model/defaultCharacter'
import { createCameraId } from '../../model/directorIds'
import type { DirectorLightType } from '../../model/directorTypes'
import { frameTransform, invertFrame, objectWorldFrame, sceneFrame } from '../../model/sceneObjectGraph'
import { CROWD_MAX_PER_AXIS } from '../../model/storeEntityActions'
import { useViewportApi } from '../../scene/ViewportApiContext'
import { ActionSelectModal } from '../dialogs/ActionSelectModal'
import { ActionPickField } from '../fields/ActionPickField'
import { SliderNumberField } from '../fields/SliderNumberField'
import { useCreationMode } from '../CreationModeContext'
import { PANORAMA_ACCEPT } from '../imageFile'
import { Popover, PopoverItem } from '../Popover'
import { usePanoramaImport } from '../usePanoramaImport'

const LIGHT_TYPES: DirectorLightType[] = ['directional', 'point', 'spot']
type Sub = 'character' | 'crowd' | 'camera' | 'light' | null

export function AddObjectMenu({ onOpenAssets }: { onOpenAssets: () => void }): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const apiRef = useViewportApi()
  const { placement, boxDraw } = useCreationMode()
  const [open, setOpen] = React.useState(false)
  const [sub, setSub] = React.useState<Sub>(null)
  // 群众参数留在菜单这一层：选动作的弹窗在浮层外，浮层收起再展开参数不丢
  const [crowdRows, setCrowdRows] = React.useState(2)
  const [crowdCols, setCrowdCols] = React.useState(3)
  const [crowdSpacing, setCrowdSpacing] = React.useState(2)
  const [crowdAction, setCrowdAction] = React.useState(DEFAULT_CROWD_ACTION_ID)
  const [actionModalOpen, setActionModalOpen] = React.useState(false)
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

  const startCrowdPlacement = () => {
    boxDraw.cancel()
    placement.start('female', { rows: crowdRows, cols: crowdCols, spacing: crowdSpacing, actionId: crowdAction })
    close()
  }

  // 选动作的弹窗挂在浮层外：先收起浮层（保留子菜单），弹窗关掉后原样展开
  const openActionModal = () => {
    setOpen(false)
    setActionModalOpen(true)
  }
  const closeActionModal = () => {
    setActionModalOpen(false)
    setOpen(true)
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
        panelClassName={sub === 'crowd' ? 'w-[292px] max-h-[420px] overflow-auto' : 'w-[228px] max-h-[420px] overflow-auto'}
        trigger={
          <WorkbenchIconButton
            size="sm"
            icon={<IconPlus size={16} stroke={1.9} />}
            label={t('director.topbar.addAria')}
            className={modeActive || open ? 'bg-nomi-accent-soft text-nomi-accent' : ''}
            aria-expanded={open}
            data-testid="director-add-menu"
            onClick={() => (open ? close() : setOpen(true))}
          />
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
            <PopoverItem onClick={() => { close(); onOpenAssets() }}>
              <IconFolderOpen size={16} stroke={1.9} />
              <span className="flex-1 text-left" data-testid="director-open-assets">{t('director.regions.assets')}</span>
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
            <PopoverItem onClick={() => setSub('crowd')}>
              <IconUsersGroup size={16} stroke={1.9} />
              <span className="flex-1 text-left" data-testid="director-add-crowd">{t('director.creation.crowd')}</span>
              <IconChevronRight size={14} stroke={1.9} className="text-nomi-ink-40" />
            </PopoverItem>
          </>
        ) : null}
        {sub === 'crowd' ? (
          <>
            <PopoverItem onClick={() => setSub('character')}>← {t('director.creation.crowd')}</PopoverItem>
            <div className="mx-1 my-1 h-px bg-nomi-line-soft" />
            <div className="px-1 pt-1">
              <SliderNumberField label={t('director.bottomBar.crowdRows')} value={crowdRows} min={1} max={CROWD_MAX_PER_AXIS} step={1} onChange={setCrowdRows} />
              <SliderNumberField label={t('director.bottomBar.crowdCols')} value={crowdCols} min={1} max={CROWD_MAX_PER_AXIS} step={1} onChange={setCrowdCols} />
              <SliderNumberField label={t('director.bottomBar.crowdSpacing')} value={crowdSpacing} min={0.5} max={5} step={0.1} unit="m" onChange={setCrowdSpacing} />
              <ActionPickField label={t('director.creation.crowdAction')} actionId={crowdAction} onOpen={openActionModal} />
              <div className="mb-2 text-micro text-nomi-ink-40">{t('director.creation.crowdHint')}</div>
              <WorkbenchButton size="sm" variant="primary" className="w-full" data-testid="director-crowd-place" onClick={startCrowdPlacement}>
                {t('director.creation.crowdPlace')}
              </WorkbenchButton>
            </div>
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
      <ActionSelectModal
        open={actionModalOpen}
        onClose={closeActionModal}
        initialId={crowdAction}
        title={t('director.action.crowdModalTitle')}
        confirmLabel={(name) => t('director.action.useNamed', { name })}
        onPick={(entry) => setCrowdAction(entry.id)}
      />
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
