/**
 * [INPUT]: 依赖 react、three、@react-three/fiber 的 useFrame、react-i18next、@sparkjsdev/spark 的 SplatMesh、../../../../../../ui/toast、
 *          ../../DirectorEditorContext、../../model/directorTypes 的 DirectorObject、../environment/splatRevealDyno 的 createSplatReveal
 * [OUTPUT]: 对外提供 SplatEntity：type='splat' 的对象 → Spark SplatMesh（url = modelPath），加载完成起「显现」特效，显现期间天空盖黑
 * [POS]: director/scene/entities 的泼溅物化：SplatMesh 命令式挂在实体根下随图层 / 实体变换；
 *        url 变化重建，名称 / 语言只刷新错误文案；卸载 dispose 并收黑幕。SparkRenderer 由 environment/SparkHost 提供。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useTranslation } from 'react-i18next'
import { SplatMesh } from '@sparkjsdev/spark'
import { toast } from '../../../../../../ui/toast'
import { useDirectorStoreApi } from '../../DirectorEditorContext'
import type { DirectorObject } from '../../model/directorTypes'
import { createSplatReveal, type SplatRevealController } from '../environment/splatRevealDyno'

export function SplatEntity({ object }: { object: DirectorObject }): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const groupRef = React.useRef<THREE.Group>(null)
  const revealRef = React.useRef<SplatRevealController | null>(null)
  // 黑幕收口：显现结束由 useFrame 关；卸载 / 换文件 / 加载失败由 effect 清理关。同一次加载只关一次
  const closeBackdropRef = React.useRef<(() => void) | null>(null)
  const url = object.modelPath ?? ''
  const name = object.name
  const failureMetadataRef = React.useRef({ name, t })
  React.useLayoutEffect(() => {
    failureMetadataRef.current = { name, t }
  }, [name, t])

  React.useEffect(() => {
    const group = groupRef.current
    if (!group || !url) return
    const mesh = new SplatMesh({ url })
    mesh.name = 'directorSplat'
    group.add(mesh)
    store.getState().beginRevealBackdrop()
    let backdropOpen = true
    const closeBackdrop = () => {
      if (!backdropOpen) return
      backdropOpen = false
      store.getState().endRevealBackdrop()
    }
    closeBackdropRef.current = closeBackdrop
    let cancelled = false
    mesh.initialized
      .then(() => {
        if (cancelled) return
        revealRef.current = createSplatReveal(mesh)
      })
      .catch(() => {
        if (!cancelled) {
          const current = failureMetadataRef.current
          toast(current.t('director.environment.splatLoadFailed', { name: current.name }), 'error')
        }
        closeBackdrop()
      })
    return () => {
      cancelled = true
      revealRef.current?.dispose()
      revealRef.current = null
      closeBackdrop()
      if (closeBackdropRef.current === closeBackdrop) closeBackdropRef.current = null
      group.remove(mesh)
      mesh.dispose()
    }
  }, [url, store])

  useFrame((_, delta) => {
    const reveal = revealRef.current
    if (!reveal) return
    reveal.tick(delta)
    if (!reveal.isActive()) {
      revealRef.current = null
      closeBackdropRef.current?.()
    }
  })

  return <group ref={groupRef} />
}
