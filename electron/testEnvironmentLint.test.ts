import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

it('rejects suite and module environment stubs but accepts per-test setup through the repository ESLint config', async () => {
  const eslint = new ESLint();
  const cases = [
    ['beforeAll(() => vi.stubEnv("FIXTURE", "value"));', 1],
    ['vi.hoisted(() => vi.stubEnv("FIXTURE", "value"));', 1],
    ['vi.stubEnv("FIXTURE", "value");', 1],
    ['beforeEach(() => vi.stubEnv("FIXTURE", "value"));', 0],
  ] as const;
  for (const [code, count] of cases) {
    const [result] = await eslint.lintText(code, { filePath: 'electron/environment-lifecycle.test.ts' });
    expect(result.messages.filter((message) => message.ruleId === 'no-restricted-syntax'), code).toHaveLength(count);
    expect(result.fatalErrorCount).toBe(0);
  }
});
