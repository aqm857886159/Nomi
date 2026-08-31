import { isComfyuiVendorKey } from '../../workbench/generationCanvas/model/comfyuiVendor'
import type { ChipModel } from './ModelChipGroups'

type RequestScriptModel = Pick<ChipModel, 'vendorKey'>

export function canConfigureModelRequestScript(
  model: RequestScriptModel | null | undefined,
): boolean {
  return Boolean(model && !isComfyuiVendorKey(model.vendorKey))
}
