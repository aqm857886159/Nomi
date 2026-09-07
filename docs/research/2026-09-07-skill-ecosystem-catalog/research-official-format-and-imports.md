# 官方 SKILL.md 格式与各宿主导入机制（细节）

> 来源：agentskills.io/specification、Anthropic 官方文档（overview/best-practices/skills/plugins/plugin-marketplaces）、anthropics/skills 仓库、OpenAI Codex 文档、Vercel skills CLI（npm `skills`）仓库与 lock 文档、skills-go 交叉验证。全部为一手抓取，2026-09-07。

## 1. SKILL.md frontmatter 字段全集

> 权威有两处、口径略不同：agentskills.io/specification（规范站）与 Anthropic 文档（overview + best-practices）。下表分列。

| 字段 | agentskills.io 规范 | Anthropic 文档补充 |
|---|---|---|
| `name` **必填** | 1–64 字符；仅小写字母/数字/连字符；不得以 `-` 开头/结尾、不得含 `--`；**须与所在目录同名** | 不得含 XML 标签；保留字 "anthropic"/"claude" 禁用 |
| `description` **必填** | 1–1024 字符，非空；须同时写清 what + when，含触发关键词 | 同上；注入 system prompt 须**第三人称**；≤1024 是 anthropics/skills 提交实测的强制值 |
| `license` 可选 | 许可证名或指向捆绑 LICENSE 文件 | — |
| `compatibility` 可选 | ≤500 字符；仅当有环境要求时写 | — |
| `metadata` 可选 | 字符串键值 map，键名建议唯一 | 官方示例 `author`/`version` |
| `allowed-tools` 可选 | 空格分隔预授权工具串，标注 **Experimental** | — |

官方原样示例（Anthropic overview 页逐字）：

```yaml
---
name: pdf-processing
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.
---
```

## 2. 目录布局与写作规范

- **技能即目录**，至少含 `SKILL.md`；目录名 kebab-case，须与 frontmatter `name` 一致。
- 可选子目录：`scripts/`（可执行代码）、`references/`（按需读取的文档）、`assets/`（模板/资源）。引用文件从 SKILL.md **保持一级深度**，避免深层嵌套。
- **渐进式披露三层**：① 启动只载 name+description（约 100 tokens）；② 激活时载正文，**建议 <500 行 / ≈5000 tokens**；③ 资源按需加载。
- 写作：优先简洁指令而非脚本；脚本要"显式报错、路径统一正斜杠"；参考文件 >100 行需文首目录。
- **无官方统一 zip 标准、无公开 JSON Schema**；校验靠 agentskills.io 提供的本地 CLI `skills-ref validate ./my-skill`。

## 3. 各宿主"导入/安装"机制——注意：官方没有 `skills add` 命令

### 3.1 Claude Code（code.claude.com/docs/en/skills，2026-09 实测）

- **无 `claude skills add` 命令、无 settings.json `"skills": [...]` 数组引用 repo**。官方明确"添加靠文件放置或插件"。
- 落盘位置：`~/.claude/skills/<name>/`（个人）、`.claude/skills/<name>/`（项目）。
- 可见性用 settings.json `skillOverrides`（on / name-only / user-invocable-only / off），不是"引用"。
- **分发走插件市场**（真实命令）：

```
/plugin marketplace add anthropics/skills
claude plugin install document-skills@anthropic-agent-skills
```

- marketplace.json 放 `.claude-plugin/`，顶层 `name/owner/plugins[]`；插件条目 `source`（`./` 或 github/npm/zip）+ `skills: ["./skills/pdf", ...]` 路径数组。anthropics/skills 即此形态。

### 3.2 OpenAI Codex（learn.chatgpt.com/docs/build-skills，即 developers.openai.com/codex/skills）

- **无 `codex skills add/remove` 子命令**；frontmatter **无 `disabled` 扩展**。
- 目录：`.agents/skills/`（项目级 `$CWD`/`$REPO_ROOT`、用户级 `$HOME`）、系统级 `/etc/codex/skills`。
- 装精选技能用对话内 `$skill-installer linear`；禁用不删文件，改 `~/.codex/config.toml` 的 `[[skills.config]] path=… enabled=false`。
- Codex 特有可选扩展是**目录级** `agents/openai.yaml`（界面名/图标/`allow_implicit_invocation`/MCP 依赖），不是 frontmatter 字段。
- 初始技能清单预算 ≤2% 上下文或 8000 字符。

### 3.3 skills.sh / npm `skills` CLI（Vercel Labs，开源 github.com/vercel-labs/skills）——真正的一键安装

```bash
npx skills add vercel-labs/agent-skills                          # owner/repo
npx skills add https://github.com/o/r/tree/main/skills/web-design-guidelines  # 子路径
npx skills add ./my-local-skills                                 # 本地
npx skills add -a claude-code codex -s frontend-design           # 按 agent / 按名
npx skills list | remove | update | init | use
```

- 探测逻辑：在仓库里找 `skills/<category?>/<name>/SKILL.md`（最多挖 3 层；`--full-depth` 放开）。
- 安装目标按 agent 映射目录（Claude Code→`.claude/skills/`、Codex→`.agents/skills/`、Pi→`.pi/skills/` 等 73+ 家），默认 symlink、可 `--copy`；默认装项目级，`-g` 装全局；自动检测已装 agent。

### 3.4 skills-lock.json（Nomi 已有，同源确认）

- **非 Anthropic 发明**，来自 vercel-labs/skills CLI。项目级 `skills-lock.json`（version 1）字段即 `source/sourceType(github|local)/skillPath/computedHash`（可选 `ref`）。
- **哈希算法**：排除 `.git`/`node_modules` 递归收集文件 → 按相对路径排序 → 对每条（相对路径+文件内容）算 **SHA-256**——是"内容哈希"非 git blob。Vercel 官方承认其与"磁盘实装"核对不可靠。
- 全局锁 `~/.agents/.skill-lock.json` 为 version 3，改用 GitHub Trees API 的 **tree SHA**（`skillFolderHash`）判更新。
- Vercel 另有 well-known 端点分发形态（`open.feishu.cn/.well-known/skills/...`，skillFolderHash 为空）。

## 4. 对 Nomi 的直读结论

1. **对外收录只认 SKILL.md**：catalog 里每个技能的"事实源"= frontmatter 的 name+description；正文只读预览。Nomi 的 `skill.json` 留在内部运行时，不上 catalog（否则把用户往"只有我们有"的格式上带）。
2. **桌面端安装管线对齐 Vercel CLI 语义**：`owner/repo[/skillPath]` 引用 + 内容哈希锁定——Nomi 已具备 90%，补齐"从 catalog manifest 拉取"一环即可。
3. **三态安装入口值得抄**：Agent-prompt（先审后装）/ 直接命令 / 本地下载——正好匹配桌面端"应用内安装 + 审核"双路径。
4. **投稿校验门槛直接可用官方规则**：name≤64（小写+连字符+与目录同名）、description≤1024（what+when+触发词+第三人称）、保留字/许可证检查——可映射为 `nomi skill validate` 的 P0 门禁。
