// 站位多视角离屏截图 harness（仅 dev，不进 prod 构建——vite build 只吃 index.html）。
// ?case=NN → buildStagingScene（与生产同一路径）→ 复用同一套 Mannequin/MannequinCrowd（同 x-bot.glb + 同骨骼数学）
// → hero(生产机位，==AI 实际收到的图) + 5 个环绕诊断视角(front/q3/side/back/top) 各出一张 → window.__shots。
// 环绕视角加一层淡地面网格，便于子 agent 判「悬空/陷地」；hero 保持生产无地面以求与 AI 收到的一致。
import React, { Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Mannequin, MannequinCrowd, MannequinAssetBoundary, ProceduralMannequin } from '../workbench/generationCanvas/nodes/scene3d/scene3dObjects'
import { captureScene, applySceneCameraPose } from '../workbench/generationCanvas/nodes/scene3d/scene3dMath'
import { buildStagingScene } from '../workbench/generationCanvas/nodes/scene3d/stagingBuilder'
import type { Scene3DState, Scene3DCaptureResult } from '../workbench/generationCanvas/nodes/scene3d/scene3dTypes'
import { STAGING_TEST_CASES } from './stagingTestCases'

type ShotMap = Record<string, string>

const params = new URLSearchParams(window.location.search)
const caseIndex = Number.parseInt(params.get('case') ?? '0', 10) || 0
const testCase = STAGING_TEST_CASES[caseIndex] ?? STAGING_TEST_CASES[0]
const SHOT_W = 960
const SHOT_H = 720

// 环绕诊断视角：方位角(绕Y,度) + 俯仰角(度,正=俯视)。覆盖正/三四分斜俯/侧/背/顶——
// 断肢藏不住、前后腿穿插与悬空在 q3/top 暴露。
// 设计要点：① 俯仰角都 ≥12°，让地面网格读得出、悬空/落地一眼可判（低角度地面近乎边缘看不见会误判悬空）；
// ② 方位角刻意偏开正轴（side 78 非 90、back 205 非 180、top 偏 20），这样「面对面/纵队」沿某轴排开的角色
// 在任何视角都不会完全互相遮挡——治子 agent 把投影遮挡误读成「穿插/同朝向」的假阳性（top 仍是判分离的权威视角）。
const ORBIT_VIEWS: Array<{ key: string; azDeg: number; elDeg: number }> = [
  { key: 'front', azDeg: 0, elDeg: 14 },
  { key: 'q3', azDeg: 40, elDeg: 22 },
  { key: 'side', azDeg: 78, elDeg: 14 },
  { key: 'back', azDeg: 205, elDeg: 14 },
  { key: 'top', azDeg: 20, elDeg: 76 },
]

function StagingObjects({ state }: { state: Scene3DState }): JSX.Element {
  let roleStart = 0
  return (
    <>
      {state.objects.map((object) => {
        if (object.type === 'mannequin') {
          const node = (
            <group key={object.id} position={object.position} rotation={object.rotation} scale={object.scale}>
              <Mannequin color={object.color || '#808080'} pose={object.pose} />
            </group>
          )
          roleStart += 1
          return node
        }
        if (object.type === 'mannequinCrowd') {
          return (
            <group key={object.id} position={object.position} rotation={object.rotation} scale={object.scale}>
              <MannequinCrowd object={object} roleStartIndex={roleStart} />
            </group>
          )
        }
        return null
      })}
    </>
  )
}

function sceneBounds(scene: THREE.Scene): { center: THREE.Vector3; radius: number } {
  const box = new THREE.Box3()
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh && mesh.userData?.__stagingFloor !== true) box.expandByObject(mesh)
  })
  if (box.isEmpty()) return { center: new THREE.Vector3(0, 1.2, 0), radius: 3 }
  const center = box.getCenter(new THREE.Vector3())
  const radius = Math.max(0.5, box.getSize(new THREE.Vector3()).length() / 2)
  return { center, radius }
}

function CaptureController({ state, onDone }: { state: Scene3DState; onDone: (shots: ShotMap) => void }): null {
  const { gl, scene } = useThree()
  const firedRef = React.useRef(false)
  const frameRef = React.useRef(0)
  useFrame(() => {
    if (firedRef.current) return
    frameRef.current += 1
    if (frameRef.current < 12) return // 等 GLB 落地(layout effect) + 自动落地稳定
    firedRef.current = true

    const shots: ShotMap = {}
    const floor = scene.getObjectByName('__stagingFloor') as THREE.Object3D | null

    // hero：生产机位，关地面（与 AI 实际收到的一致）
    const heroCam = state.cameras[0]
    if (heroCam) {
      if (floor) floor.visible = false
      const cam = new THREE.PerspectiveCamera(heroCam.fov, SHOT_W / SHOT_H, heroCam.near, heroCam.far)
      applySceneCameraPose(cam, heroCam)
      const r: Scene3DCaptureResult | null = captureScene(gl, scene, cam, SHOT_W, SHOT_H, 'hero', 'scene3d-camera', false)
      if (r) shots.hero = r.dataUrl
      if (floor) floor.visible = true
    }

    // 环绕诊断视角：开地面，统一框住整景
    const { center, radius } = sceneBounds(scene)
    const fov = 40
    const dist = (radius / Math.sin((fov / 2) * (Math.PI / 180))) * 1.18
    for (const v of ORBIT_VIEWS) {
      const az = v.azDeg * (Math.PI / 180)
      const el = v.elDeg * (Math.PI / 180)
      const cam = new THREE.PerspectiveCamera(fov, SHOT_W / SHOT_H, 0.05, 200)
      cam.position.set(
        center.x + dist * Math.sin(az) * Math.cos(el),
        center.y + dist * Math.sin(el),
        center.z + dist * Math.cos(az) * Math.cos(el),
      )
      cam.lookAt(center)
      cam.updateProjectionMatrix()
      const r = captureScene(gl, scene, cam, SHOT_W, SHOT_H, v.key, 'scene3d-camera', false)
      if (r) shots[v.key] = r.dataUrl
    }
    // 调试：逐角色「蒙皮后真实最低顶点」的世界 Y（min.y 应≈0 才算落地；>0=悬空，<0=陷地）。
    // 必须按蒙皮变形算（Box3 用 rest-pose 几何，对姿势不敏感会误导）。
    const v = new THREE.Vector3()
    const diag: number[] = []
    scene.traverse((obj) => {
      if (!(obj instanceof THREE.SkinnedMesh)) return
      const pos = obj.geometry.getAttribute('position')
      if (!pos) return
      let minY = Infinity
      for (let i = 0; i < pos.count; i += 1) {
        v.fromBufferAttribute(pos, i)
        obj.applyBoneTransform(i, v)
        obj.localToWorld(v)
        if (v.y < minY) minY = v.y
      }
      if (Number.isFinite(minY)) diag.push(Number(minY.toFixed(3)))
    })
    ;(window as unknown as { __diag?: unknown }).__diag = diag
    onDone(shots)
  })
  return null
}

function StagingShots(): JSX.Element {
  const state = React.useMemo(() => buildStagingScene(testCase.spec), [])
  const [shots, setShots] = React.useState<ShotMap | null>(null)
  React.useEffect(() => {
    if (shots) {
      ;(window as unknown as { __shots?: ShotMap }).__shots = shots
      ;(window as unknown as { __shotsReady?: boolean }).__shotsReady = true
    }
  }, [shots])
  return (
    <div style={{ padding: 12, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{testCase.id}</div>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>期望：{testCase.expect}</div>
      {/* 离屏渲染 Canvas（小窗即可，captureScene 用独立 RenderTarget 全分辨率出图） */}
      <div style={{ width: 320, height: 240, border: '1px solid #d8d2c8', borderRadius: 6, overflow: 'hidden' }}>
        <Canvas shadows gl={{ preserveDrawingBuffer: true, antialias: true }} camera={{ position: [4, 2.4, 5], fov: 45 }}>
          <color attach="background" args={[state.environment.backgroundColor]} />
          <ambientLight intensity={0.6} />
          {/* 顶光投影：脚/膝落地时影子贴住接触点、悬空则影子与人之间有缝——给子 agent 最硬的落地判据 */}
          <directionalLight
            position={[3, 9, 4]}
            intensity={1.0}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-left={-6}
            shadow-camera-right={6}
            shadow-camera-top={6}
            shadow-camera-bottom={-6}
            shadow-camera-near={0.1}
            shadow-camera-far={30}
          />
          <directionalLight position={[-4, 3, -3]} intensity={0.35} />
          {/* 诊断地面：淡网格 + 接收投影的平面，便于判悬空/陷地（hero 截图前会临时关掉） */}
          <group name="__stagingFloor" userData={{ __stagingFloor: true }}>
            <gridHelper args={[24, 24, '#b8b0a4', '#d8d2c8']} position={[0, 0.002, 0]} />
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow userData={{ __stagingFloor: true }}>
              <planeGeometry args={[24, 24]} />
              <meshStandardMaterial color="#efe9e0" />
            </mesh>
          </group>
          <MannequinAssetBoundary fallback={<ProceduralMannequin color="#808080" />}>
            <Suspense fallback={null}>
              <StagingObjects state={state} />
              <CaptureController state={state} onDone={setShots} />
            </Suspense>
          </MannequinAssetBoundary>
        </Canvas>
      </div>
      {shots ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {Object.entries(shots).map(([k, url]) => (
            <div key={k}>
              <div style={{ fontSize: 11, color: '#374151' }}>{k}</div>
              <img src={url} alt={k} style={{ width: 240, border: '1px solid #d8d2c8', borderRadius: 4 }} />
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 8 }}>rendering…</div>
      )}
    </div>
  )
}

createRoot(document.getElementById('staging-shots-root') as HTMLElement).render(<StagingShots />)
