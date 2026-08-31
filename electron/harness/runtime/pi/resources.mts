import { createExtensionRuntime, type ResourceLoader } from '@earendil-works/pi-coding-agent';
import { createNomiSkillResourceCatalog } from './nomiSkillResources.mjs';

/** Nomi owns resource discovery; the SDK-provided session cwd/agentDir never become sources of instructions or executable resources. */
export function createNomiResourceLoader(systemPrompt: string): ResourceLoader {
  const extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() };
  const skills = createNomiSkillResourceCatalog();
  return {
    getExtensions: () => extensions,
    getSkills: () => skills.list(),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: () => skills.reload(),
  };
}
