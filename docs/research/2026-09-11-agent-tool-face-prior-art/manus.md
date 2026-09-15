# Manus

> 抓取日期 2026-09-11。
> **出处等级**：非官方。来自公开的泄露/复刻档案 https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools 的 `Manus Agent Tools & Prompt/tools.json`（29 个 function schema）。Manus 官方 https://manus.im/tools 只列能力不给 schema。**引用时必须说明是泄露件。**

## 全部 29 个工具的描述原文
```
message_notify_user     Send a message to user without requiring a response. Use for acknowledging receipt of messages, providing progress updates, reporting task completion, or explaining changes in approach.
message_ask_user        Ask user a question and wait for response. Use for requesting clarification, asking for confirmation, or gathering additional information.
file_read               Read file content. Use for checking file contents, analyzing logs, or reading configuration files.
file_write              Overwrite or append content to a file. Use for creating new files, appending content, or modifying existing files.
file_str_replace        Replace specified string in a file. Use for updating specific content in files or fixing errors in code.
file_find_in_content    Search for matching text within file content. Use for finding specific content or patterns in files.
file_find_by_name       Find files by name pattern in specified directory. Use for locating files with specific naming patterns.
shell_exec              Execute commands in a specified shell session. Use for running code, installing packages, or managing files.
shell_view              View the content of a specified shell session. Use for checking command execution results or monitoring output.
shell_wait              Wait for the running process in a specified shell session to return. Use after running commands that require longer runtime.
shell_write_to_process  Write input to a running process in a specified shell session. Use for responding to interactive command prompts.
shell_kill_process      Terminate a running process in a specified shell session. Use for stopping long-running processes or handling frozen commands.
browser_view            View content of the current browser page. Use for checking the latest state of previously opened pages.
browser_navigate        Navigate browser to specified URL. Use when accessing new pages is needed.
browser_restart         Restart browser and navigate to specified URL. Use when browser state needs to be reset.
browser_click           Click on elements in the current browser page. Use when clicking page elements is needed.
browser_input           Overwrite text in editable elements on the current browser page. Use when filling content in input fields.
browser_move_mouse      Move cursor to specified position on the current browser page. Use when simulating user mouse movement.
browser_press_key       Simulate key press in the current browser page. Use when specific keyboard operations are needed.
browser_select_option   Select specified option from dropdown list element in the current browser page. Use when selecting dropdown menu options.
browser_scroll_up       Scroll up the current browser page. Use when viewing content above or returning to page top.
browser_scroll_down     Scroll down the current browser page. Use when viewing content below or jumping to page bottom.
browser_console_exec    Execute JavaScript code in browser console. Use when custom scripts need to be executed.
browser_console_view    View browser console output. Use when checking JavaScript logs or debugging page errors.
info_search_web         Search web pages using search engine. Use for obtaining latest information or finding references.
deploy_expose_port      Expose specified local port for temporary public access. Use when providing temporary public access for services.
deploy_apply_deployment Deploy website or application to public production environment. Use when deploying or updating static websites or applications.
make_manus_page         Make a Manus Page from a local MDX file.
idle                    A special tool to indicate you have completed all tasks and are about to enter idle state.
```

## 最突出的一条：描述是**严格两句模板**
29 个里有 27 个**逐字**遵守同一个句型：

> `<动作陈述句>。Use for <场景1>, <场景2>, or <场景3>.`
> 或 `<动作陈述句>。Use when <条件>.`

第一句回答"这是什么"，第二句回答"**什么时候用**"。没有一条描述里解释参数、没有一条超过两句。
（唯二例外：`make_manus_page` 和 `idle` 只有一句。）

对照 Anthropic 官方建议"Aim for at least 3–4 sentences for each tool description"——Manus 反着来，**靠模板一致性而不是信息量取胜**。29 个工具读下来像一张表，模型选工具是在做"条件匹配"而不是"读文档"。

## 维度归纳
- **工具数**：29。
- **动词粒度**：原子动作（连 `browser_scroll_up` / `browser_scroll_down` 都分成两个工具）。
- **命名风格**：`域_动词`，六个域：`message_` / `file_` / `shell_` / `browser_` / `info_` / `deploy_`。**前缀是"用户看得懂的工作面"，不是内部模块名。**
- **读写分离**：无显式机制。
- **破坏性标注**：无。`deploy_apply_deployment`（部署到生产）和 `file_read` 在 schema 里长得一样。
- **返回值是否指路**：schema 层没有。
- **另一条可迁移点**：**和用户说话本身是工具**，而且拆成两个——`message_notify_user`（不等回复）vs `message_ask_user`（等回复）。"要不要阻塞"这件事被编码进了**工具的选择**，而不是一个参数。
