import { expect, it } from 'vitest';
import { buildImportedWorkflow, buildComfyImportModelMapping, capabilityDraftForImportedWorkflow, type WorkflowBinding } from './comfyuiWorkflowImport';
import { projectDeclaredModel } from '../providerAdapter/promotionMeta';
import { buildHttpRequest, buildTemplateContext } from '../ai/requestPipeline';
import type { Mapping, Model } from './types';
import { archetypeModeArraySlots } from '../../src/workbench/generationCanvas/nodes/controls/archetypeMeta';

it('projects every image, video and audio binding through existing array slots and indexed node inputs', () => {
  const graph = {
    'a': { class_type: 'LoadImage', inputs: { image: 'a.png' } }, 'b': { class_type: 'LoadImage', inputs: { image: 'b.png' } },
    'v': { class_type: 'LoadVideo', inputs: { file: 'a.mp4' } }, 's': { class_type: 'LoadAudio', inputs: { audio: 'a.wav' } },
    'o': { class_type: 'VHS_VideoCombine', inputs: { images: ['a', 0], frame_rate: 24 } },
  };
  const binding: WorkflowBinding = { images: [
    { nodeId: 'a', inputKey: 'image', paramKey: 'input_a', label: 'A', mediaKind: 'image' },
    { nodeId: 'b', inputKey: 'image', paramKey: 'input_b', label: 'B', mediaKind: 'image' },
    { nodeId: 'v', inputKey: 'file', paramKey: 'input_v', label: 'Video', mediaKind: 'video' },
    { nodeId: 's', inputKey: 'audio', paramKey: 'input_s', label: 'Audio', mediaKind: 'audio' },
  ], outputNodeId: 'o', outputKind: 'video' };
  const built = buildComfyImportModelMapping(buildImportedWorkflow(graph, binding), { modelKey: 'opaque', labelZh: 'Opaque' });
  const draft = capabilityDraftForImportedWorkflow(built.model as Model, built.mapping as Mapping);
  const projected = projectDeclaredModel(draft, 'any-connection');
  const mode = projected.contract!.modes[0];
  expect(mode.slots.map(s => [s.kind, s.min, s.max])).toEqual([['image_ref', 2, 2], ['video_ref', 1, 1], ['audio_ref', 1, 1]]);
  expect(archetypeModeArraySlots(mode)).toHaveLength(3);
  const context = buildTemplateContext({ request: { prompt: '' }, params: { referenceImages: ['a.png', 'b.png'], referenceVideoUrls: ['v.mp4'], referenceAudioUrls: ['s.wav'] }, model: {}, modelKey: 'opaque', apiKey: '' });
  const request = buildHttpRequest({ baseUrl: 'http://127.0.0.1:8188', authType: 'none', apiKey: '', context, operation: projected.mappings[0].create! });
  expect((request.body as { prompt: unknown }).prompt).toMatchObject({ a: { inputs: { image: 'a.png' } }, b: { inputs: { image: 'b.png' } }, v: { inputs: { file: 'v.mp4' } }, s: { inputs: { audio: 's.wav' } } });
  draft.modes[0].referenceParam = undefined;
  expect(() => projectDeclaredModel(draft, 'any-connection')).toThrow(/referenceParam/);
});
