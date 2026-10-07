/**
 * [INPUT]: 依赖 ./directorTypes 的 DirectorScene / Vec3、./sceneObjectGraph 的 sceneFrame / transformPoint、./vec3 的 lookAtAngles
 * [OUTPUT]: 对外提供 directorOverviewPose：导演视图进场时自由相机的「看全场」位姿（世界坐标）；空场景返回 null（沿用自由相机默认位）
 * [POS]: 导演视图（3D-BOX）视口可读（方案 §7 第 7 条）的取景一环：从自由相机默认那一侧（+Z）、抬高约 35° 俯看，
 *        让人一眼看到谁在哪、往哪走。取景围着角色 / 道具，场景件只当背景。纯函数，只读工程数据；不写工程、不进撤销栈。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { DirectorScene, Vec3 } from './directorTypes'
import { sceneFrame, transformPoint } from './sceneObjectGraph'
import { lookAtAngles } from './vec3'

export type OverviewPose = { position: Vec3; yaw: number; pitch: number; roll: number; fov: number }

const OVERVIEW_FOV = 50
const OVERVIEW_ELEVATION_DEG = 35
const MIN_RADIUS = 3
/** 留白：包围球半径按视场正好装下之外再退这么多倍，四周不贴边。 */
const MARGIN = 1.35

export function directorOverviewPose(scene: DirectorScene): OverviewPose | null {
  const frame = sceneFrame(scene.sceneConfig)
  // 取景围着「演的东西」（角色 / 道具），场景件（编译器标 isAuxiliary 的地面、墙、门）只当背景，不撑大取景
  const visible = scene.objects.filter((object) => object.visible && !object.parentId)
  const actors = visible.filter((object) => !object.isAuxiliary)
  const points = (actors.length ? actors : visible).map((object) => transformPoint(frame, object.position))
  if (points.length === 0) return null
  const min = { x: Math.min(...points.map((p) => p.x)), y: Math.min(...points.map((p) => p.y)), z: Math.min(...points.map((p) => p.z)) }
  const max = { x: Math.max(...points.map((p) => p.x)), y: Math.max(...points.map((p) => p.y)), z: Math.max(...points.map((p) => p.z)) }
  const center = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 }
  const radius = Math.max(MIN_RADIUS, Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z) / 2)
  // 从自由相机默认的那一侧（+Z，与精修里「重置视角」同一侧）看：场景模板的背景墙在 -Z，人站在墙前，从 +Z 看不被墙挡。
  // 2026-10-04 实验室格子实测过「从机位平均方向看」：庭院题的机位在门洞两侧，那一侧正好隔着院墙，人被墙挡住，弃用。
  const dirX = 0
  const dirZ = 1
  const distance = (radius / Math.sin((OVERVIEW_FOV / 2) * Math.PI / 180)) * MARGIN
  const elevation = OVERVIEW_ELEVATION_DEG * Math.PI / 180
  const position = {
    x: center.x + dirX * distance * Math.cos(elevation),
    y: center.y + distance * Math.sin(elevation),
    z: center.z + dirZ * distance * Math.cos(elevation),
  }
  return { position, ...lookAtAngles(position, center), fov: OVERVIEW_FOV }
}
