import type { ToolHandler } from "./registry.js";
import fs from "node:fs/promises";
import path from "node:path";

function getGlobalSkillsDir(): string {
  return path.join(process.env.HOME || "~", ".agents", "skills");
}

export const skillInstallTool: ToolHandler = {
  definition: {
    name: "skill_install",
    description: "从 GitHub URL 或文本内容安装一个新 skill。安装后立即生效，用户可以在 AI 模式列表里选择它。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "skill 名称（唯一标识，如 my-skill 或 org.skill-name）" },
        description: { type: "string", description: "skill 的一句话描述" },
        content: { type: "string", description: "skill 正文内容（SKILL.md 的 frontmatter 之后的部分）" },
      },
      required: ["name", "description", "content"],
    },
  },
  async execute(args, ctx, toolCallId) {
    const name = String(args.name || "").trim();
    const description = String(args.description || "").trim();
    const content = String(args.content || "").trim();
    if (!name || !description || !content) {
      return { toolCallId, content: "Error: name, description, content are all required" };
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
      return { toolCallId, content: "Error: name must only contain letters, digits, dots, dashes, underscores" };
    }
    try {
      const skillDir = path.join(getGlobalSkillsDir(), name);
      await fs.mkdir(skillDir, { recursive: true });
      const skillMd = `---\nname: ${name}\ndescription: ${description}\n---\n\n${content}`;
      await fs.writeFile(path.join(skillDir, "SKILL.md"), skillMd, "utf-8");
      // Reload skills in the current runtime
      const skillLoader = (ctx.meta as Record<string, unknown>)?.skillLoader as { reloadSkills?: () => void } | undefined;
      skillLoader?.reloadSkills?.();
      return { toolCallId, content: `Skill "${name}" installed at ${skillDir}. It is now available in the skill list.` };
    } catch (e) {
      return { toolCallId, content: `Error installing skill: ${(e as Error).message}` };
    }
  },
};
