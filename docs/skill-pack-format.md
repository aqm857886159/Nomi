# Skill Pack v2 格式规范

版本：v2（从 v0.4.0 起生效）
位置：`skills/<skill-key>/`

---

## 1. 总览

Skill Pack v2 是 Nomi Agent 的能力扩展单元。每个 skill 是一个目录，包含**方法论文档**（markdown）与**机器可读 manifest**（JSON）。

- **SKILL.md**：写给 LLM 的知识、方法论、输出约束
- **skill.json**：写给 runtime 的元数据 — 名称、版本、依赖、工具白名单、权限边界

Runtime 加载 skill 时：
1. 读取 `skill.json` 验证 schema（`electron/skills/skillManifestSchema.ts` 中的 Zod schema）
2. 把 `SKILL.md` 内容注入到 Agent 的 system prompt
3. 按 manifest 的 `tools` 字段过滤 Agent 可调用的工具集

**向后兼容**：仅有 `SKILL.md` 没有 `skill.json` 的旧 skill 仍能加载，但不会得到工具白名单 / 权限边界，所有可用工具都暴露给 LLM。

---

## 2. 目录结构

```
skills/
  <skill-key>/                 e.g. workbench-storyboard-planner
    skill.json                 manifest (required for v2)
    SKILL.md                   methodology / system prompt body
    README.md                  (optional) user-facing docs
    examples/                  (optional) sample inputs/outputs
```

---

## 3. `skill.json` 字段

```jsonc
{
  // 必填
  "name": "workbench.storyboard-planner",   // 全局唯一 key（点号分段）
  "version": "1.0.0",                       // SemVer
  "description": "把一段故事文本拆成 6-12 个镜头节点 + 时序连边",

  // 可选：允许内置单阶段 Skill 出现在 Workbench Agent Skill 选择器。
  // 不填时，内置多阶段流程包仍按兼容规则显示；内部 routing Skill 默认隐藏。
  "selectableInWorkbench": true,

  // 工具白名单：LLM 仅能调用这里列出的工具
  // 如果省略或为空数组，等同于"允许所有内置工具"
  "tools": [
    "create_canvas_nodes",
    "connect_canvas_edges"
  ],

  // 必需的 provider 能力。runtime 会检查模型目录里是否至少有一个
  // enabled 的对应 kind 模型；缺少时选择器保留该 Skill，但标出能力缺口。
  "requiredProviders": ["text"],            // 子集: "text" | "image" | "video"

  // 权限边界。Agent 调用受限工具前 UI 会做对应确认。
  "permissions": [
    "create"                                // 子集: "read-only" | "create" | "delete" | "export"
  ],

  // 可选：声明该 skill 期望接收的结构化输入字段，便于宿主在 UI 里
  // 提供输入模板或表单
  "inputs": [
    { "name": "storyText", "type": "string", "required": true }
  ],

  // 可选：声明示例
  "examples": [
    { "title": "三幕短剧", "file": "examples/three-act.md" }
  ]
}
```

---

## 4. `SKILL.md` 写作约定

第一行用 YAML frontmatter 同步关键字段（与 `skill.json` 不冲突，但 runtime 以 `skill.json` 为准）：

```markdown
---
name: workbench.storyboard-planner
description: 把一段故事文本拆成 6-12 个镜头节点
---

# 镜头规划方法论

## 你能做的
- ...

## 你不能做的
- ...

## 输出协议
- ...
```

正文是给 LLM 看的领域知识。**保持 ≤ 200 行**，避免占用上下文。

---

## 5. 工具白名单语义

`skill.json.tools` 中允许的字符串与 `electron/ai/canvasTools.ts` 中的 `canvasToolNames` 对齐：

- `read_canvas_state` — 读画布快照
- `create_canvas_nodes` — 创建一批待确认节点
- `connect_canvas_edges` — 连接节点引用边
- `set_node_prompt` — 改写已有节点的 prompt
- `delete_canvas_nodes` — 删除节点（破坏性）

未列入白名单的工具，即使 LLM 试图调用 runtime 也会拒绝。

---

## 6. 内置 skill 列表

| Skill key | 用途 | 主要工具 |
|---|---|---|
| `workbench.storyboard-planner` | 故事→故事板 | `create_canvas_nodes`, `connect_canvas_edges` |
| `workbench.creation-edit` | 创作区文档增改写 | (无画布工具) |
| `workbench.generation` | 生成区节点规划助手 | `create_canvas_nodes`, `connect_canvas_edges`, `set_node_prompt` |
| `creation.edit` | 创作区行内编辑 | (无画布工具) |

历史 `tapcanvas-*` 等 22+ skill 已归档至 `skills/legacy/`，不再随 runtime 加载。

---

## 7. 编写自己的 skill

1. 创建 `skills/<your-key>/SKILL.md` + `skill.json`
2. 在 `skill.json.tools` 里列出你的 skill 真正需要的工具（最小授权原则）
3. SKILL.md 写清楚方法论 + 输出约束
4. 用 `pnpm dev` 启动 Nomi，AI 面板里你的 skill 会自动被发现
5. 想发布给别人？把整个目录 zip / git 化即可分发；用户拷贝到 `skills/` 下就能用

---

## 8. 验证

Runtime 加载失败时会在 main process 日志中打印 Zod 校验错误。`pnpm test` 会跑 `skillManifestSchema.test.ts` 确保 schema 本身向后兼容。

---

## 9. 相关代码

- Schema：`electron/skills/skillManifestSchema.ts`
- Loader：`electron/runtime.ts` 中的 `buildSkillSystemPrompt` / `findSkillRecord`
- 工具定义：`electron/ai/canvasTools.ts`
- 设计背景：`docs/product/nomi-agent-tech-audit-2026-05-23.md` §3.3
