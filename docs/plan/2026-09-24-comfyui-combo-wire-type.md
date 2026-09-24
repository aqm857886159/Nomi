# ComfyUI combo 选项保留原类型（issue #861）

状态：✅ 已交付（跟着本 PR 一起合入）
日期：2026-09-24
来源：[issue #861](https://github.com/aqm857886159/Nomi/issues/861)，用户点导入面板的「反馈给 Nomi」自动提交。
根因合同：[`docs/fixes/2026-09-24-comfyui-combo-wire-type.root-cause.json`](../fixes/2026-09-24-comfyui-combo-wire-type.root-cause.json)

## 结论

ComfyUI-Easy-Use 的 `easy hiresFix`.rescale_after_model 在 /object_info 里声明成 `[[false, true], {"default": true}]`，也就是老节点拿 `[False, True]` 当开关的写法。Nomi 把 combo 选项一律当 `string[]` 收，碰到布尔就收不下，于是这个字段被判成「没见过的格式」，面板弹提示请用户反馈。导入和提交本身不受影响。

同一个根因还有一处用户没报过的问题：数字选项会被转成字符串。内置 `CreateVideo.bit_depth` 的选项是 `["auto", 8, 10]`，烤成下拉后存成了 `"8"`，用户选这一项，发给 ComfyUI 的就是字符串 `"8"`。ComfyUI 校验 combo 用的是 `val not in combo_options`（execution.py，类型敏感），结果直接报 value_not_in_list。

修法是让选项从 /object_info 一路保留 JSON 原类型，一直带到 /prompt，中间不转字符串。

## 先查别人（R5）

- ComfyUI 服务端校验（validate_inputs）：<https://github.com/comfyanonymous/ComfyUI/blob/1568e6cfd04586a4b3c4e1817ea7dde09b1bf9e7/execution.py#L1047-L1056>。老格式列表和 COMBO 都走 `val not in combo_options`，不做类型转换。
- 上游节点定义：<https://github.com/yolain/ComfyUI-Easy-Use/blob/8730ffd14044ee9392db3b192646266576bc67df/py/nodes/fix.py#L24>，写的是 `([False, True], {"default": True})`；第 92 行按布尔比较。
- 画布这边本来就按选项的声明类型发值：`src/workbench/generationCanvas/nodes/controls/parameterControlModel.ts:266` 的 `parseControlInput` 在 select 分支返回选中项的 `value`，这是当初给 duration 整数下拉加的。这次把这条匹配抽成了同文件第 262 行的 `declaredOptionValue`，画布和导入预览都调它，还是只有这一个 owner。
- 画布解析参数：`src/config/modelCatalogMeta.ts:172` 的 `parseParameterControlOption` 会保留 string/number/boolean 标量。所以缺口只在 ComfyUI 导入这一层。

## 范围

| 文件 | 改动 |
|---|---|
| `electron/comfyuiObjectInfo.ts` | 新增 `ComfyComboValue` 类型和唯一判据 `isComfyComboValue`；新增 `comboValues`，老格式和 COMBO 两种形状共用这一个元素策略：只收全字符串、字符串混数字、全布尔三种，布尔混进别的类型判未知；`enumsByClass` 改为按原类型存；删掉 `toEnumString`，数字不再转字符串 |
| `electron/catalog/comfyuiWorkflowImport.ts` | `WorkflowEnumOption.options` 和 `ParamControl.options` 改成带类型；烤下拉时保留作者默认值，比对按严格类型 |
| `electron/catalog/comfyuiWorkflowImportStore.ts`、`electron/integrationCertification/integrationWorkflowBinding.ts` | 两处 IPC 消毒都改用 `isComfyComboValue`，数字和布尔能通过，对象和 NaN 丢掉或拒收 |
| `src/desktop/bridgeModelCatalogSurface.ts`、`ComfyuiWorkflowImportPanel.tsx`、`ComfyuiTemplateLibrary.tsx`、`comfyuiCanvasPreview.ts`、`WorkflowCanvasPreview.tsx` | 渲染层类型放宽；预览下拉的 value 转成字符串显示；试跑取值时走画布同一个 owner，回到原类型 |
| `src/workbench/generationCanvas/nodes/controls/parameterControlModel.ts` | 把 `parseControlInput` 在 select 分支里的「选中字符串 → 声明类型」匹配抽成 `declaredOptionValue`，画布行为不变；这是按 Ponytail 评审意见改的 |

不动的部分：
- 布尔值的 widget 还是由导入面板按值推成开关（`inferParamType`），不烤成下拉。
- 数字值的 combo，比如工作流里写的是 `bit_depth: 8`，照旧是数字框，这是之前就有的行为。
- `unknownComboShapes` 的反馈通道和 DynamicCombo 白名单都不变。

## 回滚

这次改动不涉及持久化结构和迁移，直接 revert 这个 PR 就能回到旧行为。

## 验收门

- 用 issue #861 原样的 spec 解析：不出现未知提示，选项是 `[false, true]`，是布尔不是字符串。
- 布尔混字符串、布尔混数字，不管老格式还是 COMBO，都还判未知。
- 用真机夹具的 `CreateVideo.bit_depth` 走完整条链：烤下拉 → 选 8 → /prompt 里是数字 8。工作流里写成字符串 `"8"` 的，对账如实报缺。
- 把生产代码换回 main 版本，新增的 10 条测试全部变红（已做）。
- 仓库里 4 份真实 /object_info 样本没有新增未知外壳，唯二的非字符串字段现在保持数字（已跑）。
- 真机走查（已做，Windows 11，脚本 `tests/ux/comfy-combo-wire-type.walk.mjs`，截图在 [`2026-09-24-comfyui-combo-wire-type-evidence/`](2026-09-24-comfyui-combo-wire-type-evidence/)）：
  - 用真实应用走一遍：模型设置 →「本地运行时与即梦会员」→ 本地 ComfyUI → 自定义 → 粘贴 → 分析，背后接的是本地假 ComfyUI，它返回 issue 里原样的 spec 和真机的 bit_depth。
  - zh-CN 和 en 两种语言下，「没见过的格式」提示都没有出现（`*-notice-area.png` 拍到了原本出提示的那一段）。hiresFix 那一行被推断成「开关 / Toggle」。
  - 点导入 → 开始自检，自检期间写进 catalog 的候选：`放大后重缩放` 是 `boolean`、默认 `true`；`视频位深` 是 `select`，选项是 `["auto", 8, 10]`，数字仍是数字。
  - 自检真实发出的 `/prompt` 由假服务器按 ComfyUI 的规则做类型敏感校验，结果通过：`rescale_after_model=true`（布尔）、`bit_depth="auto"`。
  - 对照组：`tests/ux/comfy-unknown-combo-feedback.walk.mjs` 里真正陌生的外壳，提示和「反馈给 Nomi」照常出现（`control-unknown-shape-still-reported.png`）。
  - 这条对照走查的入口在 main 上已经过期（ComfyUI 挪进了「其他方式」分组）。原因是各条走查各抄了一份导航。按 Ponytail 的意见，把「假 ComfyUI + 打开导入面板 + 粘贴分析」抽成共用的 `tests/ux/_comfyImportPanel.mjs`，锚点改用组件自带的 `data-model-home-*` 标记。两条走查都改用它，也都重新跑通了。
  - 假服务器的 `/history` 不会出图，所以自检最后判失败、候选被撤回。这是走查环境的限制，不是这次改动造成的。

## 遗留

- 这次修复之前已经导入、并把数字 combo 暴露成下拉的工作流，存的仍然是字符串选项。在设置页重新保存或者重新导入一次就会变成带类型的选项；在那之前，选中数字项会收到 ComfyUI 的 value_not_in_list 报错，不会静默出错。
- 本机没有装了 Easy-Use 的 ComfyUI。布尔形状这次是按 issue 原文和上游源码核对的，没有拿活服务器验证。
- 走查和结构评审中另外发现几个问题，和这次改动无关，已各开独立任务，没有塞进这个 PR：
  - 参数行改绑节点后，名字和 key 不会跟着换（`ComfyuiWorkflowImportPanel.tsx` 的 `setParamCandidate`）；
  - 自动建议的参数名写死了中文（`NUMERIC_LABEL`），英文界面的识别结果那一行换行很挤；
  - ComfyUI 导入的 IPC 契约在渲染层手抄了 5 份，两个消毒器的失败策略也不一样（见 [结构评审](../audit/2026-09-24-comfyui-combo-wire-type-structure-review.md)）。
- `scripts/door-map.mjs` 在 Windows 上不输出结果的问题，这个 PR 开着期间已经在 main 上由 #866 修好。
