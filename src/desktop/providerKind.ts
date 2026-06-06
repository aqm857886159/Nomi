/**
 * 渲染层 providerKind 的单一真相源（R1）。
 *
 * 对应 electron 侧 `electron/catalog/types.ts` 的 `AiSdkProviderKind`——两边是
 * 同一组值（`openai-compatible | anthropic | openai-responses`），但渲染层不 import
 * electron 模块，故在此独立声明一次。bridge / desktopClient / providerPresets /
 * OnboardingWizard 全部 import 这里，禁止再各自内联 2 值联合（那会漂移成并行版）。
 *
 *  - openai-compatible：OpenAI Chat Completions（/chat/completions）。绝大多数中转。
 *  - openai-responses ：OpenAI Responses（/responses）。codex 类中转（如 foxcode）。
 *  - anthropic        ：Anthropic Messages（/v1/messages，x-api-key）。
 */
export type ProviderKind = 'openai-compatible' | 'anthropic' | 'openai-responses'
