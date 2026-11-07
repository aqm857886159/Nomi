import assert from 'node:assert/strict';

// One current candidate per family, chosen from the checked public short-request prices.
export const CATALOG_LATEST_SAMPLES = [
  { family: 'Suno music', modelKey: 'suno-v6-mini', kind: 'text_to_audio', params: { instrumental: true } },
  // No V5.5 sample: on 2026-11-07 APIMart rejected version=v5.5 with HTTP 400 "已下线" (no charge).
  // Retiring the V5.5 rows is a separate change that waits on a class review; see the design card.
  { family: 'Suno sounds', modelKey: 'suno-sounds-v6-mini', kind: 'text_to_audio', params: { sound_type: 'one-shot' } },
  { family: 'Lyria', modelKey: 'flowmusic-lyria-3.5', kind: 'text_to_audio', params: { length: 1 } },
  { family: 'TTS', modelKey: 'nomi-audio', kind: 'text_to_audio', params: { modeId: 'speech', voice: 'alloy', speed: 1 } },
  // No Agent-brain samples here: creators reach text models through the Agent, not this task bridge, so a bridge
  // order would test a path nobody uses. The brains are checked one turn each through the real Agent UI instead.
] as const;

export type CatalogLatestSample = (typeof CATALOG_LATEST_SAMPLES)[number];

export type SampleTaskResult = { id?: string; status: string; assets?: unknown; raw?: unknown };

/** The bridge answers in two shapes: `tasks.run` gives the task itself, `tasks.result` wraps it as `{ vendor, result }`. */
export function taskResultOf(response: unknown): SampleTaskResult {
  const wrapped = (response as { result?: unknown } | null)?.result;
  const result = (wrapped && typeof wrapped === 'object' ? wrapped : response) as SampleTaskResult | null;
  assert.ok(result && typeof result.status === 'string', 'task response carries no status');
  return result;
}

/**
 * Follow one accepted order to its end. Every query names the id the submit returned, so a missing id stops
 * here instead of asking the vendor for an empty task. Querying never places a new order.
 */
export async function settleSampleTask(
  submitted: unknown,
  query: (taskId: string) => Promise<unknown>,
  { timeoutMs, intervalMs }: { timeoutMs: number; intervalMs: number },
): Promise<SampleTaskResult> {
  const first = taskResultOf(submitted);
  if (first.status === 'succeeded' || first.status === 'failed') return first;
  const taskId = first.id?.trim();
  assert.ok(taskId, `accepted order has no task id (status=${first.status}); stop, do not resubmit`);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    const latest = taskResultOf(await query(taskId));
    if (latest.status === 'succeeded' || latest.status === 'failed') return { ...latest, id: latest.id || taskId };
    assert.ok(Date.now() < deadline, `task ${taskId} still ${latest.status} after ${timeoutMs}ms`);
  }
}

/**
 * Both runners submit once per sample and stop on the first failure. Querying an accepted task is not a new order.
 * `from` resumes a paid run at one sample: samples before it already succeeded in a recorded run and are not paid for again.
 */
export async function runCatalogLatestSamples(
  invoke: (sample: CatalogLatestSample) => Promise<{ status: string }>,
  { from }: { from?: string } = {},
) {
  const start = from ? CATALOG_LATEST_SAMPLES.findIndex(sample => sample.modelKey === from) : 0;
  assert.ok(start >= 0, `unknown resume sample: ${from}`);
  const results = [];
  for (const sample of CATALOG_LATEST_SAMPLES.slice(start)) {
    const result = await invoke(sample);
    assert.equal(result.status, 'succeeded', `${sample.family}: stop; do not retry this order`);
    results.push({ modelKey: sample.modelKey, ...result });
  }
  return results;
}
