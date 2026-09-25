# ComfyUI combo 选项类型修复的结构评审（症状簇触发，2026-09-24）

状态：✅ 已交付（跟着 issue #861 的修复 PR 一起合入）

触发原因：`check:symptom-cluster` 统计到，根因合同 `2026-09-24-comfyui-combo-wire-type` 加入之后，下面四个模块在 7 天内都攒到了 3 份以上合同：

| 模块 | 7 天内合同数 |
|---|---|
| `electron/catalog` | 13 |
| `electron/integrationCertification` | 5 |
| `src/desktop` | 5 |
| `src/ui` | 4 |

R21 的规矩是：出现第三份合同，就先回答「这一层的结构有没有问题」，再接着修。

## 这份合同碰了这几层的什么

这次修复的 owner 在 `electron/comfyuiObjectInfo.ts`（/object_info 解析层）。四个模块里的改动都只是**载体层面的类型放宽**：

| 模块 | 改了什么 | 为什么要改 |
|---|---|---|
| `electron/catalog` | `comfyuiWorkflowImport.ts`：选项类型、按类型比较默认值；`comfyuiWorkflowImportStore.ts`：IPC 消毒改用 `isComfyComboValue` | 这一层把选项烤进参数控件，还要消毒渲染层传来的 enumOptions |
| `electron/integrationCertification` | `integrationWorkflowBinding.ts`：`sanitizeWorkflowEnumOptions` 放行数字和布尔 | 接入认证会话是另一扇接收同一份 enumOptions 的门 |
| `src/desktop` | `bridgeModelCatalogSurface.ts`：三处 `options: string[]` 放宽 | IPC 桥的类型声明 |
| `src/ui` | 导入面板、模板库、画布预览：类型放宽；预览试跑改走画布的 `declaredOptionValue` | 渲染层消费 enumOptions |

## 和各簇原有合同是不是同根

**都不同根。** 各簇原有合同的类根因分别是：

- **`electron/catalog`**（其余 12 份）：鉴权说法散成多个字段（auth-scheme），重建记录时字段被漏掉（vendor-upsert），参数声明没有唯一 owner（model-spec-parity），提示词投影没有 owner（run-path-prompt-projection），两台发动机各写一份（generation-executor），「观察到的」直接去写「用户决定的」（background-reconcile），配置读失败被吞掉（config-never-silently-lost），花钱与否没有声明（credential-probe），等等。没有一份涉及 ComfyUI 导入。7 天窗口里，ComfyUI 导入子区只有这一份合同（上一份 `2026-09-11-comfyui-combo-format-drift` 已经在窗口外）。
- **`electron/integrationCertification`**：会话容量没有 owner、自检超时残留、连接身份建模错误、鉴权读路漏维度。本次只碰了其中的 enumOptions 消毒。
- **`src/desktop`、`src/ui`**：composer 生命周期、付费范围、剪辑截断、连接身份等。本次只做了类型放宽。

## 但有一条共通的形状，本次也踩到了

`electron/catalog` 这 13 份合同里，至少 6 份是同一种形状：**同一件事在多处手抄，编译器看不见它们之间的联系**（auth-scheme、vendor-upsert、model-spec-parity、run-path-prompt-projection、generation-executor-one-vendor、shot-cut-truncation）。

本次修复也是这个形状：

1. **IPC 契约在渲染层手抄了 5 份。** ComfyUI 导入对账结果里的 `enumOptions`（`{ classType, inputKey, options }`）在以下几处各写了一份字面量类型：
   - `src/desktop/bridgeModelCatalogSurface.ts`（3 处）
   - `src/ui/onboarding/ComfyuiWorkflowImportPanel.tsx`
   - `src/ui/onboarding/ComfyuiTemplateLibrary.tsx`
   - `src/ui/onboarding/comfyuiCanvasPreview.ts`（`EnumOption`）

   主进程把 `WorkflowEnumOption.options` 改成带类型之后，**这 5 处一个都不会变红**：运行时已经是数字，类型却还写着字符串。这次它们能全部改到，靠的是门表（door-map）加人工 grep，不是编译器。
2. **同一份载荷有两个消毒器，失败策略还不一样。** 导入仓库的 `sanitizeEnumOptions` 遇到坏值**静默丢弃**；接入认证的 `sanitizeWorkflowEnumOptions` 遇到坏值**直接抛错**。同一个渲染层载荷走两扇门，坏值的下场取决于走的是哪一扇。本次让两者共用 `isComfyComboValue` 这一个标量判据，但**丢弃还是拒收**这个策略差异没有动：它牵涉认证会话的错误面，不属于这次修复的范围。

## 结构结论

- 这四层的分层本身，不需要因为这次修复而改动：修复的 owner 在解析层，下游只是载体。
- 有一笔结构债要记下来，**不在本 PR 实施**：ComfyUI 工作流导入的 IPC 契约（对账结果、enumOptions、binding）没有一份主进程和渲染层共用的类型声明。仓库里已经有现成的落点 `electron/shared/contracts/`（比如 `modelBoxPreference`，渲染层已有 330 处从 `electron/shared` 引类型）。建议：
  1. 把对账结果和 enumOptions 的类型移到 `electron/shared/contracts/`，渲染层那 5 处改成 import，下次再改字段时编译器会在所有读口报红；
  2. 两个消毒器合成一个，失败策略统一成 fail-closed（整份拒收并报出是哪一项），不要一扇门静默丢、另一扇门抛错。

  这属于跨进程契约的收口。按 P5，先出方案再动手，已开独立任务。

## 各模块一句话结论

- `electron/catalog`：这份合同和其余 12 份不同根。它同样踩到了「手抄声明」的形状，只是规模更小；本次在源头保留了类型，并共用了一个判据。
- `electron/integrationCertification`：不同根；两个消毒器的策略差异记为结构债。
- `src/desktop`：不同根；IPC 桥的类型是手抄的，建议从 `electron/shared/contracts` 派生。
- `src/ui`：不同根；预览试跑已经收到画布唯一的 owner `declaredOptionValue`，没有留下第二份规则。
