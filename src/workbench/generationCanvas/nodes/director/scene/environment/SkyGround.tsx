/**
 * [INPUT]: 依赖 react、three、@react-three/fiber 的 useThree、@react-three/drei 的 Grid、../sceneTheme、../sceneRefs 的 tagEditorOnly、
 *          ../../DirectorEditorContext 的 useDirectorStore
 * [OUTPUT]: 对外提供 SkyGround：天空背景色、100×100 网格（可隐藏/抬高）、半透明地面、基础环境光（半球光 + 环境光）
 * [POS]: director/scene/environment 的「空场景底」：泼溅/全景（S5）叠在它之上；网格与地面打 editor-only 标记，出片时隐藏。
 *        主题（深邃黑 / Blender 灰）来自偏好设置，场景配置里的 skyColor / gridHeight / groundOpacity 来自图层。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { Grid } from '@react-three/drei'
import { useDirectorStore } from '../../DirectorEditorContext'
import { tagEditorOnly } from '../sceneRefs'
import { VIEWPORT_THEMES, type DirectorViewportTheme } from '../sceneTheme'

const DEFAULT_SKY = VIEWPORT_THEMES.default.skyColor

export function SkyGround({ theme }: { theme: DirectorViewportTheme }): JSX.Element {
  const { scene } = useThree()
  const sceneConfig = useDirectorStore((state) => state.activeScene().sceneConfig)
  // 泼溅 / 全景显现中天空盖黑，显现结束恢复
  const backdrop = useDirectorStore((state) => state.revealBackdropCount > 0)
  const spec = VIEWPORT_THEMES[theme]
  const groundRef = React.useRef<THREE.Mesh>(null)
  const gridGroupRef = React.useRef<THREE.Group>(null)

  // 天空：neutral-gray 主题下图层的默认黑要让位给主题灰
  const skyColor = theme === 'neutral-gray'
    ? (!sceneConfig.skyColor || sceneConfig.skyColor === DEFAULT_SKY ? spec.skyColor : sceneConfig.skyColor)
    : sceneConfig.skyColor || spec.skyColor

  React.useEffect(() => {
    scene.background = new THREE.Color(backdrop ? 0x000000 : skyColor)
    return () => {
      scene.background = null
    }
  }, [backdrop, scene, skyColor])

  React.useLayoutEffect(() => {
    if (groundRef.current) tagEditorOnly(groundRef.current)
    if (gridGroupRef.current) tagEditorOnly(gridGroupRef.current)
  }, [])

  const groundOpacity = theme === 'neutral-gray' ? spec.groundOpacity : sceneConfig.groundOpacity
  const groundVisible = groundOpacity > 0.001

  return (
    <>
      <hemisphereLight args={[0xffffff, 0x444444, 0.8]} />
      <ambientLight intensity={0.35} />
      <group ref={gridGroupRef} position={[0, sceneConfig.gridHeight, 0]} visible={sceneConfig.gridVisible}>
        <Grid
          args={[100, 100]}
          cellSize={1}
          sectionSize={10}
          fadeDistance={80}
          fadeStrength={1}
          cellColor={new THREE.Color(spec.gridColor)}
          sectionColor={new THREE.Color(spec.gridCenterColor)}
        />
        {spec.axesColored ? <axesHelper args={[50]} /> : null}
      </group>
      <mesh
        ref={groundRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, sceneConfig.gridHeight - 0.005, 0]}
        visible={groundVisible}
        receiveShadow
      >
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial color={spec.groundColor} transparent opacity={groundOpacity} depthWrite={false} />
      </mesh>
    </>
  )
}
