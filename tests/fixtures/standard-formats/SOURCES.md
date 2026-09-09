# 官方夹具的出处

> 📎 这里的每个文件都是**从官方规范/官方文档原样抄下来的最小样例**，不是我们编的。
> 门岗 `pnpm run check:standard-formats`（R31）要求登记的每个外部格式都指得到这样一份夹具，
> 而且要有真实的读取器测试读它、读得过。**读不过官方样例 = 我们的解析器有 bug**，不是夹具写错了。
>
> 改这里的文件只有一个合法理由：上游规范变了。那时必须同时更新下面的 `抓取日期`，
> 并重跑读取器测试——夹具是我们和外部世界之间唯一的对账凭证。

| 夹具 | 格式 | 出处 URL | 抓取日期 | 抄的是哪一段 |
|---|---|---|---|---|
| `agent-skill/SKILL.md` | Agent Skills（`SKILL.md` + YAML frontmatter） | https://code.claude.com/docs/en/skills | 2026-09-07 | 官方「SKILL.md file format」一节的最小完整样例：`---` 包住的 frontmatter（`name` / `description`）+ 正文。官方原话：所有 frontmatter 字段都是可选的，只有 `description` 被建议写上，好让模型知道什么时候用这个技能。 |
| `mcp/.mcp.json` | MCP 客户端配置（`mcpServers` 条目） | https://modelcontextprotocol.io/docs/develop/connect-local-servers | 2026-09-07 | 官方 quickstart 的 macOS 配置样例（filesystem server）。同一份 `mcpServers` 形状被 Claude Code 的 `~/.claude.json` / 项目级 `.mcp.json`、Cursor 的 `~/.cursor/mcp.json`、MCP 通用 `~/.config/mcp/mcp.json` 共用——所以一份夹具同时给这几个落点对账。 |

**为什么夹具里是 `filesystem` 而不是 `nomi`**：夹具要证的是「**别人写的条目在我们手里活得下来**」。
我们自己的条目当然读得过；真正会出事的是合并进用户已有配置时把别人的 server 弄没了（`mcpConfig.ts` 的合并语义）。

## MCP prompts/get (B6, 2026-09-10)
`mcp/prompts-get.json` is the unmodified request example from https://modelcontextprotocol.io/specification/2025-11-25/server/prompts (retrieved 2026-09-10). Its standard name/arguments envelope is read by nomiMcpSkills.test.ts; the example's code_review prompt is correctly unknown to Nomi.
