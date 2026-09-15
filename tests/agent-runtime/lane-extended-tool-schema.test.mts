import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateToolArguments } from '@earendil-works/pi-ai';
import { LANE_DEFERRED_TOOL_CATALOG } from '../../electron/agentLane/laneToolCatalog.js';
import { toModelVisibleSchema } from '../../electron/agentLane/laneToolSchema.mjs';

test('every deferred domain descriptor reaches the pi schema boundary', () => {
  for (const tool of LANE_DEFERRED_TOOL_CATALOG) {
    assert.doesNotThrow(() => toModelVisibleSchema(tool.schema, { toolName: tool.name }), tool.name);
  }
});

test('pi accepts nested JSON generation parameters through the published local references', () => {
  const spec = LANE_DEFERRED_TOOL_CATALOG.find(tool => tool.name === 'draft_shots')!;
  const tool = { name: spec.name, description: spec.description,
    parameters: toModelVisibleSchema(spec.schema, { toolName: spec.name }) };
  // `draft_shots.parameters` 是模型档案声明的标量表（string/number/boolean）；嵌套结构由宿主按目录钳值，不进模型面。
  const parameters = { seed: 17, enabled: true, aspect_ratio: '16:9' };
  const cases = [
    { shots: [{ prompt: 'A sunrise', parameters }] },
    { draftId: 'operation-1', shots: [{ shotId: 'shot-1', prompt: 'A sunrise', parameters }] },
    { shots: [{ prompt: 'A sunrise', candidate: { providerId: 'loopback', modelId: 'fixture' }, parameters }] },
  ];
  for (const args of cases) {
    const validated = validateToolArguments(tool, { id: 'call-1', type: 'toolCall', name: tool.name, arguments: args });
    assert.equal(spec.schema.safeParse(validated).success, true);
    assert.deepEqual(validated, args);
  }
  assert.throws(() => validateToolArguments(tool, { id: 'invalid', type: 'toolCall', name: tool.name,
    arguments: { shots: [{ prompt: 'A sunrise', parameters: { nested: { deep: true } } }] } }));
});
