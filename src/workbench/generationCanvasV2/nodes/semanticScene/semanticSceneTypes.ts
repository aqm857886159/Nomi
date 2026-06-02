export type SemanticSceneSourceType = 'panorama' | 'image' | 'multi_view' | 'manual'
export type SemanticSceneClass = 'indoor_architecture' | 'outdoor_open' | 'mixed' | 'unknown'
export type SemanticSceneCoordinateSystem = 'relative' | 'meters_estimated'

export type SemanticSceneVector2 = [number, number]
export type SemanticSceneVector3 = [number, number, number]

export type SemanticSceneSpace = {
  id: string
  name: string
  type: 'room' | 'area' | 'path' | 'plaza' | 'terrain' | 'unknown'
  floorPolygon?: SemanticSceneVector2[]
  approximateSize?: SemanticSceneVector2
  confidence?: number
}

export type SemanticSceneBoundary = {
  id: string
  name: string
  kind: 'wall' | 'facade' | 'fence' | 'edge' | 'terrain_edge' | 'unknown'
  start?: SemanticSceneVector2
  end?: SemanticSceneVector2
  positionHint?: string
  height?: number
  thickness?: number
  material?: string
  color?: string
  confidence?: number
}

export type SemanticSceneOpening = {
  id: string
  name: string
  kind: 'door' | 'window' | 'archway' | 'unknown'
  boundaryId?: string
  position?: SemanticSceneVector2
  positionHint?: string
  width?: number
  height?: number
  sillHeight?: number
  confidence?: number
}

export type SemanticSceneSurface = {
  id: string
  name: string
  kind: 'floor' | 'ceiling' | 'wall' | 'ground' | 'sky' | 'water' | 'unknown'
  polygon?: SemanticSceneVector2[]
  material?: string
  color?: string
  confidence?: number
}

export type SemanticSceneObject = {
  id: string
  name: string
  kind:
    | 'furniture'
    | 'prop'
    | 'vegetation'
    | 'vehicle'
    | 'person'
    | 'light'
    | 'building'
    | 'landform'
    | 'unknown'
  position?: SemanticSceneVector3
  positionHint?: string
  size?: SemanticSceneVector3
  rotationY?: number
  material?: string
  color?: string
  confidence?: number
}

export type SemanticSceneLighting = {
  timeOfDay?: string
  mood?: string
  mainDirection?: string
  softness?: 'hard' | 'medium' | 'soft' | 'unknown'
  color?: string
}

export type SemanticSceneCamera = {
  id: string
  name: string
  position?: SemanticSceneVector3
  target?: SemanticSceneVector3
  fov?: number
  aspectRatio?: '16:9' | '9:16' | '4:3' | '3:4' | '1:1'
}

export type SemanticSceneGraph = {
  spaces: SemanticSceneSpace[]
  boundaries: SemanticSceneBoundary[]
  openings: SemanticSceneOpening[]
  surfaces: SemanticSceneSurface[]
  objects: SemanticSceneObject[]
  lighting: SemanticSceneLighting
  cameras: SemanticSceneCamera[]
  uncertainties: string[]
}

export type SemanticScene = {
  version: '1.0'
  sourceType: SemanticSceneSourceType
  sceneClass: SemanticSceneClass
  confidence: number
  coordinateSystem: SemanticSceneCoordinateSystem
  sourceNodeId?: string
  sourceImageUrls: string[]
  scaleHint?: string
  graph: SemanticSceneGraph
  createdAt: number
  updatedAt: number
}

export type SemanticSceneSummary = {
  spaces: number
  boundaries: number
  openings: number
  surfaces: number
  objects: number
  cameras: number
  uncertainties: number
}
