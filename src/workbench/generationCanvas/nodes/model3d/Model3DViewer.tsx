import React from 'react'
import { Canvas } from '@react-three/fiber'
import { Bounds, Center, OrbitControls, useGLTF } from '@react-three/drei'
import { cn } from '../../../../utils/cn'

/**
 * 生成出的 3D 模型（.glb）的卡内交互预览。
 *
 * 复用 scene3d 同一套 R3F + drei + three 栈（CSP 已为 Three.js WASM/blob 放行，见 electron/main.ts），
 * 但**不引 Environment/Stage 的远程 HDR 预设**——那会去 CDN 拉 .hdr，触 CSP/离线失败，违 local-first。
 * 改用手动三点光（仿 scene3dEnvironment）。Bounds 自动取景、OrbitControls 让用户拖转、autoRotate 给转盘感。
 *
 * 只吃 glTF/glb（useGLTF = three GLTFLoader）；.obj 不在栈里（MVP 不做）。
 */

function Glb({ url }: { url: string }): JSX.Element {
  const { scene } = useGLTF(url)
  // clone：同一 glb 被多个节点引用时不共享 mutable 场景（与 Mannequin 同款防串改）。
  const object = React.useMemo(() => scene.clone(true), [scene])
  return <primitive object={object} />
}

class GlbBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  componentDidCatch(error: unknown): void {
    console.error('Failed to load 3D model glb.', error)
  }
  render(): React.ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export default function Model3DViewer({ url }: { url: string }): JSX.Element {
  return (
    <div className={cn('w-full h-full bg-nomi-ink-05')}>
      <GlbBoundary
        fallback={
          <div className={cn('flex h-full w-full items-center justify-center text-caption text-nomi-ink-40')}>
            模型加载失败
          </div>
        }
      >
        <Canvas camera={{ position: [2.4, 1.8, 3.2], fov: 45 }} dpr={[1, 2]} frameloop="demand">
          <ambientLight intensity={0.75} />
          <directionalLight position={[3, 5, 2]} intensity={1.1} castShadow />
          <directionalLight position={[-3, 2, -2]} intensity={0.4} />
          <React.Suspense fallback={null}>
            <Bounds fit clip observe margin={1.25}>
              <Center>
                <Glb url={url} />
              </Center>
            </Bounds>
          </React.Suspense>
          <OrbitControls
            makeDefault
            enablePan={false}
            autoRotate
            autoRotateSpeed={1.1}
            minDistance={1.2}
            maxDistance={14}
          />
        </Canvas>
      </GlbBoundary>
    </div>
  )
}
