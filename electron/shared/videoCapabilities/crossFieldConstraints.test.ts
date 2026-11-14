import { describe, expect, it } from 'vitest';
import { HAILUO_2_3_ARCHETYPE } from './hailuo23';
import { MINIMAX_H3_APIMART_ARCHETYPE } from './minimaxH3Apimart';
import { MINIMAX_H3_MAX_ARCHETYPE } from './minimaxH3Max';
import { KLING_4_FLASH_ARCHETYPE } from './kling4Flash';
import { constrainParameterControls, normalizeConditionalParameters, remainingReferenceCapacity, validateModeConstraints } from './crossFieldConstraints';

describe('cross-field capability constraints', () => {
  it.each(HAILUO_2_3_ARCHETYPE.modes)('$id rejects 1080p + 10 seconds and narrows options', (mode) => {
    const values = { resolution: '1080p', duration: 10 };
    expect(constrainParameterControls(mode.params, values).find(p => p.key === 'duration')?.options.map(o => o.value)).toEqual([6]);
    expect(normalizeConditionalParameters(mode.params, values)).toEqual({ resolution: '1080p', duration: 6 });
    const frame = { first_frame: 1 };
    expect(validateModeConstraints(mode, values, frame)?.kind).toBe('parameter');
    expect(validateModeConstraints(mode, { resolution: '768p', duration: 10 }, frame)).toBeNull();
    expect(validateModeConstraints(mode, { resolution: '1080p', duration: 6 }, frame)).toBeNull();
  });
  it('enforces aggregate counts at 12 across all three media types', () => {
    const mode = MINIMAX_H3_APIMART_ARCHETYPE.modes.find(m => m.id === 'ref')!;
    expect(remainingReferenceCapacity(mode, { image_ref: 9, video_ref: 3 })).toBe(0);
    expect(validateModeConstraints(mode, { image_urls: Array(9).fill('i'), video_urls: Array(3).fill('v'), audio_urls: ['a'] })?.kind).toBe('references');
    expect(validateModeConstraints(mode, { image_urls: Array(6).fill('i'), video_urls: Array(3).fill('v'), audio_urls: Array(3).fill('a') })).toBeNull();
  });
  it('uses facts for unrelated controls, defaults and reference keys after serialization', () => {
    const mode = JSON.parse(JSON.stringify({ ...HAILUO_2_3_ARCHETYPE.modes[0], maxTotalReferences: 2,
      slots: [{ kind: 'video_ref', inputKey: 'clips', max: 3, min: 0 }],
      params: [{ key: 'quality', type: 'select', options: [{ value: 'high', label: 'high' }], defaultValue: 'high' },
        { key: 'frames', type: 'select', options: [{ value: 4, label: '4' }, { value: 8, label: '8' }], defaultValue: 8,
          optionConstraints: [{ when: { key: 'quality', value: 'high' }, values: [4] }] }] }));
    expect(normalizeConditionalParameters(mode.params, { frames: '8' })).toEqual({ frames: 4 });
    expect(validateModeConstraints(mode, { clips: ['a', 'b', 'c'], frames: 4 })?.kind).toBe('references');
    expect(constrainParameterControls(mode.params, {})[1].defaultValue).toBe(4);
  });
});

describe('输入核对：槽下限、requiresAnyOf、slotEmpty（2026-11-14）', () => {
  const kling = (id: string) => KLING_4_FLASH_ARCHETYPE.modes.find(m => m.id === id)!;
  const h3max = MINIMAX_H3_MAX_ARCHETYPE.modes.find(m => m.id === 'ref')!;

  it('槽下限：编辑 / 续写没有源视频 → slotMissing；有就放行', () => {
    expect(validateModeConstraints(kling('edit'), {}, { image_ref: 1 })).toEqual({ kind: 'slotMissing', slot: 'video_ref' });
    expect(validateModeConstraints(kling('extend'), {}, {})).toEqual({ kind: 'slotMissing', slot: 'video_ref' });
    expect(validateModeConstraints(kling('edit'), {}, { video_ref: 1 })).toBeNull();
    expect(validateModeConstraints(kling('i2v'), {}, {})).toEqual({ kind: 'slotMissing', slot: 'first_frame' });
  });
  it('requiresAnyOf：H3-Max 只放音频 → companionMissing；配图或配视频放行；不放音频不判', () => {
    expect(validateModeConstraints(h3max, {}, { audio_ref: 1 })).toEqual({ kind: 'companionMissing', slot: 'audio_ref', companions: ['image_ref', 'video_ref'] });
    expect(validateModeConstraints(h3max, {}, { audio_ref: 1, image_ref: 1 })).toBeNull();
    expect(validateModeConstraints(h3max, {}, { audio_ref: 1, video_ref: 1 })).toBeNull();
    expect(validateModeConstraints(h3max, {}, {})).toBeNull();
  });
  it('slotEmpty：可灵参考没有视频时 origin → optionNeedsSlot；auto 放行；有视频 origin 放行', () => {
    expect(validateModeConstraints(kling('ref'), { audio_setting: 'origin' }, { image_ref: 1 })).toEqual({ kind: 'optionNeedsSlot', key: 'audio_setting', value: 'origin', slot: 'video_ref' });
    expect(validateModeConstraints(kling('ref'), { audio_setting: 'auto' }, { image_ref: 1 })).toBeNull();
    expect(validateModeConstraints(kling('ref'), { audio_setting: 'origin' }, { image_ref: 1, video_ref: 1 })).toBeNull();
  });
  it('面板收窄：给了计数且没视频 → 选项只剩 auto、存值 origin 修回 auto；不给计数（看不到输入）不收窄', () => {
    const params = kling('ref').params;
    const audio = (counts?: Parameters<typeof constrainParameterControls>[2]) =>
      constrainParameterControls(params, { audio_setting: 'origin' }, counts).find(p => p.key === 'audio_setting')!.options.map(o => o.value);
    expect(audio({ image_ref: 1 })).toEqual(['auto']);
    expect(audio({ image_ref: 1, video_ref: 1 })).toEqual(['auto', 'origin']);
    expect(audio()).toEqual(['auto', 'origin']);
    expect(normalizeConditionalParameters(params, { audio_setting: 'origin' }, { image_ref: 1 })).toMatchObject({ audio_setting: 'auto' });
    expect(normalizeConditionalParameters(params, { audio_setting: 'origin' }, { video_ref: 1 })).toMatchObject({ audio_setting: 'origin' });
  });
});
