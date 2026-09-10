/**
 * [INPUT]: 依赖 react、three、@react-three/fiber 的 useFrame、react-i18next、../../../../../../ui/toast、../../DirectorEditorContext、
 *          ../../model/splatReveal 的 revealEaseOut、../../model/vec3 的 DEG_TO_RAD
 * [OUTPUT]: 对外提供 PanoramaSphere：图层 panoramaConfig（url / radius / rotationY）→ 等距柱状贴图球（半径 r、内面），1.8s 三次缓出淡入
 * [POS]: director/scene/environment 的 720 全景：贴图加载期间与淡入期间天空盖黑（store 黑幕计数），
 *        不打 editor-only（全景是出片的一部分）；url 变化重载，清空即卸。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useTranslation } from 'react-i18next'
import { toast } from '../../../../../../ui/toast'
import { useDirectorStore, useDirectorStoreApi } from '../../DirectorEditorContext'
import { revealEaseOut } from '../../model/splatReveal'
import { DEG_TO_RAD } from '../../model/vec3'

const PANORAMA_FADE_SECONDS = 1.8

export function PanoramaSphere(): JSX.Element | null {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const config = useDirectorStore((state) => state.activeScene().panoramaConfig)
  const [texture, setTexture] = React.useState<THREE.Texture | null>(null)
  const materialRef = React.useRef<THREE.MeshBasicMaterial>(null)
  const fadeRef = React.useRef<{ elapsed: number; done: boolean } | null>(null)
  // 黑幕收口：淡入完成由 useFrame 关；卸载 / 换图 / 加载失败由 effect 清理关。同一次加载只关一次
  const closeBackdropRef = React.useRef<(() => void) | null>(null)

  React.useEffect(() => {
    if (!config.url) {
      setTexture(null)
      store.getState().setPanoramaDimensions(null)
      return
    }
    const url = config.url
    store.getState().beginRevealBackdrop()
    let backdropOpen = true
    const closeBackdrop = () => {
      if (!backdropOpen) return
      backdropOpen = false
      store.getState().endRevealBackdrop()
    }
    closeBackdropRef.current = closeBackdrop
    let cancelled = false
    const loader = new THREE.TextureLoader()
    loader.setCrossOrigin('anonymous')
    loader.load(
      url,
      (loaded) => {
        if (cancelled) {
          loaded.dispose()
          return
        }
        loaded.colorSpace = THREE.SRGBColorSpace
        loaded.minFilter = THREE.LinearFilter
        loaded.magFilter = THREE.LinearFilter
        fadeRef.current = { elapsed: 0, done: false }
        // 贴图真实像素是「非 2:1 可能拉伸」提示的唯一来源：重开工程也照样量得到，
        // 所以提示常驻在检查器的全景卡里，而不是导入那一刻弹一次就没了
        const image = loaded.image as { width?: number; height?: number } | null
        const width = Number(image?.width) || 0
        const height = Number(image?.height) || 0
        store.getState().setPanoramaDimensions(width > 0 && height > 0 ? { width, height } : null)
        setTexture(loaded)
      },
      undefined,
      () => {
        if (!cancelled) {
          store.getState().setPanoramaDimensions(null)
          toast(t('director.environment.panoramaLoadFailed'), 'error')
        }
        closeBackdrop()
      },
    )
    return () => {
      cancelled = true
      closeBackdrop()
      if (closeBackdropRef.current === closeBackdrop) closeBackdropRef.current = null
    }
  }, [config.url, store, t])

  React.useEffect(() => () => texture?.dispose(), [texture])

  useFrame((_, delta) => {
    const fade = fadeRef.current
    const material = materialRef.current
    if (!fade || fade.done || !material) return
    fade.elapsed += delta
    const progress = Math.min(1, fade.elapsed / PANORAMA_FADE_SECONDS)
    material.opacity = revealEaseOut(progress)
    if (progress >= 1) {
      material.opacity = 1
      material.transparent = false
      material.needsUpdate = true
      fade.done = true
      closeBackdropRef.current?.()
    }
  })

  if (!texture) return null
  return (
    // x 取负镜像球面：从球心看等距柱状贴图才不是左右反的；双面材质：three 对负 determinant 的翻面判定会把内面剔掉（2026-09-02 走查：FrontSide 一片黑），
    // 双面 + 关掉视锥剔除最稳（一个球，代价可忽略）
    <mesh name="directorPanoramaSphere" scale={[-config.radius, config.radius, config.radius]} rotation={[0, config.rotationY * DEG_TO_RAD + Math.PI / 2, 0]} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[1, 64, 40]} />
      <meshBasicMaterial ref={materialRef} map={texture} depthWrite={false} transparent opacity={0} side={THREE.DoubleSide} />
    </mesh>
  )
}
