/**
 * [INPUT]: 依赖 react、react-i18next、../../DirectorEditorContext、../../model/directorProject 的 DEFAULT_SCENE_CONFIG、../fields/*
 * [OUTPUT]: 对外提供 SceneLayerInspector：基础环境（天空色、角色标签）、地面与网格（显示/高度/透明度/吸附）、全局变换（缩放/平移）、
 *           720 全景（非 2:1 常驻提示 / 半径/旋转/清除，S5 接入源）
 * [POS]: director/panels/inspector 的图层配置（清单 §4.9 I13）：无选中时显示。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useDirectorStore, useDirectorStoreApi } from '../../DirectorEditorContext'
import { DEFAULT_SCENE_CONFIG } from '../../model/directorProject'
import { isStandardPanoramaDimensions } from '../panoramaImport'
import { ColorField, InspectorCard, SectionHeader, ToggleField, Vec3Fields } from '../fields/FieldPrimitives'
import { SliderNumberField } from '../fields/SliderNumberField'

export function SceneLayerInspector(): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const scene = useDirectorStore((state) => state.activeScene())
  // 「非 2:1 可能拉伸」跟着全景本身走：尺寸由 PanoramaSphere 载贴图时量出，重开工程照样量得到，
  // 所以提示常驻在全景卡里，而不是导入那一刻弹一次（docs/plan/2026-09-09-notification-policy.md）
  const panoramaDimensions = useDirectorStore((state) => state.panoramaDimensions)
  const config = scene.sceneConfig
  const patch = (next: Partial<typeof config>) => store.getState().patchSceneConfig(next)
  const save = () => store.getState().saveState()
  const commit = (next: Partial<typeof config>) => store.getState().withHistory(() => patch(next))
  return (
    <>
      <InspectorCard>
        <SectionHeader title={t('director.inspector.environment')} onReset={() => { save(); patch({ skyColor: DEFAULT_SCENE_CONFIG.skyColor, showCharacterLabels: true }) }} />
        <ColorField label={t('director.inspector.skyColor')} value={config.skyColor} presets={[]} onChangeStart={save} onChange={(skyColor) => patch({ skyColor })} />
        <ToggleField label={t('director.inspector.characterLabels')} checked={config.showCharacterLabels} onChange={(showCharacterLabels) => commit({ showCharacterLabels })} />
      </InspectorCard>
      <InspectorCard>
        <SectionHeader title={t('director.inspector.gridGround')} onReset={() => { save(); patch({ gridVisible: true, gridHeight: 0, groundOpacity: DEFAULT_SCENE_CONFIG.groundOpacity, gridSnapEnabled: false }) }} />
        <ToggleField label={t('director.inspector.gridVisible')} checked={config.gridVisible} onChange={(gridVisible) => commit({ gridVisible })} />
        <SliderNumberField label={t('director.inspector.gridHeight')} value={config.gridHeight} min={-5} max={5} step={0.1} unit="m" onChangeStart={save} onChange={(gridHeight) => patch({ gridHeight })} />
        <SliderNumberField label={t('director.inspector.groundOpacity')} value={config.groundOpacity} min={0} max={1} step={0.05} onChangeStart={save} onChange={(groundOpacity) => patch({ groundOpacity })} />
        <ToggleField label={t('director.inspector.gridSnap')} checked={config.gridSnapEnabled} onChange={(gridSnapEnabled) => commit({ gridSnapEnabled })} hint={t('director.inspector.gridSnapHint')} />
      </InspectorCard>
      <InspectorCard>
        <SectionHeader title={t('director.inspector.globalTransform')} onReset={() => { save(); patch({ scale: 1, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }) }} />
        <SliderNumberField label={t('director.inspector.globalScale')} value={config.scale} min={0.1} max={10} step={0.1} onChangeStart={save} onChange={(scale) => patch({ scale })} />
        <Vec3Fields label={t('director.inspector.globalOffset')} value={config.position} onChangeStart={save} onChange={(position) => patch({ position })} />
        <Vec3Fields label={t('director.inspector.globalRotation')} value={config.rotation} digits={1} onChangeStart={save} onChange={(rotation) => patch({ rotation })} />
      </InspectorCard>
      {scene.panoramaConfig.url ? (
        <InspectorCard>
          <SectionHeader title={t('director.inspector.panorama')} />
          {panoramaDimensions && !isStandardPanoramaDimensions(panoramaDimensions) ? (
            <p className="text-micro text-nomi-ink-60">
              {t('director.environment.nonStandardHint', { width: panoramaDimensions.width, height: panoramaDimensions.height })}
            </p>
          ) : null}
          <SliderNumberField label={t('director.inspector.panoramaRadius')} value={scene.panoramaConfig.radius} min={10} max={1000} step={10} unit="m" onChangeStart={save} onChange={(radius) => store.getState().patchPanoramaConfig({ radius })} />
          <SliderNumberField label={t('director.inspector.panoramaRotation')} value={scene.panoramaConfig.rotationY} min={-180} max={180} step={1} unit="°" onChangeStart={save} onChange={(rotationY) => store.getState().patchPanoramaConfig({ rotationY })} />
          <button type="button" className="mt-1 rounded-nomi-sm border border-nomi-line px-2 py-0.5 text-micro text-nomi-ink-80 hover:bg-workbench-hover" onClick={() => { save(); store.getState().patchPanoramaConfig({ url: '' }) }}>
            {t('director.inspector.clearPanorama')}
          </button>
        </InspectorCard>
      ) : null}
    </>
  )
}
