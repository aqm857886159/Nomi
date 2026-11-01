# 设计卡：模型可见工具 schema 的通用标准推导

类别：外部工具契约兼容性修复；2026-10-29 改版。仅本地提交。旧提交为历史，新合同取代仅修 tuple 的范围。

## ★0 先查别人

2026-10-29 实查原文（不是凭供应商品牌推支持）：

- [JSON Schema 2020-12 Core §10.3.1.2](https://json-schema.org/draft/2020-12/json-schema-core#section-10.3.1.2) · items 必须是单个 schema，prefixItems 才表达位置 · 决定：发布器把 Zod tuple 派生为单 items + 长度，异质 tuple 用字段级 anyOf，位置约束写 description，原 Zod 执行。
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas) · 列出基本类型、enum、anyOf、pattern/format、数值界、数组长度、$ref/$defs 与递归例子 · 决定：按其明确关键字建立白名单，递归和数值开区间保留，不按单个网关添加规则。
- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling#strict-mode) · parameters 为 JSON Schema；strict 另要求 required 全字段和 additionalProperties:false，普通 Chat Completions 默认非 strict · 决定：本轮不启用 strict，不强迫 optional 变 required；开放 record 仍按 2020-12 additionalProperties 的 schema 形状发布并由 Zod 执行，不宣称 strict 保证。
- [MCP tools schema](https://modelcontextprotocol.io/specification/latest/server/tools#tool-schema) · 工具 inputSchema 使用 JSON Schema，默认 2020-12 · 决定：去掉转换器 draft-07 标记，统一 definitions 到 $defs 并重写引用，不混用方言。

差异：这是普通 function parameters 的通用发布合同，不是 strict 解码合同，也不是所有供应商接口都实测支持的承诺。保留现有根级 union 与 const 两条历史规则不改；后续用上述两份标准重新推导它们是否仍需存在，本轮不新增供应商规则。

## ★1 用户怎么用

创作者要求把文稿拆成分镜，整工具清单应被接受，模型先读文稿再建两镜草稿。量具：共享判据逐条验证生产 Agent 30 + MCP 24 共 54 条；运行时接受/拒绝矩阵验证原 Zod；真实网关走查量 HTTP 接受、工具结果成功率和落盘两镜。真实模型、Windows 原报告未验证，由协调执行，不以夹具数字替代。

本轮无新界面、不改错误文案、不增删工具、不改业务语义、不运行付费请求、不读真实资料。

## ★2 谁说了算

Zod 是唯一入参真相源，原契约不改字、不新抄一套 schema。发布与白名单 owner 为 electron/shared/agentCapabilities/modelVisibleJsonSchema.ts；laneToolSchema.mts 生成时拦截与 scripts/check-model-schema.ts 存量棘轮 import 同一判据。MCP 旧聚合器继续做已有 union 投影，使用共享标准转换和判据，不维护第二份标准白名单。模型视图与执行视图从同一契约派生；MCP runtimeInputSchema 保留原传输约束，由 mcpProtocol 校验，原执行入口 laneTools.mts 的 descriptor.schema.safeParse 与 MCP parseCall 保留，违反运行时约束仍走已有结构化错误。

## ★3 一致与复用

症状：用户连续三次参数拒绝。直接机制：生产带数组式 items，现有检查放行；网关端因果仍未实测。类根因：未约定统一发布标准，作者可写出标准外关键字和形状。共享推导转换已知标准外形状，未知形状 fail closed；不做供应商分支。保留 zod 3.25.76 / zod-to-json-schema 3.25.1，后续升级须通过全量清单、引用和运行时矩阵再评估去掉适配；本轮无需升级。

第一轮全部 20 关键字及形状归类（覆盖原报告每一项）：

| 原写法 | 标准内/外与模型可见写法 | 运行时兜底 |
| --- | --- | --- |
| type 单值 / 多类型数组（含 null） | 内：2020-12 类型；OpenAI optional/null 示例及基本类型 | 原 Zod |
| properties / required / description / enum | 内：直接保留，业务字段名不当关键字扫描 | 原 Zod |
| items 单 schema / minItems / maxItems | 内：直接保留 | 原 Zod |
| minimum / maximum / exclusiveMinimum / pattern | 内：OpenAI 明确列出；实数开区间不换 epsilon | 原 Zod |
| anyOf 字段级 | 内：直接保留；根级旧规则本轮保留 | 原 Zod union |
| additionalProperties boolean / schema | 内：2020-12 标准对象值 schema；普通非 strict 参数，保留动态键及值域 | 原 Zod record / object |
| $ref（含递归） | 内：保留本地引用，移动节点时改引用目标，不截断深度 | 原 lazy Zod |
| items 数组 / prefixItems | 外：同质 tuple → items 单 schema + minItems/maxItems；异质 → items.anyOf + 长度 + 按位置说明；rest tuple 保留开放尾部的长度含义 | 原 z.tuple；vec3/window 不改源码 |
| propertyNames | 外：删除关键字，在对象 description 说明键名 schema | 原 z.record 的 key schema |
| default | 未在支持表列出：删除注解，description 说明省略时默认值 | 原 Zod default；不改变缺省处理 |
| minLength / maxLength | 未在明确支持列表列出：description 说明长度界，不假造 pattern | 原 Zod string 长度 |
| $schema:draft-07 | 外：省略；模型 schema 符合默认 2020-12 | 非业务输入 |
| definitions（未来 / 引用例） | 外：改 $defs，同时重定位 $ref | 原 Zod |

未知关键字不得静默删除；白名单验证形状与类型，数组式 items、prefixItems、非本地/悬空引用、非法数值/required/enum 都拒绝。保留 additionalProperties 是普通工具表达开放字典的 2020-12 形状，不声称 OpenAI strict 接受它；真实网关接受性仍需协调验证。

## ★4 全状态

沿用既有 Agent 空、加载、成功、失败、部分成功、取消、过期和不可用状态与文案。转换只影响模型提示 schema；输入验证和持久化不动。已知转换说明追加到原 description，不能吞原文。标准外未知形状生成时与门岗同时拒绝；运行时违规沿用已有结构化错误。账本先 reviewed，真实走查与合入收据齐前不写 fixed。

## ★9 验收与反例（实施前）

- 正反例：白名单的关键字及合法值形状逐类覆盖；items 数组、prefixItems（含空）、未知关键字、错类型、非 JSON enum、非法界、坏引用均红。properties/$defs 键名和 enum 中的数据不误扫。
- 推导：同质/异质/嵌套/recursive/rest tuple 自动转换；默认值、键名和字符串长度完整写进说明；本地引用移动后仍可解析。
- 全量生产清单 54/54 新判据全绿；生成拦截与棘轮同源，不抄 schema。
- 运行时：正反 tuple/键名/default/长度/正数/递归值；原 vec3 与 window JSON 往返相同，短长/非数/负值/倒序/非有限 window 仍拒绝；实际 lane execute 验证错误结构，不放宽一个 Zod 字符。
- 根因合同/逃逸账本：标准白名单 + 推导层转换 + 真实网关走查；未获得真实证据保留 reviewed。
- 真实走查复用已有脚本若足够，否则 openPaidWalk 付费脚本 + 同步骤零花费中英演练，buildMarkers 使用新发布器字面量；仅协调跑付费。HTTP 接受不能替代工具写对率与两镜落盘。
- gates 退出 0；纪律页推送前快检与每次 fix-churn --staged；无推送、无合并。
- 独立验收：四类未命中，不派验收线；合并前做模型面逐字段对照（说明原文不丢、挪走的约束都写进新说明），结果写 PR 正文。回滚实现提交即可，无数据迁移。

运行上下文补充：共享模块同时被主进程与渲染进程使用。实走查证实运行时 Ajv 编译被上下文/CSP 拒绝；按 [Ajv standalone](https://ajv.js.org/standalone.html) 与 [CSP 说明](https://ajv.js.org/security.html#content-security-policy) 预编译官方元 schema，由一份生成逻辑生成自包含的 CJS / ESM 两种模块格式，主进程和渲染/开发预览共用同一个标准判据。Ajv 保留开发依赖，不增加运行时依赖、不放宽 CSP；生成器与禁用动态代码生成的回归锁定两种格式产物；编译后的 Agent 测试用 TypeScript 原生 allowJs 发射 CJS 依赖。开发预览真实浏览器探针已达到 __designLabReady，零 pageerror。
