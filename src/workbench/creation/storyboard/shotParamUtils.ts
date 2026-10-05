import type { ModelParameterControl } from '../../../config/modelCatalogMeta'

export function drawerShotParams(params: readonly ModelParameterControl[]): ModelParameterControl[] {
  return params.filter((p) => p.key !== 'duration' && p.key !== 'aspect_ratio')
}
