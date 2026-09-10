import contracts from './providerTrafficContracts.json';

export type ProviderTrafficPolicy = {
  scope: string;
  source?: string;
  inflight?: number;
  requestsPerMinute?: number;
  /** Provider tokenizer owns token-rate enforcement; do not guess image/hidden token costs. */
  tokensPerMinute?: number;
  inflightUnit?: string;
  pollIntervalMs?: number;
  submissionPath?: string;
};
export type ProviderTrafficIdentity = {
  baseUrl: string;
  model: string;
  kind: string;
  accountTier?: string;
};

/** Absence is unknown, never a fabricated numeric fallback or an unlimited claim. */
export function resolveProviderTrafficPolicy(input: ProviderTrafficIdentity): ProviderTrafficPolicy {
  const host = new URL(input.baseUrl).hostname;
  const provider = contracts.providers.find((entry) => entry.hosts.includes(host));
  const rules = provider?.rules ?? [];
  const rule = rules.find((entry) => (input.kind === '*' || entry.kind === '*' || entry.kind === input.kind) && (entry.models.includes('*') || entry.models.includes(input.model))
    && (!('accountTier' in entry) || entry.accountTier === input.accountTier));
  // Unknown account identity groups connections to the same provider conservatively;
  // never hash each API key into a fresh full-sized account allowance.
  const scope = [provider?.hosts[0] ?? host, '', rule?.kind ?? input.kind,
    rule ? rule.models.join('|') : input.model].join('\u0000');
  return {
    scope,
    ...(provider ? { source: provider.source } : {}),
    ...(rule && 'inflight' in rule ? { inflight: rule.inflight } : {}),
    ...(rule && 'tokensPerMinute' in rule && typeof rule.tokensPerMinute === 'number' ? { tokensPerMinute: rule.tokensPerMinute } : {}),
    ...(rule && 'requestsPerMinute' in rule ? { requestsPerMinute: rule.requestsPerMinute } : {}),
    ...(rule && 'submissionPath' in rule && typeof rule.submissionPath === 'string' ? { submissionPath: rule.submissionPath } : {}),
    ...(rule && 'inflightUnit' in rule ? { inflightUnit: rule.inflightUnit } : {}),
    ...(rule && 'pollIntervalMs' in rule && typeof rule.pollIntervalMs === 'number' ? { pollIntervalMs: rule.pollIntervalMs } : {}),
  };
}

/** Logical failures are vendor contract data; code numbers never leak into generic classification. */
export function providerLogicalFailure(baseUrl: string, response: unknown): { code: number; message: string; rateLimited: boolean } | undefined {
  const provider = contracts.providers.find((entry) => entry.hosts.includes(new URL(baseUrl).hostname));
  const contract = provider && 'errorContract' in provider ? provider.errorContract : undefined;
  if (!contract) return undefined;
  const at = (keys: string[]): unknown => keys.reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, response);
  const code = at(contract.codePath);
  if (typeof code !== 'number' || code === contract.successCode) return undefined;
  const message = at(contract.messagePath);
  return { code, message: typeof message === 'string' ? message : '', rateLimited: contract.rateLimitCodes.includes(code) };
}

export function providerRequestPolicy(vendor: { baseUrlHint?: string | null; meta?: unknown }, url: string, body?: BodyInit): ProviderTrafficPolicy {
  let model = '';
  if (typeof body === 'string') {
    try { const record = JSON.parse(body) as { model?: unknown }; if (typeof record.model === 'string') model = record.model; } catch { /* HTTP executor retains invalid body handling. */ }
  } else if (body instanceof FormData) {
    const value = body.get('model');
    if (typeof value === 'string') model = value;
  }
  const meta = vendor.meta && typeof vendor.meta === 'object' ? vendor.meta as Record<string, unknown> : {};
  const policy = resolveProviderTrafficPolicy({ baseUrl: url, model, kind: '*', accountTier: typeof meta.accountTier === 'string' ? meta.accountTier : undefined });
  return { ...policy, scope: `${policy.scope}:http`, inflight: policy.inflightUnit === 'connection' ? policy.inflight : undefined };
}
