import type { DirectorObject } from '../directorTypes'

type Template = 'street' | 'room' | 'courtyard' | 'product_stage'
const object = (id: string, name: string, type: DirectorObject['type'], position: { x: number; y: number; z: number }, scale: { x: number; y: number; z: number }, color = '#94a3b8'): DirectorObject => ({ id, name, type, position, rotation: { x: 0, y: 0, z: 0 }, scale, color, visible: true, locked: true, isAuxiliary: true })
const block = (id: string, name: string, position: { x: number; y: number; z: number }, scale: { x: number; y: number; z: number }, color?: string) => object(id, name, 'cube', position, scale, color)

/** S1-only template adapter. Existing street/room builders remain untouched; these objects preserve their semantic layout. */
export function buildS1TemplateObjects(template: Template): DirectorObject[] {
  if (template === 'courtyard') return [
    block('s1-courtyard-ground', 'ground', { x: 0, y: 0.025, z: 0 }, { x: 18, y: 0.05, z: 18 }, '#64748b'),
    block('s1-courtyard-wall-north', 'wall_enclosure', { x: 0, y: 2, z: -8 }, { x: 16, y: 4, z: 0.3 }, '#a8a29e'),
    block('s1-courtyard-wall-east', 'wall east', { x: 8, y: 2, z: 0 }, { x: 0.3, y: 4, z: 16 }, '#a8a29e'),
    block('s1-courtyard-gate', 'gate', { x: 0, y: 1.2, z: -7.7 }, { x: 2.5, y: 2.4, z: 0.35 }, '#78350f'),
    object('s1-courtyard-tree', 'courtyard tree', 'cylinder', { x: -5, y: 1.5, z: -4 }, { x: 1.2, y: 3, z: 1.2 }, '#166534'),
  ]
  if (template === 'product_stage') return [
    block('s1-product-ground', 'ground', { x: 0, y: 0.025, z: 0 }, { x: 14, y: 0.05, z: 14 }, '#e2e8f0'),
    block('s1-product-backdrop', 'wall backdrop', { x: 0, y: 3, z: -5 }, { x: 12, y: 6, z: 0.2 }, '#f8fafc'),
    object('s1-product-pedestal', 'round_pedestal', 'cylinder', { x: 0, y: 0.5, z: 0 }, { x: 0.8, y: 1, z: 0.8 }, '#cbd5e1'),
  ]
  if (template === 'room') return [
    block('s1-room-floor', 'ground', { x: 0, y: 0.025, z: 0 }, { x: 10, y: 0.05, z: 8 }, '#a8a29e'),
    block('s1-room-back', 'wall back', { x: 0, y: 2, z: -4 }, { x: 10, y: 4, z: 0.2 }, '#d6d3d1'),
    block('s1-room-left', 'wall left', { x: -5, y: 2, z: 0 }, { x: 0.2, y: 4, z: 8 }, '#d6d3d1'),
  ]
  return [
    block('s1-street-ground', 'ground', { x: 0, y: 0.025, z: 0 }, { x: 10, y: 0.05, z: 30 }, '#475569'),
    block('s1-street-road-left', 'road', { x: -7, y: 0.1, z: 0 }, { x: 3, y: 0.2, z: 30 }, '#a8a29e'),
    block('s1-street-road-right', 'road', { x: 7, y: 0.1, z: 0 }, { x: 3, y: 0.2, z: 30 }, '#a8a29e'),
    block('s1-street-building-left', 'buildings_both_sides', { x: -10, y: 3, z: 0 }, { x: 2, y: 6, z: 30 }, '#334155'),
    block('s1-street-building-right', 'buildings_both_sides', { x: 10, y: 3, z: 0 }, { x: 2, y: 6, z: 30 }, '#334155'),
  ]
}

export type S1Template = Template
