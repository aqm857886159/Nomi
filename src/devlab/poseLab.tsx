// Pose Lab —— 仅 dev 的预设动作校准台（不进 prod 构建：vite build 只吃 index.html）。
// 复用 App 里同一套 Mannequin 组件 + 同一个 x-bot.glb + 同一套骨骼姿势数学，
// 所以这里渲染出来的姿势 === 3D 导演图里看到的姿势。以截图为准校准 MANNEQUIN_POSE_PRESETS。
// 支持任意方位角视角（front/side/q3 3/4 斜俯/back），图形沿「垂直于相机方位」的水平轴排开避免遮挡。
import React, { Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { Mannequin } from '../workbench/generationCanvas/nodes/scene3d/scene3dObjects'
import { MANNEQUIN_POSE_PRESETS } from '../workbench/generationCanvas/nodes/scene3d/scene3dConstants'

const D2R = Math.PI / 180

// probe 模式：?probe=ul,ll,ft[,spine,hipPitch]（度），对称作用到双腿，用于实证腿部骨骼轴向。
function probePose(): { pose: Record<string, [number, number, number]>; label: string } | null {
  const raw = params.get('probe')
  if (!raw) return null
  const [ul = 0, ll = 0, ft = 0, sp = 0, hip = 0] = raw.split(',').map((n) => Number(n) || 0)
  const pose: Record<string, [number, number, number]> = {
    mixamorigHips: [hip * D2R, 0, 0],
    mixamorigSpine: [sp * D2R, 0, 0],
    mixamorigLeftUpLeg: [ul * D2R, 0, 0],
    mixamorigRightUpLeg: [ul * D2R, 0, 0],
    mixamorigLeftLeg: [ll * D2R, 0, 0],
    mixamorigRightLeg: [ll * D2R, 0, 0],
    mixamorigLeftFoot: [ft * D2R, 0, 0],
    mixamorigRightFoot: [ft * D2R, 0, 0],
  }
  return { pose, label: `probe ul${ul} ll${ll} ft${ft} sp${sp} hip${hip}` }
}

// 手臂 probe：?aprobe=side,ax,ay,az,fx（side=L/R/B），其余手臂留默认（下垂）。用于实证手臂手势轴向。
function armProbePose(): { pose: Record<string, [number, number, number]>; label: string } | null {
  const raw = params.get('aprobe')
  if (!raw) return null
  const [side = 'R', ax = '0', ay = '0', az = '0', fx = '0'] = raw.split(',')
  const a: [number, number, number] = [Number(ax) * D2R, Number(ay) * D2R, Number(az) * D2R]
  const f: [number, number, number] = [Number(fx) * D2R, 0, 0]
  const pose: Record<string, [number, number, number]> = {}
  if (side === 'L' || side === 'B') { pose.mixamorigLeftArm = a; pose.mixamorigLeftForeArm = f }
  if (side === 'R' || side === 'B') { pose.mixamorigRightArm = [a[0], -a[1], -a[2]]; pose.mixamorigRightForeArm = f }
  return { pose, label: `aprobe ${side} a[${ax},${ay},${az}] f${fx}` }
}

type ViewSpec = { azDeg: number; elDeg: number }
const VIEWS: Record<string, ViewSpec> = {
  front: { azDeg: 0, elDeg: 0 },
  side: { azDeg: 90, elDeg: 0 },
  q3: { azDeg: 38, elDeg: 20 }, // 3/4 斜俯——揭示深度（正/侧面藏不住的腿前后、脚穿插）
  back: { azDeg: 180, elDeg: 0 },
  top: { azDeg: 0, elDeg: 88 }, // 顶视——读手臂/朝向在 XZ 平面的方位角
}

const params = new URLSearchParams(window.location.search)
const viewKey = params.get('view') ?? 'front'
const view: ViewSpec = VIEWS[viewKey] ?? VIEWS.front
const from = Number.parseInt(params.get('from') ?? '0', 10) || 0
const count = Number.parseInt(params.get('count') ?? '4', 10) || 4
const zoom = Number.parseInt(params.get('zoom') ?? '190', 10) || 190

const COLUMN_SPACING = 2.6
const FIGURE_COLOR = '#8a8f98'

const azRad = (view.azDeg * Math.PI) / 180
const elRad = (view.elDeg * Math.PI) / 180
// 垂直于相机方位的水平方向：图形沿它排开，从任意角度都不互相遮挡。
const spreadDir: [number, number, number] = [Math.cos(azRad), 0, -Math.sin(azRad)]

function CameraRig(): null {
  const camera = useThree((state) => state.camera)
  React.useLayoutEffect(() => {
    const d = 14
    camera.position.set(
      d * Math.sin(azRad) * Math.cos(elRad),
      d * Math.sin(elRad),
      d * Math.cos(azRad) * Math.cos(elRad),
    )
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }, [camera])
  return null
}

function PosedFigure({ offset, label }: { offset: number; label: string }): JSX.Element {
  const preset = MANNEQUIN_POSE_PRESETS.find((item) => item.label === label || item.id === label)
  const position: [number, number, number] = [spreadDir[0] * offset, 0, spreadDir[2] * offset]
  return (
    <group position={position}>
      <Mannequin color={FIGURE_COLOR} pose={preset?.pose} />
      <Html position={[0, 0.78, 0]} center style={{ pointerEvents: 'none' }}>
        <div
          style={{
            fontFamily: 'system-ui, sans-serif',
            fontSize: '13px',
            fontWeight: 600,
            color: '#1f2937',
            whiteSpace: 'nowrap',
            background: 'rgba(246,243,238,0.85)',
            padding: '2px 6px',
            borderRadius: '4px',
          }}
        >
          {`${preset?.id ?? '?'} · ${preset?.label ?? label}`}
        </div>
      </Html>
    </group>
  )
}

function ReadyBeacon(): null {
  React.useEffect(() => {
    const id = window.setTimeout(() => {
      ;(window as unknown as { __poseLabReady?: boolean }).__poseLabReady = true
    }, 1500)
    return () => window.clearTimeout(id)
  }, [])
  return null
}

function ProbeFigure(): JSX.Element | null {
  const probe = probePose() ?? armProbePose()
  if (!probe) return null
  return (
    <group position={[0, 0, 0]}>
      <Mannequin color={FIGURE_COLOR} pose={probe.pose} />
      <Html position={[0, 0.8, 0]} center style={{ pointerEvents: 'none' }}>
        <div style={{ fontFamily: 'monospace', fontSize: '12px', color: '#1f2937', whiteSpace: 'nowrap', background: 'rgba(246,243,238,0.85)', padding: '2px 6px', borderRadius: '4px' }}>{probe.label}</div>
      </Html>
    </group>
  )
}

function PoseLab(): JSX.Element {
  const presets = MANNEQUIN_POSE_PRESETS.slice(from, from + count)
  const start = -((presets.length - 1) * COLUMN_SPACING) / 2
  const probing = Boolean(params.get('probe') || params.get('aprobe'))
  if (probing) {
    return (
      <Canvas orthographic camera={{ zoom: 360, near: 0.01, far: 100, position: [0, 0, 14] }} gl={{ preserveDrawingBuffer: true, antialias: true }} style={{ height: '100vh', width: '100vw' }}>
        <color attach="background" args={['#f6f3ee']} />
        <ambientLight intensity={0.85} />
        <directionalLight position={[4, 6, 5]} intensity={1.1} />
        <directionalLight position={[-4, 3, -3]} intensity={0.4} />
        <gridHelper args={[40, 40, '#94a3b8', '#cbd5e1']} position={[0, -0.5, 0]} />
        <CameraRig />
        <Suspense fallback={null}><ProbeFigure /></Suspense>
        <ReadyBeacon />
      </Canvas>
    )
  }
  return (
    <Canvas
      orthographic
      camera={{ zoom, near: 0.01, far: 100, position: [0, 0, 14] }}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      style={{ height: '100vh', width: '100vw' }}
    >
      <color attach="background" args={['#f6f3ee']} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[4, 6, 5]} intensity={1.1} />
      <directionalLight position={[-4, 3, -3]} intensity={0.4} />
      <gridHelper args={[40, 40, '#94a3b8', '#cbd5e1']} position={[0, -0.5, 0]} />
      <CameraRig />
      <Suspense fallback={null}>
        {presets.map((preset, index) => (
          <PosedFigure key={preset.id} offset={start + index * COLUMN_SPACING} label={preset.id} />
        ))}
      </Suspense>
      <ReadyBeacon />
    </Canvas>
  )
}

createRoot(document.getElementById('pose-lab-root') as HTMLElement).render(
  <React.StrictMode>
    <PoseLab />
  </React.StrictMode>,
)
