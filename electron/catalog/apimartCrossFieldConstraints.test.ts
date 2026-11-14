/**
 * APIMart 两个 MiniMax 模型的跨字段约束：以前按模型名挂请求变换判（apimart-hailuo-23 / apimart-minimax-h3 的合计与单放音频），
 * 2026-11-14 起归发送前的通用一步（applyHeadlessParamDefaults → validateModeConstraints，按档案声明判）。
 * 用例原样迁过来，走的是两个发送口共用的那一步；H3 只剩「首尾帧和参考素材不能同时出现」还在它自己的变换里。
 */
import { describe, expect, it } from 'vitest';
import { APIMART_VIDEO_MODELS } from './apimartVideos';
import { applyHeadlessParamDefaults } from './taskParams';
import { validateMinimaxH3Body } from './apimartMinimaxH3';
import { desktopT } from '../desktopStrings';
import { MINIMAX_H3_APIMART_ARCHETYPE } from '../shared/videoCapabilities/minimaxH3Apimart';
/** 拒收原话里的槽名照档案取。 */
const h3RefLabel = (kind: string) => MINIMAX_H3_APIMART_ARCHETYPE.modes.find((m) => m.id === 'ref')!.slots.find((s) => s.kind === kind)!.label;

function send(modelKey: string, archetypeId: string, taskKind: string, modeId: string, extras: Record<string, unknown>, variantId?: string) {
  const mapping = APIMART_VIDEO_MODELS.find(model => model.modelKey === modelKey)!.mappings.find(row => row.taskKind === taskKind)!;
  return applyHeadlessParamDefaults(
    { ...extras, archetype: { id: archetypeId, modeId, ...(variantId ? { variantId } : {}) } },
    { vendorKey: 'apimart', modelKey, modelMeta: { archetypeId }, taskKind, modeId },
    mapping.create.defaultParams, mapping.create.body,
  );
}

describe('APIMart request contract（发送前通用一步）', () => {
  it('Hailuo 2.3 不再挂按名字的请求变换', () => {
    const mappings = APIMART_VIDEO_MODELS.find(model => model.modelKey === 'MiniMax-Hailuo-2.3')!.mappings;
    expect(mappings.map(mapping => mapping.taskKind)).toEqual(['text_to_video', 'image_to_video']);
    for (const mapping of mappings) expect(mapping.create.request_transform).toBeUndefined();
  });
  it.each(['standard', 'fast'])('Hailuo 2.3（%s）1080p + 10 秒在发送前拒，原话不变', variantId => {
    const parameter = desktopT('modelConstraints.parameterCombination', { parameter: 'duration' });
    expect(() => send('MiniMax-Hailuo-2.3', 'hailuo-2.3', 'text_to_video', 't2v', { resolution: '1080p', duration: 10 }, variantId)).toThrow(parameter);
    expect(() => send('MiniMax-Hailuo-2.3', 'hailuo-2.3', 'text_to_video', 't2v', { resolution: '1080p', duration: 6 }, variantId)).not.toThrow();
  });
  it('MiniMax H3：第 13 件参考在发送前拒，原话不变；正好 12 件照发', () => {
    const total = desktopT('modelConstraints.referenceTotal', { max: 12 });
    const urls = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `https://example.com/${prefix}${index}`);
    expect(() => send('MiniMax-H3', 'minimax-h3-apimart', 'image_to_video', 'ref', { image_urls: urls('i', 9), video_urls: urls('v', 3), audio_urls: urls('a', 1) })).toThrow(total);
    expect(() => send('MiniMax-H3', 'minimax-h3-apimart', 'image_to_video', 'ref', { image_urls: urls('i', 6), video_urls: urls('v', 3), audio_urls: urls('a', 3) })).not.toThrow();
  });
  it('MiniMax H3：只放音频在发送前拒（按档案 requiresAnyOf，不再按模型名）', () => {
    const companion = desktopT('modeInput.companionMissing', {
      slot: desktopT('modeInput.slotName', { label: h3RefLabel('audio_ref'), kind: desktopT('modeInput.slotKind.audio_ref') }),
      companions: [
        desktopT('modeInput.slotName', { label: h3RefLabel('image_ref'), kind: desktopT('modeInput.slotKind.image_ref') }),
        desktopT('modeInput.slotName', { label: h3RefLabel('video_ref'), kind: desktopT('modeInput.slotKind.video_ref') }),
      ].join(desktopT('modeInput.or')),
    });
    expect(() => send('MiniMax-H3', 'minimax-h3-apimart', 'image_to_video', 'ref', { audio_urls: ['https://example.com/a.mp3'] })).toThrow(companion);
    expect(() => validateMinimaxH3Body({ audio_urls: ['https://example.com/a.mp3'] })).not.toThrow();
  });
  it('MiniMax H3 变换只剩一条：首尾帧和参考素材不能同时出现', () => {
    expect(() => validateMinimaxH3Body({ first_frame_image: 'f', image_urls: ['i'] })).toThrow(desktopT('minimaxH3.mixedReferences'));
  });
});
