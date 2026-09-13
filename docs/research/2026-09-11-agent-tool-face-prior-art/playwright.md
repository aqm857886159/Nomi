# Playwright MCP（microsoft/playwright-mcp，官方）

> 抓取日期 2026-09-11。一手出处 README https://github.com/microsoft/playwright-mcp

## 分层：默认给一小撮，其余靠 `--caps` 开
| 层 | 开启方式 | 工具数 |
|---|---|---|
| Core（自动化） | 默认 | 23 |
| Tabs | 默认 | 1（`browser_tabs`） |
| config | `--caps=config` | 1 |
| network | `--caps=network` | 4 |
| storage | `--caps=storage` | 17 |
| devtools | `--caps=devtools` | 13 |
| vision（坐标） | `--caps=vision` | 6 |
| pdf | `--caps=pdf` | 1 |
| testing（断言） | `--caps=testing` | 5 |

**总计 71，默认只有 24。**

## Core 工具（描述原文）
`browser_click` "Perform click on a web page" · `browser_close` "Close the page" · `browser_console_messages` "Returns all console messages" · `browser_drag` "Perform drag and drop between two elements" · `browser_drop` "Drop files or data onto an element, as if dragged from outside the page" · `browser_evaluate` "Evaluate JavaScript expression on page or element" · `browser_file_upload` "Upload one or multiple files" · `browser_fill_form` "Fill multiple form fields" · `browser_find` "Search the accessibility snapshot of the current page for text or regex" · `browser_handle_dialog` "Handle a dialog" · `browser_hover` "Hover over element on page" · `browser_navigate` "Navigate to a URL" · `browser_navigate_back` "Go back to the previous page in the history" · `browser_network_request` "Returns full details (headers and body) of a single network request" · `browser_network_requests` "Returns a numbered list of network requests since loading the page" · `browser_press_key` "Press a key on the keyboard" · `browser_resize` "Resize the browser window" · `browser_run_code_unsafe` "**Run a Playwright code snippet. Unsafe: executes arbitrary JavaScript**" · `browser_select_option` "Select an option in a dropdown" · `browser_snapshot` "Capture accessibility snapshot of the current page" · `browser_take_screenshot` "Take a screenshot of the current page" · `browser_type` "Type text into editable element" · `browser_wait_for` "Wait for text to appear or disappear or specified time to pass"

## 几条关键设计
- **一个工具管一族**：`browser_tabs` "List, create, close, or select a browser tab"（action 参数），没有四个独立 tab 工具。
- **危险性写进工具名**：`browser_run_code_unsafe`——**名字里带 `_unsafe`**，不指望宿主读 annotation。这是"防线建在最早能拦住的那层"的一个极简实现。
- **每个交互工具都同时要 `element` 和 `target`**：`element`（人类可读的元素描述）+ `target`（快照里的 ref）。前者是给人看的审批文案，后者是机器定位。**一次调用同时产出"要执行什么"和"给人看什么"。**
- **不是像素，是结构**：README 原文 "Uses Playwright's accessibility tree, not pixel-based input"，坐标点击被降级到可选的 `--caps=vision`。
- **断言也是工具**：`browser_verify_element_visible` "Verify element is visible on the page" / `browser_verify_text_visible` / `browser_verify_value` "Verify element value" / `browser_verify_list_visible` / `browser_generate_locator` "Generate locator for the given element to use in tests"。

## 维度归纳
- **工具数**：71（默认 24）。
- **动词粒度**：一个动作一个工具，**粒度是全套里最细的**——因为浏览器动作本来就是原子的，且每一步都要人能看懂。
- **命名风格**：`browser_` 前缀 namespace + `动词`（`browser_click`）或 `名词_动词`（`browser_cookie_set`、`browser_localstorage_clear`、`browser_video_show_actions`）——**子域深了就换成名词在前**。
- **读写分离**：靠 caps 分层 + 元数据 readOnly 标记（snapshot/screenshot/network/verify 只读；click/navigate/type/storage 非只读）。
- **破坏性标注**：名字（`_unsafe`）+ 默认不加载（storage/devtools 要显式开）。
- **返回值是否指路**：`browser_snapshot` 返回的 ref 就是下一步所有交互工具的入参——**返回值直接是下一次调用的钥匙**。
