// 回复语言规则：整份最终系统提示里，它**首尾各出现一次**（恰好两次）。
//
// 提示词主体几乎全是中文；规则只放最前面一次，英文界面下 Agent 会被后面的大段中文带回中文
// （2026-10 真实测试：英文界面、英文提问，回答是中文）。老的 `composeAgentSystemPrompt` 就是为这个首尾各放一次，
// lane 换代时这条教训丢了。这里走真 lane（真 pi 循环 + 真 HTTP 夹具），按桌面运行时的同一种拼法
// （`laneDesktopRuntime.ts`：头 = 规则 + 身份，殿后 = 规则）开 lane，看发给模型的 system 消息。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { createLaneFixture } from './laneFixture.mjs';

const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = path.resolve(`.tmp/lane-language-context-${process.pid}.cjs`);
// 一个 bundle 里同时带出规则与 locale 开关：两者必须是同一份 desktopLocale 模块实例。
buildSync({ stdin: { resolveDir: path.resolve('.'), loader: 'ts', contents:
  "export { buildLanguageRule, NOMI_AGENT_IDENTITY } from './electron/harness/context/agentContext'; export { setDesktopLocale } from './electron/desktopLocale'" },
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
after(() => rmSync(bundle, { force: true }));
// 规则的文字只有 buildLanguageRule 一处；locale 状态与它共用同一份 desktopLocale 模块实例。
const { buildLanguageRule, NOMI_AGENT_IDENTITY, setDesktopLocale } = require(bundle) as {
  buildLanguageRule(): string; NOMI_AGENT_IDENTITY: string; setDesktopLocale(value: unknown): void };

for (const locale of ['en', 'zh-CN'] as const) {
  test(`${locale}: language rule is first and last in the final system prompt, exactly twice`, async (t) => {
    setDesktopLocale(locale);
    t.after(() => { setDesktopLocale('zh-CN'); });
    const fixture = await createLaneFixture(t, [{ type: 'text', text: 'ok' }]);
    const lane = await fixture.openLane({ ...fixture.options,
      systemPrompt: () => [buildLanguageRule(), NOMI_AGENT_IDENTITY, '项目记忆：一大段中文上下文。'].filter(Boolean).join('\n\n'),
      systemPromptClosing: buildLanguageRule });
    await lane.execute({ kind: 'prompt', text: 'hello' });
    const body = fixture.http.requests[0]!.body as { messages: Array<{ role: string; content: unknown }> };
    const system = body.messages.filter((m) => m.role === 'system').map((m) => String(m.content)).join('\n\n');
    const rule = buildLanguageRule();
    assert.ok(rule.length > 40);
    assert.equal(system.split(rule).length - 1, 2, 'the rule appears exactly twice');
    assert.ok(system.startsWith(rule), 'first');
    assert.ok(system.endsWith(rule), 'last');
    assert.match(rule, locale === 'en' ? /Respond in English/ : /简体中文/);
  });
}
