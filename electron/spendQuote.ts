import { isComfyuiVendor } from "./catalog/types"
import { randomUUID } from 'node:crypto'
import { readCatalog } from './catalog/catalogStore'
import { deriveShotPrice } from './productionRun/shotPricing'
import type { PreparedSpendQuote, SpendQuoteInput, SpendQuoteLine } from './shared/contracts/spendQuote'

const quotes = new Map<string, { quote: PreparedSpendQuote; expiresAt: number }>()
const TTL = 30 * 60_000

export function quoteSpendLine(input: SpendQuoteInput): SpendQuoteLine {
  if (isComfyuiVendor({ key: input.vendorKey })) return { vendorKey: input.vendorKey, modelKey: input.modelKey, amount: 0 }
  const model = readCatalog().models.find((row) => row.vendorKey === input.vendorKey
    && (row.modelKey === input.modelKey || row.modelAlias === input.modelKey))
  const price = deriveShotPrice({
    candidate: { providerId: input.vendorKey, modelId: input.modelKey, parameters: input.parameters ?? {} },
    resolvePricing: () => model?.pricing,
  })
  return { vendorKey: input.vendorKey, modelKey: model?.modelKey ?? input.modelKey, amount: price.known ? price.amount : null }
}

export function prepareSpendQuote(inputs: SpendQuoteInput[]): PreparedSpendQuote {
  for (const [key, entry] of quotes) if (entry.expiresAt <= Date.now()) quotes.delete(key)
  const lines = inputs.map(quoteSpendLine)
  const amount = lines.every((line) => line.amount !== null) ? lines.reduce((sum, line) => sum + line.amount!, 0) : null
  const quote = { quoteId: randomUUID(), lines, amount }
  quotes.set(quote.quoteId, { quote, expiresAt: Date.now() + TTL })
  return quote
}

/** A confirmed quote is consumable once, so it cannot mint multiple batch budgets. */
export function takeSpendQuote(quoteId: string): PreparedSpendQuote {
  const entry = quotes.get(quoteId)
  quotes.delete(quoteId)
  if (!entry || entry.expiresAt <= Date.now()) throw new Error('Spend quote expired; confirm a new quote')
  return entry.quote
}
