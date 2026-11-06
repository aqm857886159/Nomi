import assert from 'node:assert/strict';

// One current candidate per family, chosen from the checked public short-request prices.
export const CATALOG_LATEST_SAMPLES = [
  { family: 'Suno music', modelKey: 'suno-v6-mini', kind: 'text_to_audio', params: { instrumental: true } },
  // Previous generation: the official page lists only v6 versions, so one cheap real order confirms V5.5 still works.
  { family: 'Suno music previous generation', modelKey: 'suno-v5.5', kind: 'text_to_audio', params: { instrumental: true } },
  { family: 'Suno sounds', modelKey: 'suno-sounds-v6-mini', kind: 'text_to_audio', params: { sound_type: 'one-shot' } },
  { family: 'Lyria', modelKey: 'flowmusic-lyria-3.5', kind: 'text_to_audio', params: { length: 1 } },
  { family: 'TTS', modelKey: 'nomi-audio', kind: 'text_to_audio', params: { modeId: 'speech', voice: 'alloy', speed: 1 } },
  ...['gpt-6-luna', 'claude-haiku-5-5', 'gemini-3.8-flash', 'deepseek-v4.1-flash', 'qwen3.8-flash',
    'glm-5.3-flash', 'kimi-k3', 'grok-4.7', 'minimax-m3', 'step-3.7-flash']
    .map(modelKey => ({ family: modelKey, modelKey, kind: 'chat', params: { maxTokens: 1024, maxRetries: 0 } })),
] as const;

export type CatalogLatestSample = (typeof CATALOG_LATEST_SAMPLES)[number];

/** Both runners submit once per sample and stop on the first failure. Querying an accepted task is not a new order. */
export async function runCatalogLatestSamples(invoke: (sample: CatalogLatestSample) => Promise<{ status: string }>) {
  const results = [];
  for (const sample of CATALOG_LATEST_SAMPLES) {
    const result = await invoke(sample);
    assert.equal(result.status, 'succeeded', `${sample.family}: stop; do not retry this order`);
    results.push({ modelKey: sample.modelKey, ...result });
  }
  return results;
}
