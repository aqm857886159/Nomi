/**
 * [INPUT]: curator-owned asset records
 * [OUTPUT]: typed catalog records and planner projection
 * [POS]: director/model assetCatalog, additive inventory for the later runtime cutover PR
 */
export type AssetKind = 'action' | 'pose' | 'prop' | 'setPiece'
export type LicenseKind = 'CC0-1.0' | 'MIT' | 'pending-review'
export type AssetSizeClass = 'tiny' | 'small' | 'medium' | 'large'

export type AssetDimensions = { widthM: number; depthM: number; heightM: number }
export type AssetOrigin = 'ground-center' | 'ground-min-corner' | 'ground-min-z' | 'rig-root'

export type AssetRecord = {
  id: string
  kind: AssetKind
  tags: string[]
  nameZh: string
  nameEn: string
  sizeClass: AssetSizeClass
  dimensionsM?: AssetDimensions
  origin: AssetOrigin
  anchors?: string[]
  file: string
  source: string
  license: LicenseKind
  modified: boolean
  clipName?: string
  derivativeFile?: string
  rig?: 'mixamo' | 'ue4' | 'ual' | 'none'
  durationSec?: number
  loop?: boolean
  rootMotion?: boolean
  requiresStanding?: boolean
  inspection?: string
}

export type PlannerAsset = Pick<AssetRecord, 'id' | 'kind' | 'tags' | 'nameZh' | 'nameEn' | 'sizeClass'> & {
  dimensionsLevel: 'character' | 'handheld' | 'room' | 'street' | 'building' | 'animation'
}
