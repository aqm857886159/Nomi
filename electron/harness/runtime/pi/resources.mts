import { createExtensionRuntime, type ResourceLoader } from '@earendil-works/pi-coding-agent';

/**
 * No discovery: cwd/agentDir never become sources of instructions or executable resources.
 *
 * Skills reach the model only through Nomi's explicit surfaces — `formatNomiSkillIndex`
 * (metadata-only catalog) plus the `load_skill` capability and `buildSkillSystemPrompt` —
 * never the Pi SDK's auto-loading ResourceLoader. Feeding the real repo catalog into
 * `getSkills()` breaks that isolation invariant (the zero-quota agent-runtime suite proves
 * a sandbox session must load zero disk skills) and is inert here anyway since the session
 * runs with `enableSkillCommands: false` / `noTools: 'all'`. Keep this seam empty.
 */
export function createNomiResourceLoader(systemPrompt: string): ResourceLoader {
  const extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() };
  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}
