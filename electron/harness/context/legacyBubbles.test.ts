import { describe, expect, it } from 'vitest';
import { bubblesToSeedTurns } from './legacyBubbles';

describe('legacy UI text normalization', () => {
  it('retains compatibility sanitation and merges consecutive roles without mutating the bubbles', () => {
    const bubbles = [
      { role: 'assistant', content: 'orphan' },
      { role: 'user', content: ' “hello”—world… ' },
      { role: 'user', content: '\u200bmore\u00a0words' },
      { role: 'assistant', content: 'read→done' },
      { role: 'tool', content: 'x'.repeat(130) + '\nNOT_IMPORTED' },
      { role: 'user', content: 'unanswered' },
    ];
    const before = structuredClone(bubbles);
    expect(bubblesToSeedTurns(bubbles)).toEqual([
      { role: 'user', content: '"hello" - world...\n\nmore words' },
      { role: 'assistant', content: `read->done\n\n（已执行操作：${'x'.repeat(100)}）` },
    ]);
    expect(bubbles).toEqual(before);
  });
});
