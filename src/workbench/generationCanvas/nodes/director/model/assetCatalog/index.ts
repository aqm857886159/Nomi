/**
 * [INPUT]: additive Director A asset files
 * [OUTPUT]: curated catalog plus planner-safe compact projection
 * [POS]: single owner for the pre-cutover 3D-BOX inventory; runtime wiring is intentionally deferred
 */
import type { AssetRecord, PlannerAsset } from './types'
import { STORYAI_POSES } from './staticPoses'
import { UAL_ACTIONS, UAL_MANNEQUIN_FILE, UAL_MANNEQUIN_HEIGHT_M } from './ualActions'

const sourceQuaternius = 'https://opengameart.org/content/universal-animation-library'
const sourceKenneyRoads = 'https://kenney.nl/assets/city-kit-roads'
const sourceKenneyCar = 'https://kenney.nl/assets/car-kit'
const sourceKenneyFurniture = 'https://kenney.nl/assets/furniture-kit'
const sourceKenneyBuilding = 'https://kenney.nl/assets/building-kit'

const action = (meta: (typeof UAL_ACTIONS)[number]): AssetRecord => ({
  id: `action-ual-${meta.id.toLowerCase().replace(/_/g, '-')}`, kind: 'action', tags: meta.tags, nameZh: meta.nameZh, nameEn: meta.nameEn, sizeClass: 'tiny', dimensionsM: { widthM: 1.9444, depthM: 0.3696, heightM: UAL_MANNEQUIN_HEIGHT_M }, origin: 'ground-min-z', file: UAL_MANNEQUIN_FILE, source: sourceQuaternius, license: 'CC0-1.0', modified: true, clipName: meta.id, rig: 'ual', durationSec: meta.durationSec, loop: meta.loop, rootMotion: meta.rootMotion, requiresStanding: meta.requiresStanding, inspection: meta.inspection,
})

const prop = (id: string, file: string, tags: string[], zh: string, en: string, dimensionsM: [number, number, number], source: string): AssetRecord => ({
  id, kind: 'prop', tags, nameZh: zh, nameEn: en, sizeClass: dimensionsM[2] > 2 ? 'large' : dimensionsM[0] > 0.8 ? 'medium' : 'small', dimensionsM: { widthM: dimensionsM[0], depthM: dimensionsM[1], heightM: dimensionsM[2] }, origin: 'ground-center', file, source, license: 'CC0-1.0', modified: true,
})

export const DIRECTOR_ASSET_CATALOG: AssetRecord[] = [
  ...UAL_ACTIONS.map(action),
  ...STORYAI_POSES,
  prop('prop-road-straight', 'src/assets/director/props/kenney-road-straight.glb', ['road', 'straight', 'street'], '直路', 'Straight road', [1, 1, 0.02], sourceKenneyRoads),
  prop('prop-road-crossroad', 'src/assets/director/props/kenney-road-crossroad.glb', ['road', 'crossroad', 'intersection'], '十字路口', 'Crossroad', [1, 1, 0.02], sourceKenneyRoads),
  prop('prop-road-intersection', 'src/assets/director/props/kenney-road-intersection.glb', ['road', 'intersection', 'street'], '道路交汇', 'Road intersection', [1, 1, 0.02], sourceKenneyRoads),
  prop('prop-streetlight', 'src/assets/director/props/kenney-streetlight-square.glb', ['street', 'light', 'lamp'], '方形路灯', 'Square street light', [0.05, 0.2375, 0.6], sourceKenneyRoads),
  prop('prop-traffic-light', 'src/assets/director/props/kenney-traffic-light.glb', ['street', 'traffic-light', 'signal'], '交通信号灯', 'Traffic light', [0.1176, 0.09, 0.515], sourceKenneyRoads),
  prop('prop-ambulance', 'src/assets/director/props/kenney-ambulance.glb', ['vehicle', 'ambulance', 'emergency'], '救护车', 'Ambulance', [1.5, 1.8, 3.25], sourceKenneyCar),
  prop('prop-police-car', 'src/assets/director/props/kenney-police-car.glb', ['vehicle', 'police', 'emergency'], '警车', 'Police car', [1.5, 1.3, 3.0907], sourceKenneyCar),
  prop('prop-taxi', 'src/assets/director/props/kenney-taxi.glb', ['vehicle', 'taxi', 'car'], '出租车', 'Taxi', [1.5, 1.5, 2.75], sourceKenneyCar),
  prop('prop-chair', 'src/assets/director/props/kenney-chair.glb', ['furniture', 'chair', 'interior'], '椅子', 'Chair', [0.2, 0.2, 0.47], sourceKenneyFurniture),
  prop('prop-table', 'src/assets/director/props/kenney-table.glb', ['furniture', 'table', 'interior'], '桌子', 'Table', [0.8415, 0.4474, 0.3267], sourceKenneyFurniture),
  prop('prop-kitchen-stove', 'src/assets/director/props/kenney-kitchen-stove.glb', ['furniture', 'kitchen', 'stove'], '厨房灶台', 'Kitchen stove', [0.43, 0.45, 0.45], sourceKenneyFurniture),
  prop('prop-kitchen-fridge', 'src/assets/director/props/kenney-kitchen-fridge.glb', ['furniture', 'kitchen', 'fridge'], '厨房冰箱', 'Kitchen fridge', [0.43, 0.2919, 0.92], sourceKenneyFurniture),
  prop('set-wall', 'src/assets/director/props/kenney-wall.glb', ['set-piece', 'building', 'wall'], '墙体', 'Wall', [0.1, 2, 2.4], sourceKenneyBuilding),
  prop('set-wall-doorway', 'src/assets/director/props/kenney-wall-doorway.glb', ['set-piece', 'building', 'doorway'], '带门墙体', 'Wall doorway', [0.2, 2, 2.4], sourceKenneyBuilding),
  prop('set-door-square', 'src/assets/director/props/kenney-door-square.glb', ['set-piece', 'building', 'door'], '方门', 'Square door', [0.3943, 0.9183, 2.1], sourceKenneyBuilding),
  prop('set-roof-flat', 'src/assets/director/props/kenney-roof-flat.glb', ['set-piece', 'building', 'roof'], '平屋顶', 'Flat roof', [2.3945, 2.3945, 0.4], sourceKenneyBuilding),
]

const level = (asset: AssetRecord): PlannerAsset['dimensionsLevel'] => asset.kind === 'action' || asset.kind === 'pose' ? 'animation' : asset.kind === 'setPiece' ? 'building' : (asset.dimensionsM?.heightM ?? 0) > 2 ? 'street' : (asset.dimensionsM?.widthM ?? 0) > 0.8 ? 'room' : 'handheld'
export const DIRECTOR_PLANNER_ASSETS: PlannerAsset[] = DIRECTOR_ASSET_CATALOG.map(({ dimensionsM: _dimensionsM, file: _file, source: _source, license: _license, modified: _modified, anchors: _anchors, origin: _origin, clipName: _clipName, derivativeFile: _derivativeFile, rig: _rig, durationSec: _durationSec, loop: _loop, rootMotion: _rootMotion, requiresStanding: _requiresStanding, inspection: _inspection, ...asset }) => ({ ...asset, dimensionsLevel: level(DIRECTOR_ASSET_CATALOG.find((entry) => entry.id === asset.id)!)}))

export function findDirectorAsset(id: string): AssetRecord | undefined { return DIRECTOR_ASSET_CATALOG.find((asset) => asset.id === id) }
