// 纯判据：不启动应用、不读凭据；输入来自本次隔离目录。
export const DEFAULT_MODEL_SPEND_CARD = '[data-v4-block="intervention"][data-kind="spend"]:visible'

export function selectDefaultImageModels(catalog, defaults = {}) {
  const vendors = new Set((catalog.vendors ?? []).filter(vendor => vendor.enabled !== false).map(vendor => vendor.key))
  const rows = (catalog.models ?? []).filter(model => model.kind === 'image' && model.enabled !== false
    && model.published !== false && vendors.has(model.vendorKey))
    .sort((left, right) => `${left.vendorKey}/${left.modelKey}`.localeCompare(`${right.vendorKey}/${right.modelKey}`))
  if (!rows.length) throw new Error('本次目录没有可用图片模型')
  const configured = defaults.byTaskKind?.text_to_image
  const selected = rows.find(row => row.vendorKey === configured?.vendorKey && row.modelKey === configured?.modelKey) ?? rows[0]
  const other = rows.find(row => row.vendorKey !== selected.vendorKey || row.modelKey !== selected.modelKey)
  const identity = row => row ? { vendorKey: row.vendorKey, modelKey: row.modelKey, label: row.labelZh ?? row.modelKey } : null
  return { imageDefault: identity(selected), imageOther: identity(other) }
}

export function observeDefaultModelTurn({ sent, cardVisible, turnRunning }) {
  return { settled: sent && (cardVisible || !turnRunning), cardShown: sent && cardVisible }
}
