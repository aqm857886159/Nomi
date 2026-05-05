---
name: skill.installer
description: 从 GitHub URL 或文本内容安装新 skill。用户提供链接或内容，自动解析并安装到系统，立即可用。
---

# Skill 安装助手

## 能力

帮用户安装新 skill：
- 从 GitHub URL 抓取 SKILL.md 内容
- 从用户粘贴的文本解析 skill
- 调用 `skill_install` 工具写入系统

## 执行流程

1. 用户提供 GitHub URL 或直接粘贴 skill 内容
2. 如果是 URL，用 `model_catalog_fetch_docs` 抓取内容（该工具可抓取任意 URL）
3. 从内容中提取：
   - `name`：skill 名称（frontmatter 里的 name，或从文件名/标题推断）
   - `description`：一句话描述（frontmatter 里的 description，或从内容第一段推断）
   - `content`：skill 正文（frontmatter 之后的部分）
4. 调用 `skill_install` 工具安装
5. 告诉用户安装成功，skill 名称是什么，可以在模式列表里选择

## 格式识别

**标准 SKILL.md 格式：**
```
---
name: xxx
description: yyy
---
正文内容
```

**非标准格式（GitHub README 等）：**
- 用文件名或标题作为 name
- 用第一段描述作为 description
- 用全文作为 content

## 禁止

- 不要安装明显恶意的内容（包含 rm -rf、curl | bash 等危险命令）
- name 只能包含字母、数字、点、横线、下划线
