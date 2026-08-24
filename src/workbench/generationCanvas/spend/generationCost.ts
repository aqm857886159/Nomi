import type { ModelOption } from '../../../config/models'

export type GenerationCostEstimate = {
  amount: number
  unit: 'credits'
  source: 'catalog'
}

export type GenerationCostInput = {
  option: ModelOption | null | undefined
  params?: Record<string, unknown> | null
  multiplier?: number
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function addSelectedValue(keys: Set<string>, key: string, value: unknown): void {
  if (value === null || value === undefined) return
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim()
    if (!text) return
    keys.add(text)
    if (key) keys.add(`${key}:${text}`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item) => addSelectedValue(keys, key, item))
    return
  }
  if (typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([childKey, childValue]) => {
      addSelectedValue(keys, childKey, childValue)
    })
  }
}

function selectedSpecKeys(params: Record<string, unknown> | null | undefined): Set<string> {
  const keys = new Set<string>()
  Object.entries(params || {}).forEach(([key, value]) => addSelectedValue(keys, key, value))
  return keys
}

export function estimateGenerationCost(input: GenerationCostInput): GenerationCostEstimate | null {
  const pricing = input.option?.pricing
  if (!pricing || pricing.enabled !== true || !finiteNonNegative(pricing.cost)) return null
  const multiplier = input.multiplier === undefined ? 1 : input.multiplier
  if (!finiteNonNegative(multiplier) || multiplier < 1) return null
  const selected = selectedSpecKeys(input.params)
  let amount = pricing.cost
  for (const spec of pricing.specCosts || []) {
    if (spec.enabled !== true || !finiteNonNegative(spec.cost)) continue
    const specKey = String(spec.specKey || '').trim()
    if (specKey && selected.has(specKey)) amount += spec.cost
  }
  return { amount: amount * multiplier, unit: 'credits', source: 'catalog' }
}

export function estimateBatchGenerationCost(inputs: readonly GenerationCostInput[]): GenerationCostEstimate | null {
  if (inputs.length === 0) return null
  let amount = 0
  for (const input of inputs) {
    const estimate = estimateGenerationCost(input)
    if (!estimate) return null
    amount += estimate.amount
  }
  return { amount, unit: 'credits', source: 'catalog' }
}

export function formatGenerationCredits(amount: number): string {
  if (!finiteNonNegative(amount)) return ''
  return amount.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}
