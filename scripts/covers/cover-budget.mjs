// Conservative budget conversion, not a claimed live exchange rate.
export const CNY_PER_USD_CEILING = 8

/** Task fees are attributable; shared account deltas may include other clients. */
export function taskCharge({ cost, before, after, reserveCny }) {
  const actualCnyCeiling = cost * CNY_PER_USD_CEILING
  if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(reserveCny) || reserveCny <= 0 || actualCnyCeiling > reserveCny) {
    throw new Error('Missing, invalid or above-reservation task cost; reconcile before submitting again')
  }
  if (!Number.isFinite(before) || !Number.isFinite(after)) throw new Error('Balance evidence is missing')
  return { actualUsd: cost, actualCnyCeiling, balanceDelta: Math.max(0, after - before) }
}
