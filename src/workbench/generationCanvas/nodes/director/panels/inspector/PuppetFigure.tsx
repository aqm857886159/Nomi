/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../utils/cn、../../model/ikChains 的 IkHandleKey、../../model/rigs 的 SemanticBone
 * [OUTPUT]: 对外提供 PuppetFigure：2D 骨骼人偶（SVG viewBox 250×300）——17 段骨骼画成两半明暗菱形（FK 页可点选、悬停高亮），
 *           IK 页画 7 个靶点圆 + 4 个极向量菱形（各带名字牌，极向量有琥珀虚连线），FK 页画 17 颗关节圆（头 / 脊柱 / 手 / 脚带名字牌）
 * [POS]: director/panels/inspector 的人偶图（清单 §4.1 骨骼页）：坐标、半径、名字牌偏移是固定表，只画与上报点击；
 *        选择态住 store.selection.ikTarget / boneKey；语义骨映射：spine → spine2、thigh → upLeg、shin → leg。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../../../../utils/cn'
import type { IkHandleKey } from '../../model/ikChains'
import type { SemanticBone } from '../../model/rigs'

type Point = { x: number; y: number }
type Mode = 'ik' | 'fk'

type BoneShape = { id: string; boneKey: SemanticBone; root: Point; tip: Point; leftPoly: string; rightPoly: string; fullPoly: string }

// 一段骨 = 根→尖，两侧各一片三角，最宽处在 22% 长度、半宽 = clamp(长度 × ratio, 4.5, max)
function boneShape(id: string, x1: number, y1: number, x2: number, y2: number, boneKey: SemanticBone, ratio = 0.16, max = 10): BoneShape {
  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.hypot(dx, dy)
  if (length === 0) return { id, boneKey, root: { x: x1, y: y1 }, tip: { x: x2, y: y2 }, leftPoly: '', rightPoly: '', fullPoly: '' }
  const ux = dx / length
  const uy = dy / length
  const nx = -uy
  const ny = ux
  const wx = x1 + ux * length * 0.22
  const wy = y1 + uy * length * 0.22
  const half = Math.min(max, Math.max(4.5, length * ratio))
  const lx = wx + nx * half
  const ly = wy + ny * half
  const rx = wx - nx * half
  const ry = wy - ny * half
  return {
    id,
    boneKey,
    root: { x: x1, y: y1 },
    tip: { x: x2, y: y2 },
    leftPoly: `${x1},${y1} ${lx.toFixed(1)},${ly.toFixed(1)} ${x2},${y2}`,
    rightPoly: `${x1},${y1} ${rx.toFixed(1)},${ry.toFixed(1)} ${x2},${y2}`,
    fullPoly: `${x1},${y1} ${lx.toFixed(1)},${ly.toFixed(1)} ${x2},${y2} ${rx.toFixed(1)},${ry.toFixed(1)}`,
  }
}

// 17 段骨（正面，角色右侧在图左）
const BONES: BoneShape[] = [
  boneShape('spine-pelvis', 125, 136, 125, 96, 'spine2', 0.18, 11),
  boneShape('neck-spine', 125, 96, 125, 62, 'neck', 0.16, 9),
  boneShape('head-neck', 125, 62, 125, 34, 'head', 0.22, 10),
  boneShape('neck-rShoulder', 125, 62, 92, 66, 'rightShoulder', 0.16, 8),
  boneShape('rShoulder-rArm', 92, 66, 70, 106, 'rightArm', 0.17, 10),
  boneShape('rArm-rForearm', 70, 106, 54, 144, 'rightForeArm', 0.15, 8.5),
  boneShape('rForearm-rHand', 54, 144, 46, 168, 'rightHand', 0.18, 7.5),
  boneShape('neck-lShoulder', 125, 62, 158, 66, 'leftShoulder', 0.16, 8),
  boneShape('lShoulder-lArm', 158, 66, 180, 106, 'leftArm', 0.17, 10),
  boneShape('lArm-lForearm', 180, 106, 196, 144, 'leftForeArm', 0.15, 8.5),
  boneShape('lForearm-lHand', 196, 144, 204, 168, 'leftHand', 0.18, 7.5),
  boneShape('pelvis-rThigh', 125, 136, 104, 148, 'rightUpLeg', 0.18, 9),
  boneShape('rThigh-rShin', 104, 148, 96, 210, 'rightLeg', 0.16, 11),
  boneShape('rShin-rFoot', 96, 210, 90, 268, 'rightFoot', 0.15, 10),
  boneShape('pelvis-lThigh', 125, 136, 146, 148, 'leftUpLeg', 0.18, 9),
  boneShape('lThigh-lShin', 146, 148, 154, 210, 'leftLeg', 0.16, 11),
  boneShape('lShin-lFoot', 154, 210, 160, 268, 'leftFoot', 0.15, 10),
]

// IK 靶点（圆）+ 名字牌
const IK_TARGET_DOTS: Array<{ key: IkHandleKey; x: number; y: number; r: number; labelOffsetX: number; labelOffsetY: number; badgeWidth: number }> = [
  { key: 'head', x: 125, y: 34, r: 8.5, labelOffsetX: 0, labelOffsetY: -17, badgeWidth: 26 },
  { key: 'chest', x: 125, y: 96, r: 7.5, labelOffsetX: 22, labelOffsetY: 0, badgeWidth: 26 },
  { key: 'pelvis', x: 125, y: 136, r: 9.5, labelOffsetX: 0, labelOffsetY: 20, badgeWidth: 28 },
  { key: 'rightHand', x: 46, y: 168, r: 8, labelOffsetX: -1, labelOffsetY: 16, badgeWidth: 26 },
  { key: 'leftHand', x: 204, y: 168, r: 8, labelOffsetX: 1, labelOffsetY: 16, badgeWidth: 26 },
  { key: 'rightFoot', x: 90, y: 268, r: 8, labelOffsetX: -1, labelOffsetY: 17, badgeWidth: 26 },
  { key: 'leftFoot', x: 160, y: 268, r: 8, labelOffsetX: 1, labelOffsetY: 17, badgeWidth: 26 },
]
// 极向量（菱形）+ 名字牌，连线从肘 / 膝关节引出
const IK_POLE_DOTS: Array<{ key: IkHandleKey; x: number; y: number; labelX: number; labelY: number; from: Point }> = [
  { key: 'rightElbowPole', x: 26, y: 106, labelX: 26, labelY: 121, from: { x: 70, y: 106 } },
  { key: 'leftElbowPole', x: 224, y: 106, labelX: 224, labelY: 121, from: { x: 180, y: 106 } },
  { key: 'rightKneePole', x: 56, y: 210, labelX: 56, labelY: 225, from: { x: 96, y: 210 } },
  { key: 'leftKneePole', x: 194, y: 210, labelX: 194, labelY: 225, from: { x: 154, y: 210 } },
]
// FK 关节（圆），头 / 脊柱 / 手 / 脚带名字牌
const FK_JOINT_DOTS: Array<{ key: SemanticBone; x: number; y: number; r: number; label?: boolean; labelOffsetX?: number; labelOffsetY?: number; badgeWidth?: number }> = [
  { key: 'head', x: 125, y: 34, r: 7.5, label: true, labelOffsetY: -16, badgeWidth: 24 },
  { key: 'neck', x: 125, y: 62, r: 5.5 },
  { key: 'spine2', x: 125, y: 96, r: 6.5, label: true, labelOffsetX: 22, labelOffsetY: 0, badgeWidth: 24 },
  { key: 'rightShoulder', x: 92, y: 66, r: 5.5 },
  { key: 'rightArm', x: 70, y: 106, r: 6 },
  { key: 'rightForeArm', x: 54, y: 144, r: 5.5 },
  { key: 'rightHand', x: 46, y: 168, r: 6.5, label: true, labelOffsetY: 16, badgeWidth: 24 },
  { key: 'leftShoulder', x: 158, y: 66, r: 5.5 },
  { key: 'leftArm', x: 180, y: 106, r: 6 },
  { key: 'leftForeArm', x: 196, y: 144, r: 5.5 },
  { key: 'leftHand', x: 204, y: 168, r: 6.5, label: true, labelOffsetY: 16, badgeWidth: 24 },
  { key: 'rightUpLeg', x: 104, y: 148, r: 6 },
  { key: 'rightLeg', x: 96, y: 210, r: 6 },
  { key: 'rightFoot', x: 90, y: 268, r: 6.5, label: true, labelOffsetY: 16, badgeWidth: 24 },
  { key: 'leftUpLeg', x: 146, y: 148, r: 6 },
  { key: 'leftLeg', x: 154, y: 210, r: 6 },
  { key: 'leftFoot', x: 160, y: 268, r: 6.5, label: true, labelOffsetY: 16, badgeWidth: 24 },
]

function Badge({ x, y, width, text, active }: { x: number; y: number; width: number; text: string; active: boolean }): JSX.Element {
  return (
    <g transform={`translate(${x}, ${y})`} className="pointer-events-none">
      <rect x={-width / 2} y={-6} width={width} height={12} rx={3} className={cn(active ? 'fill-nomi-warning stroke-nomi-paper' : 'fill-nomi-ink/85 stroke-nomi-paper/15')} strokeWidth={0.75} />
      <text x={0} y={3} textAnchor="middle" fontSize={7.5} className={cn('select-none font-nomi-mono font-medium', active ? 'fill-nomi-ink' : 'fill-nomi-paper/85')}>
        {text}
      </text>
    </g>
  )
}

export function PuppetFigure({
  mode,
  selectedHandle,
  selectedJoint,
  onPickHandle,
  onPickJoint,
}: {
  mode: Mode
  selectedHandle: IkHandleKey | null
  selectedJoint: SemanticBone | null
  onPickHandle: (key: IkHandleKey) => void
  onPickJoint: (bone: SemanticBone) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [hoverBone, setHoverBone] = React.useState<SemanticBone | null>(null)
  const [hoverHandle, setHoverHandle] = React.useState<IkHandleKey | null>(null)
  const fk = mode === 'fk'
  return (
    <svg viewBox="0 0 250 300" className="mx-auto block h-[280px] w-auto max-w-full select-none overflow-visible" role="img" aria-label={t('director.character.puppetAria')}>
      {/* 骨骼：两片明暗三角 + 中线；FK 页可点（透明宽命中区），IK 页压暗不可点 */}
      <g className={fk ? '' : 'pointer-events-none opacity-80'}>
        {BONES.map((bone) => {
          const active = fk && selectedJoint === bone.boneKey
          const hover = fk && hoverBone === bone.boneKey
          return (
            <g
              key={bone.id}
              className={fk ? 'cursor-pointer' : ''}
              onClick={() => fk && onPickJoint(bone.boneKey)}
              onMouseEnter={() => setHoverBone(bone.boneKey)}
              onMouseLeave={() => setHoverBone(null)}
            >
              <polygon points={bone.leftPoly} className={cn(active ? 'fill-workbench-success/60 stroke-workbench-success' : hover ? 'fill-nomi-ink-30 stroke-nomi-ink-60' : 'fill-nomi-ink-20 stroke-nomi-ink-40')} strokeWidth={0.75} strokeLinejoin="round" />
              <polygon points={bone.rightPoly} className={cn(active ? 'fill-workbench-success/35 stroke-workbench-success' : hover ? 'fill-nomi-ink-20 stroke-nomi-ink-40' : 'fill-nomi-ink-10 stroke-nomi-ink-30')} strokeWidth={0.75} strokeLinejoin="round" />
              <line x1={bone.root.x} y1={bone.root.y} x2={bone.tip.x} y2={bone.tip.y} className={cn(active ? 'stroke-nomi-paper' : hover ? 'stroke-nomi-ink-80' : 'stroke-nomi-ink-40')} strokeWidth={active ? 1.2 : 0.7} strokeLinecap="round" strokeOpacity={0.8} />
              {fk ? <polygon points={bone.fullPoly} fill="transparent" stroke="transparent" strokeWidth={12} /> : null}
            </g>
          )
        })}
      </g>
      {mode === 'ik' ? (
        <g>
          {IK_POLE_DOTS.map((pole) => (
            <line key={`${pole.key}-line`} x1={pole.from.x} y1={pole.from.y} x2={pole.x} y2={pole.y} className="stroke-nomi-warning/40" strokeWidth={1.2} strokeLinecap="round" />
          ))}
          {IK_POLE_DOTS.map((pole) => {
            const active = selectedHandle === pole.key
            const hover = hoverHandle === pole.key
            return (
              <g key={pole.key} className="cursor-pointer" onClick={() => onPickHandle(pole.key)} onMouseEnter={() => setHoverHandle(pole.key)} onMouseLeave={() => setHoverHandle(null)}>
                <title>{t(`director.character.handle.${pole.key}`)}</title>
                {active ? <circle cx={pole.x} cy={pole.y} r={13} className="fill-nomi-warning/25 stroke-nomi-warning" strokeWidth={1.5} /> : null}
                <polygon
                  points={`${pole.x},${pole.y - 7.5} ${pole.x + 7.5},${pole.y} ${pole.x},${pole.y + 7.5} ${pole.x - 7.5},${pole.y}`}
                  className={cn(active ? 'fill-nomi-warning stroke-nomi-paper' : hover ? 'fill-nomi-warning/80 stroke-nomi-warning' : 'fill-nomi-ink stroke-nomi-warning/80')}
                  strokeWidth={1.5}
                />
                <circle cx={pole.x} cy={pole.y} r={2} className={active ? 'fill-nomi-ink' : 'fill-nomi-warning'} />
                <Badge x={pole.labelX} y={pole.labelY} width={28} text={t(`director.character.handleShort.${pole.key}`)} active={active} />
                <circle cx={pole.x} cy={pole.y} r={16} fill="transparent" />
              </g>
            )
          })}
          {IK_TARGET_DOTS.map((dot) => {
            const active = selectedHandle === dot.key
            const hover = hoverHandle === dot.key
            return (
              <g key={dot.key} className="cursor-pointer" onClick={() => onPickHandle(dot.key)} onMouseEnter={() => setHoverHandle(dot.key)} onMouseLeave={() => setHoverHandle(null)}>
                <title>{t(`director.character.handle.${dot.key}`)}</title>
                {active ? <circle cx={dot.x} cy={dot.y} r={dot.r + 6} className="fill-nomi-warning/30 stroke-nomi-warning" strokeWidth={2} /> : null}
                <circle cx={dot.x} cy={dot.y} r={dot.r} className={cn(active ? 'fill-nomi-warning stroke-nomi-paper' : hover ? 'fill-nomi-warning/70 stroke-nomi-warning' : 'fill-nomi-ink stroke-nomi-warning')} strokeWidth={active ? 2 : 1.5} />
                <circle cx={dot.x} cy={dot.y} r={dot.r * 0.35} className={active ? 'fill-nomi-ink' : 'fill-nomi-warning'} />
                <Badge x={dot.x + dot.labelOffsetX} y={dot.y + dot.labelOffsetY} width={dot.badgeWidth} text={t(`director.character.handleShort.${dot.key}`)} active={active} />
                <circle cx={dot.x} cy={dot.y} r={dot.r + 8} fill="transparent" />
              </g>
            )
          })}
        </g>
      ) : (
        <g>
          {FK_JOINT_DOTS.map((joint) => {
            const active = selectedJoint === joint.key
            const hover = hoverBone === joint.key
            return (
              <g key={joint.key} className="cursor-pointer" onClick={() => onPickJoint(joint.key)} onMouseEnter={() => setHoverBone(joint.key)} onMouseLeave={() => setHoverBone(null)}>
                <title>{t(`director.character.joint.${joint.key}`)}</title>
                {active ? <circle cx={joint.x} cy={joint.y} r={joint.r + 5} className="fill-workbench-success/25 stroke-workbench-success" strokeWidth={1.5} /> : null}
                <circle cx={joint.x} cy={joint.y} r={joint.r} className={cn(active ? 'fill-workbench-success stroke-nomi-paper' : hover ? 'fill-workbench-success/60 stroke-workbench-success' : 'fill-nomi-ink stroke-nomi-ink-60')} strokeWidth={active ? 2 : 1.2} />
                <circle cx={joint.x} cy={joint.y} r={joint.r * 0.35} className={active ? 'fill-nomi-ink' : 'fill-nomi-ink-60'} />
                {joint.label ? <Badge x={joint.x + (joint.labelOffsetX ?? 0)} y={joint.y + (joint.labelOffsetY ?? 0)} width={joint.badgeWidth ?? 24} text={t(`director.character.jointShort.${joint.key}`)} active={active} /> : null}
                <circle cx={joint.x} cy={joint.y} r={joint.r + 7} fill="transparent" />
              </g>
            )
          })}
        </g>
      )}
    </svg>
  )
}
