import { evaluateHistoricalRatchet } from './check-vocabularies.mjs'

export const CANONICAL_ROLES = new Set([
  'canonical_input_schema_owner',
  'canonical_output_schema_owner',
  'safe_projector',
  'canonical_id_owner',
  'pi_alias_owner',
  'mcp_alias_owner',
  'canonical_effect_owner',
])

const DEBT_ROLES = new Set([
  'legacy_authority_exposure_debt',
  'renderer_environment_execution_seam',
  'main_gateway_route_execution_seam',
])

export function entryKey(value) {
  return `${value.file}\u0000${value.symbol}\u0000${value.role}\u0000${value.deleteIn ?? ''}`
}

export function factSite(value) {
  return `${value.file}::${value.symbol}::${value.role}`
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function validateBaseline(baseline) {
  const failures = []
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) return ['baseline root must be an object']
  if (baseline.version !== 1) failures.push('baseline.version must equal 1')
  if (!Array.isArray(baseline.entries)) return [...failures, 'baseline.entries must be an array']
  const seen = new Set()
  for (const [index, value] of baseline.entries.entries()) {
    const label = `entries[${index}]`
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      failures.push(`${label} must be an object`)
      continue
    }
    const keys = Object.keys(value).sort()
    if (!sameStrings(keys, ['deleteIn', 'file', 'role', 'symbol'])) {
      failures.push(`${label} must contain exactly file, symbol, role, deleteIn`)
      continue
    }
    if (![value.file, value.symbol, value.role].every((field) => typeof field === 'string' && field.trim())) {
      failures.push(`${label} file/symbol/role must be non-empty strings`)
    }
    if (value.deleteIn !== null && value.deleteIn !== 'Slice B') {
      failures.push(`${label}.deleteIn must be null or Slice B`)
    }
    if (CANONICAL_ROLES.has(value.role) && value.deleteIn !== null) {
      failures.push(`${label} canonical owner cannot be debt`)
    }
    if (DEBT_ROLES.has(value.role) && value.deleteIn !== 'Slice B') {
      failures.push(`${label} Slice A debt must delete in Slice B`)
    }
    if (!CANONICAL_ROLES.has(value.role) && !DEBT_ROLES.has(value.role)) {
      failures.push(`${label} has unknown role ${value.role}`)
    }
    const key = entryKey(value)
    if (seen.has(key)) failures.push(`${label} duplicates an earlier entry`)
    seen.add(key)
  }
  return failures
}

export function currentCutoverFailures(baseline) {
  const debts = baseline.entries.filter((value) => value.deleteIn !== null)
  return debts.length === 0
    ? []
    : debts.map((value) => `current baseline must have zero migration debt: ${factSite(value)}`)
}

function ratchetBaseline(baseline) {
  const convert = (value) => ({
    site: factSite(value),
    members: [value.role, value.deleteIn ?? 'canonical'],
    reason: value.deleteIn
      ? `Temporary ${value.role} scheduled for ${value.deleteIn}.`
      : `Canonical ${value.role} owner.`,
  })
  const debt = baseline.entries.filter((value) => value.deleteIn).map(convert)
  const registered = baseline.entries.filter((value) => !value.deleteIn).map(convert)
  return { debtCap: debt.length, registered, debt }
}

export function historicalFailures(facts, baseline, references) {
  const vocabularies = facts.map((value) => ({
    site: factSite(value),
    members: [value.role, value.deleteIn ?? 'canonical'],
  }))
  const current = ratchetBaseline(baseline)
  return references.flatMap((reference) =>
    evaluateHistoricalRatchet(vocabularies, current, ratchetBaseline(reference.baseline), reference.label),
  )
}
