# Devin（Cognition）

> 抓取日期 2026-09-11。
> **出处等级**：非官方。泄露件 https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools 的 `Devin AI/Prompt.txt`（402 行）。**引用时必须说明是泄露件。**

## 形态：不是 JSON function call，是 **XML 标签命令**
提示词原文：
> "Command Reference — You have the following commands at your disposal to achieve the task at hand. At each turn, you must output your next commands. The commands will be executed on your machine and you will receive the output from the user. Required parameters are explicitly marked as such. At each turn, you must output at least one command but if you can output multiple commands without dependencies between them, it is better to output multiple commands for efficiency. **If there exists a dedicated command for something you want to do, you should use that command rather than some shell command.**"

最后那句是全篇最重要的一条设计声明：**有专用领域动词就不许走 shell**。

## 命令清单（按提示词里的分组，语法原文摘录）

**Reasoning**
```
<think>Freely describe and reflect on what you know so far, things that you tried, and how that aligns with your objective and the user's intent. You can play through different scenarios, weigh options, and reason about possible next next steps. The user will not see any of your thoughts here, so you can think freely.</think>
```

**Shell**
```
<shell id="shellId" exec_dir="/absolute/path/to/dir">
<view_shell id="shellId"/>
<write_to_shell_process id="shellId" press_enter="true">Content to write to the shell process. Also works with unicode for ANSI, for example. ... You can leave this empty if you just want to press enter.</write_to_shell_process>
<kill_shell_process id="shellId"/>
```

**编辑**
```
<open_file path="/full/path/to/filename.py" start_line="123" end_line="456" sudo="True/False"/>
<str_replace path="/full/path/to/filename" sudo="True/False" many="False">
<create_file path="/full/path/to/filename" sudo="True/False">Content of the new file. Don't start with backticks.</create_file>
<undo_edit path="/full/path/to/filename" sudo="True/False"/>
<insert path="/full/path/to/filename" sudo="True/False" insert_line="123">
<remove_str path="/full/path/to/filename" sudo="True/False" many="False">
<find_and_edit dir="/some/path/" regex="regexPattern" exclude_file_glob="**/some_dir_to_exclude/**" file_extension_glob="*.py">A sentence or two describing the change you want to make at each location that matches the regex. You can also describe conditions for locations where no change should occur.</find_and_edit>
```

**检索**
```
<find_filecontent path="/path/to/dir" regex="regexPattern"/>
<find_filename path="/path/to/dir" glob="globPattern1; globPattern2; ..."/>
<semantic_search query="how are permissions to access a particular endpoint checked?"/>
```

**LSP（把 IDE 能力做成命令）**
```
<go_to_definition path="/absolute/path/to/file.py" line="123" symbol="symbol_name"/>
<go_to_references path="/absolute/path/to/file.py" line="123" symbol="symbol_name"/>
<hover_symbol path="/absolute/path/to/file.py" line="123" symbol="symbol_name"/>
```

**浏览器**
```
<navigate_browser url="https://www.example.com" tab_idx="0"/>
<view_browser reload_window="True/False" scroll_direction="up/down" tab_idx="0"/>
<click_browser devinid="12" coordinates="420,1200" tab_idx="0"/>
<type_browser devinid="12" coordinates="420,1200" press_enter="True/False" tab_idx="0">Text to type into the textbox. Can be multiline.</type_browser>
<restart_browser extensions="/path/to/extension1,/path/to/extension2" url="https://www.google.com"/>
<move_mouse coordinates="420,1200" tab_idx="0"/>
<press_key_browser tab_idx="0">keys to press. Use `+` to press multiple keys simultaneously for shortcuts</press_key_browser>
<browser_console tab_idx="0">console.log('Hi') // Optionally run JS code in the console.</browser_console>
<select_option_browser devinid="12" index="2" tab_idx="0"/>
```

**部署**
```
<deploy_frontend dir="path/to/frontend/dist"/>
<deploy_backend dir="path/to/backend" logs="True/False"/>
<expose_port local_port="8000"/>
```

**与人 / 环境**
```
<wait on="user/shell/etc" seconds="5"/>
<message_user attachments="file1.txt,file2.pdf" request_auth="False/True">Message to the user. Use the same language as the user.</message_user>
<list_secrets/>
<report_environment_issue>message</report_environment_issue>
<suggest_plan/>
```

**Git / PR**
```
<git_view_pr repo="owner/repo" pull_number="42"/>
<gh_pr_checklist pull_number="42" comment_number="42" state="done/outdated"/>
```

## 行为守则里的工具调用规则（原文）
> "When encountering environment issues, report them to the user using the `<report_environment_issue>` command. Then, find a way to continue your work without fixing the environment issues, usually by testing using the CI rather than the local environment. Do not try to fix environment issues on your own."

> "When to Communicate with User — When encountering environment issues / To share deliverables with the user / When critical information cannot be accessed through available resources / When requesting permissions or keys from the user / Use the same language as the user"

## 维度归纳
- **工具数**：约 40 个命令（XML 标签）。
- **动词粒度**：混合。基础动作细（`open_file` / `insert` / `remove_str` 各一个），但 `find_and_edit` 是一个**语义级批量动词**——参数是自然语言"你想在每个匹配处做什么改动"，而不是具体替换串。这是"把一个 agent 子任务包成一个工具"的范例。
- **命名风格**：`动词_名词`，浏览器族反过来用名词后缀（`click_browser` / `type_browser` / `press_key_browser`）。
- **读写分离**：无标注。
- **破坏性 / 权限标注**：**`sudo="True/False"` 是每个文件命令的显式参数**；`message_user` 有 `request_auth="False/True"`——"我要向你要授权"被编码成消息工具的一个布尔，而不是另一个工具。
- **返回值是否指路**：工具本身不指路；**"遇到什么情况调哪个工具"写在系统提示的行为段，不是工具描述里**（见上面两段原文）。
- **与 Nomi 最相关的一条**：领域动词与逃生口（shell）共存时，必须在提示层写死优先级（"If there exists a dedicated command … use that command rather than some shell command"），否则模型会退回逃生口。
