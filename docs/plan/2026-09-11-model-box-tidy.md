# 2026-09-11 模型框整理：供应商全 · 可排序 · 可隐藏 · 记住供应商

> 状态：🚧 进行中（2026-09-11 用户拍板「可以这样设计」，本分支 `feat/model-box-tidy-20260911` 已实现；合入 main 前只能称「已实现」，不能称「已解决」——R19）
> 来源：2026-09-11 用户原话「① 设置里的供应商列表要全 ② 供应商可排序 ③ 每个模型可隐藏 ④ 切模型再切回记住手选的供应商」；用户明确要求通用（不许单拎某个供应商）。
> 证据基础：真实截图（隔离 profile，同一批生产组件真实渲染，非手写 mockup）见 `docs/plan/2026-09-11-model-box-tidy-evidence/`；代码盘点见下方「现状」逐条 file:line。
> 关联文档：`docs/plan/2026-09-11-triage-board-evidence/feedback-five-items.md`（第 3/4/5 条已单独盘点，本方案把它们收成一套统一数据模型）、`docs/plan/2026-09-06-vendor-preference-auto-fallback.md`（一期「阶段一只做排序去重，不做逐模型记忆」的原始决策——本方案是它明确留白的阶段二）。
> 实施说明：拍板后按本方案落地，样张（`Main.dc.html` / `PickerAfter.dc.html`）与实现逐项对账；
> 唯一解析点落在 `src/config/modelBoxPreference.ts`，设置区与所有模型框读同一份结果。
> 真机验收截图 `after-*.png` 与三张样张同住证据目录。
> §5 里「未配置供应商也能预排位置」那条待拍板项**没做**（拍板结论 = 只列已配置的家，见「先查别人」§1 表格与样张提示文案）。

---

## 0. 一句话讲清楚（D6）

用户在模型框里天天撞见的摩擦是三件事分开看会误判、合起来看是一件事：**「模型选择器里的东西，谁在、排第几、要不要记我的选择」——这三问从来没有一个统一的地方回答，各自散在不同代码路径里，有的甚至根本没做。** 四条需求不是四个功能，是同一张「模型偏好」表缺的四个字段：供应商全集哪里来、供应商顺序谁定、模型要不要显示、这个模型上次我选的是哪家。用户要权衡的核心点只有一个：**新加的这些偏好，是继续散落在各处（简单，但会重复本次踩的坑），还是收进一张单一偏好表统一治理（多一次改造，但四条需求和以后的第五条都不用再单独盘一次）**——本方案选后者，理由见 §4。

---

## 先查别人（§1 · R6/R31 判据，四条均为官方文档，检索日期 2026-09-11）

| 产品 | 官方出处 | 与本方案相关的做法 | 对 Nomi 的借鉴 |
|---|---|---|---|
| **Cursor** | [Available models](https://cursor.com/help/models-and-usage/available-models)、[AWS Bedrock](https://cursor.com/docs/customizing/aws-bedrock) | `Settings → Models` 里每个模型一个勾选框，「off by default」，勾上才会出现在聊天框的模型选择器里；模型管理是「藏起来」不是「删掉」。 | 印证「隐藏」应该是纯显示层的 `enabled`/`hidden` 布尔，不删除任何接入配置——这正是 Nomi 现成的 `Model.enabled` 字段该干的事，不用另建新字段。 |
| **Claude Code（本产品自己）** | [settings-reference#availablemodels](https://code.claude.com/docs/en/settings-reference#availablemodels) | `availableModels` 是一个配置数组，管理员/用户显式列出允许出现在 `/model` 里的模型；不在列表里的模型不会被 `/model`、`--model`、`model` 字段选中。 | 「允许出现的模型是一份显式列表」而不是「所有接入的模型减去一份黑名单」——对应本方案 §2 的 `hiddenModelIds`（黑名单式，见下方取舍：Nomi 选黑名单是因为大多数模型默认应该显示，白名单会让新增模型默认不可见，体验上是负数）。 |
| **Open WebUI** | [Models 功能页](https://docs.openwebui.com/features/workspace/models/) | 三个独立动作：**Hide**（"Remove from the model selector without deleting"，仅本人可见性）、**Enabled**（管理员级全局开关）、**拖拽排序**（"Manual drag-to-reorder is only available with no search text and no filter applied"）、**Pin**（钉进侧栏快捷方式）。 | 关键教训：**Hide 和 Enabled 是两层**，一层是「对所有人禁用」、一层是「我自己不想看见」。Nomi 目前的 `Model.enabled` 其实是 Open WebUI 的 Enabled 那一层（写进 catalog，所有生成路径都认）；用户要的「隐藏从不用的模型」其实是 Open WebUI 的 Hide 那一层——**只影响选择器展示，不影响已经引用该模型的旧节点/旧生成记录**。这是本方案与「现有 `enabled` 字段」的关键区别，见 §2.3。 |
| **OpenRouter** | [Sticky routing](https://openrouter.ai/blog/tutorials/prompt-caching-sticky-routing/) | 「同一个模型」的请求会记住上次命中的供应商（session 级/模型级），后续请求优先回到同一家；但**用户显式传 `provider.order` 时，显式顺序永远赢**，粘性只在用户没手动指定时才生效，且有效期到期（10 分钟无活动）会过期。 | 印证 item④ 的两层优先级设计：**显式记忆 > 全局默认排序**，且不需要是「永久」的——本方案不做过期（Nomi 场景是「用户对这个模型的长期习惯」而非「同一会话续接缓存」），但优先级顺序（用户对这一个模型的选择 > 全局供应商顺序）与 OpenRouter 一致，不是本方案自创。 |

**四列表判断**：以上四家都不是「框架」，是产品参照物，不适用 R29 的框架四列表；不引入任何第三方运行时，只借鉴 UI/数据模型的形状。

---

## 2. 现状盘点（file:line，逐条对应四个需求）

### 2.1 ①「供应商列表要全」——两层原因，一 bug 一设计

| 层 | 现状 | file:line |
|---|---|---|
| **真 bug（判据）** | `nomi:model-catalog:models:list` 这条 IPC 每次读取前都重新调用 `ensureBuiltinModelSeeds()`（注释明写：「Renderer 热更新不会重启 Electron main，读取时补一次内置种子，避免长时间停留在旧目录」），但**紧邻的** `nomi:model-catalog:vendors:list` 没有做同一件事——直接 `listModelCatalogVendors()` 读盘。新增的内置供应商种子（`BUILTIN_VENDOR_SEEDS`）能在模型列表里出现，却可能在**供应商**列表/排序里缺席，直到 Electron 主进程真正冷重启。 | `electron/main.ts:442`（`vendors:list` 直读，无重新播种）对照 `:443-448`（`models:list` 显式调 `ensureBuiltinModelSeeds()`）；播种函数本身在 `electron/catalog/catalogStore.ts:108-113`；`listModelCatalogVendors` 在 `electron/catalog/catalogStore.ts:277-279` |
| **有意设计（不是 bug，但可能是用户真正想改的那半）** | 「优先供应商」排序区**只列已配置（能真的调得动）的家**——`state !== 'needs-key' && state !== 'disabled'` 才进 `configuredVendorEntries`。没填 key 的内置供应商（Agnes AI、魔搭、火山方舟、RunningHub、Replicate、fal.ai、Runway Dev、MiniMax、ElevenLabs、Meshy……）在真实截图 `d-settings-models-tab-unconfigured-vendor.png` 里清楚可见——它们在「模型」tab 完整存在、可点、可填 key，但**从不出现**在「优先供应商」的排序列表里。 | `src/workbench/settings/AiModelsSection.tsx:162-169`（判据 + 注释「已配置」）；`src/workbench/settings/VendorPreferenceOrderSection.tsx:56`（`ordered.length < 2` 时整块不渲染，同一逻辑的极端情况：只有一家配置时用户以为「排序坏了」，其实是「没东西可排」） |

**两条需要用户拍板哪个是「全」**：
- 若「全」= 已配置的家一个都不漏 → 只需修 main.ts 的重新播种 bug（S 号量级，无需新数据结构）。
- 若「全」= 未配置的家也要能预先排位置（比如用户想先把 Agnes AI 排到第二位，再回头填 key）→ 需要允许「未配置」进入排序表，UI 需要多一种视觉态（灰显 + 「未接入」角标 + 点击去接入），这是本方案 §5 的取舍点之一。

### 2.2 ②「供应商可排序」——已实现（供应商级），②的新范围是「模型级」

| 现状 | file:line |
|---|---|
| 供应商顺序已有完整实现：schema、持久化、IPC、UI 四层齐全，`VendorPreferenceOrderSection.tsx` 就是②要新增的「模型排序」区可以照抄的骨架（上移/下移箭头、失败提示、`data-vendor-preference-row` 断言钩子）。 | `electron/shared/contracts/vendorPreference.ts`（schema）、`electron/settings/vendorPreferenceSettings.ts` + `vendorPreferenceIpc.ts`（持久化/IPC）、`src/workbench/common/useVendorPreference.ts`（hook）、`src/workbench/settings/VendorPreferenceOrderSection.tsx`（UI） |
| 但**模型本身的顺序**（不分供应商，「常用模型排前面」）完全没有手动排序：模型下拉的排序只有一级判据——`catalogLifecycle`（flagship/value/companion/legacy 四档），同档内按 catalog 原始插入序，**没有任何用户可调的字段**。 | `src/config/modelIdentity.ts:63-73`（`sortModelsByCatalogLifecycle`，唯一排序函数，无手动序） |
| 用户 09-11 说的「模型框排序」原话，结合 `feedback-five-items.md` 第 5 条独立发现的同一处代码，是指**这一级**（模型级，不是供应商级）——两个人各自发现了同一个缺口。 | `docs/plan/2026-09-11-triage-board-evidence/feedback-five-items.md` 第 5 行 |

### 2.3 ③「每个模型可隐藏」——机制存在，覆盖不全（真通用问题，不是单一供应商）

| 现状 | file:line |
|---|---|
| 通用启停机制已经存在且是唯一 owner：`Model.enabled` 字段，`ModelChipGroups.tsx` 提供 chip 点选、`ModelEnableEditor.tsx` 提供批量搜索+全选+启停（真实截图 `c-model-enable-toggle-editor.png` 就是这一套，非手绘）。禁用后模型「不进生成下拉/runtime」——机制完整可用。 | `src/ui/onboarding/ModelChipGroups.tsx`、`src/ui/onboarding/ModelEnableEditor.tsx`（含批量操作） |
| **覆盖有缺口，且缺口是通用模式，不是「即梦一家的事」**：机制接在「已适配平台」通用卡（`VendorOnboardCard.tsx:352-357`，`connected={hasApiKey}` 时 `onToggle` 生效）和「自定义中转站」卡（`CustomVendorCard.tsx` → `ModelEnableEditor`，本方案截图用的就是这条真实路径）上；但**账号/本地类接入卡**——`DreaminaMemberCard.tsx`（即梦会员）、`ComfyuiLocalCard.tsx`（本地 ComfyUI）、`LocalModelCard.tsx`（本地 Ollama/LM Studio/LocalAI）——**一个都没接**这套 `ModelChipGroups`/`ModelEnableEditor`（grep 命中数分别为 0、0、0，对照 `AntigravityConnectionCard.tsx` 命中 4 次）。即梦会员只有「退出登录」一个全有全无的开关。 | `src/ui/onboarding/VendorOnboardCard.tsx:352-357`；`src/ui/onboarding/CustomVendorCard.tsx`；`src/ui/onboarding/DreaminaMemberCard.tsx`（无匹配）；`src/ui/onboarding/ComfyuiLocalCard.tsx`（无匹配）；`src/ui/onboarding/LocalModelCard.tsx`（无匹配）；对照 `src/ui/onboarding/AntigravityConnectionCard.tsx`（4 处命中） |
| **一个更深的真实约束**（截图过程中实测踩到，不是猜测）：对「已适配平台」通用卡而言，`onToggle` 只在 `hasApiKey===true` 时生效；而 `hasApiKey` 要求 `apiKeyDecryptStatus()==='ok'`（即 safeStorage 密文能解出来），**光填一次 key 还不够**——renderer 写入 key 的路径会强制把 key 记录标 `enabled:false`，进而触发 `depublishVendorForDisabledCredential` 把供应商也拉黑，要等一次真实的 adapter 认证成功才会翻正。这意味着「已适配平台」类卡片的隐藏开关，在用户刚填完 key、还没跑成功一次生成之前，是**不可见**的（因为整卡都还在「填写 Key」态，见截图 `d`）。 | `electron/catalog/rendererCatalogMutation.ts:127-138`（`sanitizeRendererVendorApiKeyMutation` 强制 `enabled:false`）；`electron/catalog/catalogStore.ts:469`（`!enabled → depublishVendorForDisabledCredential`）；`electron/catalog/credentialPublication.ts:13-18`；`src/ui/onboarding/onboardingDrawerConnections.ts:33-36`（`connectedKnown` 门槛注释：「A stored credential is not a verified connection」） |

### 2.4 ④「记住手选的供应商」——已有明确单点，与 09-06 决策一致（阶段二的留白）

| 现状 | file:line |
|---|---|
| 供应商偏好目前是**全局单一顺序**，无逐模型维度：`VendorPreferenceSettings.orderedVendorKeys` 就是一份 `string[]`，没有 per-model 的位置。 | `electron/shared/contracts/vendorPreference.ts:4` |
| 切模型再切回：只在**没有离开过当前 (value, vendor)** 时才保留供应商（`current` 命中直接返回）；一旦离开过，`pickHealthiestProvider` 按全局 `orderedVendorKeys` 重新选，不管用户上次在**这个模型**上手动点过哪家 chip。 | `src/workbench/common/useDedupedModelSelect.ts` 的 `onModelPick`（`current` 命中分支 → 否则调 `pickHealthiestProvider`） |
| 09-06 的方案文档明确说这是**阶段一的有意留白**：「临时点另一家 chip 只对这次使用」；本方案就是它点名的「阶段二」。 | `docs/plan/2026-09-06-vendor-preference-auto-fallback.md` §1（"用户 2026-09-06 拍板覆盖了…"上一段） |

---

## 3. 方案：四个数据模型改动

统一收进**一张新的模型偏好合同**（不复用 `VendorPreferenceSettings`——那份是「供应商顺序」单一职责，混进模型级字段违反 R9/单一职责；但复用它的**持久化/IPC/UI 骨架**，因为这套骨架已经被 09-06 拍板验证过一次，不重新发明）：

```ts
// electron/shared/contracts/modelBoxPreference.ts（新文件，与 vendorPreference.ts 平级、同构）
export const MODEL_BOX_PREFERENCE_SCHEMA_VERSION = 1 as const
export type ModelBoxPreferenceSettings = {
  schemaVersion: 1
  /** ② 模型级手动顺序：canonicalId 数组。未出现的模型排在这份顺序之后，
   *  按原有 catalogLifecycle 规则回退——不是「取代」原排序，是「插在它前面多一级」。 */
  modelOrder: string[]
  /** ③ 隐藏名单（黑名单式，不是白名单）：canonicalId 集合。
   *  黑名单而非白名单的理由见「先查别人」§1 表格 Claude Code 行下方的取舍——
   *  新增模型默认可见，用户主动隐藏的才消失，符合「加新模型不需要用户额外操作才能看见」的默认预期。 */
  hiddenModelIds: string[]
  /** ④ 逐模型记住的供应商：canonicalId → vendorKey。
   *  只在用户显式点过供应商 chip / 供应商下拉时写入；自动选家（pickHealthiestProvider）不写。 */
  preferredVendorByModel: Record<string, string>
}
```

| 需求 | 数据字段 | 单一 owner 层 | 消费点（唯一，不新开第二条判断路径） |
|---|---|---|---|
| ① 供应商全 | 无新字段——是**读路径 bug**，改法是让 `nomi:model-catalog:vendors:list` 也调一次 `ensureBuiltinModelSeeds()`（`electron/main.ts:442`，照抄 `:443-448` 的写法）。是否让「未配置」的家也进排序表是待拍板项，见 §5。 | `electron/catalog/catalogStore.ts`（播种） | `AiModelsSection.tsx` 的 `configuredVendorEntries` 计算不变，或按 §5 拍板结果新增「未配置」分组 |
| ② 模型排序 | `modelOrder: string[]` | `electron/settings/modelBoxPreferenceSettings.ts`（新，仿 `vendorPreferenceSettings.ts`） | `sortModelsByCatalogLifecycle` 前插一级：先按 `modelOrder` 里的位置排，不在列表里的模型退回现有四档规则（`src/config/modelIdentity.ts:63-73` 改造，不新开第二个排序函数） |
| ③ 隐藏模型 | `hiddenModelIds: string[]` | 同上 | `dedupeModelOptions`/`buildModelSelectOptions` 入口前过滤一次（`useDedupedModelSelect.ts`），**不复用/不新增 `Model.enabled`**——`enabled` 是「所有人能不能用」（Open WebUI 的 Enabled 层），`hiddenModelIds` 是「我自己想不想看见」（Open WebUI 的 Hide 层），两层字段各自单一 owner，写反了会把「我藏起来」误标成「全局禁用」波及别的设备/未来的团队协作场景 |
| ④ 记住供应商 | `preferredVendorByModel: Record<string,string>` | 同上 | `useDedupedModelSelect.ts` 的 `onModelPick`：`current` 未命中时，先查 `preferredVendorByModel[canonicalId]`，命中且该供应商仍可用才用它，否则才落回 `pickHealthiestProvider`（全局序）——优先级与 OpenRouter sticky routing 一致（见「先查别人」§1） |

**关于③覆盖缺口的修法**（不是新机制，是把已有机制接上三张漏掉的卡）：`DreaminaMemberCard.tsx`、`ComfyuiLocalCard.tsx`、`LocalModelCard.tsx` 在已登录/已连接态各自的模型列表下，接入同一份 `ModelChipGroups`（`connected` 传各自真实的连接状态，不新造判据）。这不是本方案的新数据字段，是「通用机制 + 通用消费点」原则下把遗漏的三个消费点补齐——③本身的「隐藏」用的是上面 `hiddenModelIds`，「启停」用的是既有 `Model.enabled`，两者都已有 owner，这里只是把 UI 接上。

---

## 4. 为什么收成一张表，不是四张独立小文件（D2/D3，回应 §0 的核心取舍）

**结构约束**：这四条字段**在同一个消费点被同时读取**——`useDedupedModelSelect.ts` 一次 hook 调用里要同时知道「排第几」「藏不藏」「上次选哪家」。09-06 那次只做供应商顺序时就是独立一份 `vendorPreferenceSettings.ts`，如果②③④也各开一个文件/一条 IPC，`useDedupedModelSelect` 就要发起 3 次独立读取 + 3 次独立失败态处理——用户看到的失败模式会变成「排序保存了，隐藏没保存」这种半成品状态，且 3 份文件 3 份 schema version 各自独立演进，未来要加第五个字段（比如「最近用过」）又要决定塞进哪一份。收成一张表，失败态只有一种（存一次、读一次），且和 `VendorPreferenceSettings`（真正独立的供应商级顺序，消费点不同、不共享读取时机）保持关注点分离——不是所有「偏好」都该合并，只有「同一次读取里必须同时用到」的才合并。

---

## 5. UI 落点（§1.5 控件层级 + §1.7 设置区信息架构）

| 控件 | 落点 tab | 判据 |
|---|---|---|
| ② 模型排序 | 「AI 策略」tab，紧邻现有「优先供应商」区（`VendorPreferenceOrderSection.tsx` 正下方），新增一个同构的「模型排序」区块 | §1.7.2：「已经接好的东西默认怎么用」是策略，供应商顺序和模型顺序回答的是同一句「怎么用」，必须同住一个家，否则用户要在两个 tab 里找「排序」这一件事 |
| ③ 隐藏模型 | 保持在「模型」tab 内联（不新开 tab/区块）——用户已经在这里管每个模型的启停（`ModelChipGroups`），「隐藏」只是给现有 chip 群多一个动作，不是新控件家族 | §1.5.2「一功能一个家」：启停和隐藏都是「这个模型在选择器里的呈现方式」，同一个 chip 上用一个 hover 出现的次级动作（L2 情境层，非常驻），不新增常驻按钮 |
| ④ 记住供应商 | **不需要任何新 UI**——是行为改变，不是设置项。用户已经在用的「点供应商 chip」动作本身就是「记住」的触发点，多一个「记住我的选择」开关反而是噪音（§1.5.4 反例同款：把已经在做的事包一层开关） | — |
| ① 供应商全（若拍板成「未配置也要能排位置」） | 排序列表里新增「未配置」分组（灰显 + 「未接入」角标 + 点击跳转填 key，复用现有 `openModelCatalog()` 事件），排在已配置列表下方，与已配置列表视觉分隔（§1.5.3「分段要有名字」） | 若拍板成「只修 bug」则无 UI 改动 |

---

## 6. 删除清单（R1：加新必删旧）

| 不做 | 为什么 | 用户要它时怎么找到 |
|---|---|---|
| 不新建 `enabled` 字段的第二份（`hiddenModelIds` 与 `Model.enabled` 是两层，不是重复） | 见 §3 表格③行——写重了会把「个人隐藏」和「全局禁用」的语义混淆，未来接团队协作时会是真正的 bug 温床 | 若真需要「全局禁用」就是现成的 `enabled`，无需新入口 |
| 不给④加「清除本模型的记忆」按钮（本次不做） | 用户只要点别的供应商 chip 就是覆盖旧记忆，天然可逆，多一个「清除」按钮是 L4 溢出功能，用量 <1/10 | 需要时走「重置所有设置」等既有全局重置路径，不单开 |
| 不做「供应商顺序」和「模型顺序」的合并 UI（一个列表同时排供应商又排模型） | 两者是不同维度（供应商是「谁提供」，模型是「哪个能力」），合并会让用户分不清在排什么，OpenRouter/LiteLLM 也是两级分开配置（09-06 doc §3 已查） | 需要「这个模型固定用这家」时用④（点 chip），不是排序 |
| 不做「未配置供应商」的自动排序推荐 | 排序应该只反映用户已经验证过、真信任的家；给未配置的家算权重推荐，是臆测用户还没做出的决定 | — |

---

## 7. 卡点表（R14.2 路径四问）

| 问题 | ② 模型排序 | ③ 隐藏模型 | ④ 记住供应商 |
|---|---|---|---|
| ① 怎么知道有这个功能 | 「AI 策略」tab 里「优先供应商」正下方新增同构区块，视觉上明示「还能排模型」 | chip 群本身已知；隐藏动作走 hover 次级菜单，首次使用靠 tooltip 提示（不新增常驻可见性） | 无感知——本来就在点 chip，行为本身即文档 |
| ② 动手前知道代价吗 | 上移/下移即时生效，无花费/等待，`VendorPreferenceOrderSection` 已验证过这个心智模型零学习成本 | 隐藏是可逆的（露出「已隐藏 N 个 · 查看」入口，仿 Open WebUI「移除但不删除」），不是删除，无数据丢失风险 | 零代价——只是记住了本来就做过的选择，无需额外确认 |
| ③ 空了/错了看到什么 | 排序保存失败沿用 `VendorPreferenceOrderSection.tsx` 已有的 `saveError` 红字提示模式 | 全部隐藏后模型下拉不能变成空白（复用现成的 `connectVendorOption`/空态诚实提示范式，不能让用户以为「没有模型了」） | 记住的供应商如果后来被禁用/删除，`onModelPick` 要能从 `preferredVendorByModel` 命中但校验「该供应商仍可用」失败后**优雅回退**到全局序，不能报错卡死 |
| ④ 凭什么信结果是对的 | 排序变化即时反映在下一次打开模型下拉，可肉眼验证（无需生成） | 隐藏立即从下拉消失，可肉眼验证；已经用该模型生成过的旧节点不受影响（只影响新选择，不回溯改历史记录） | 验收标准明确可写成断言：切模型 A→B→A 三次，每次 A 都停在用户手动选的供应商，不回到全局默认 |

**底部必答（步骤数）**：②③④三条都是「打开设置/hover 一次点击」1 步到位，符合 R28「防线建在最早能拦住的那层」——没有可以再砍的步骤。

---

## 8. 回滚

回滚只删除 `electron/shared/contracts/modelBoxPreference.ts`、`electron/settings/modelBoxPreferenceSettings.ts`、`electron/settings/modelBoxPreferenceIpc.ts`、渲染层的对应 hook 与 UI 区块，以及 `useDedupedModelSelect.ts`/`modelIdentity.ts` 里新增的过滤/排序调用点（保留原有逻辑不动，新增调用点是纯前置分支，删除即恢复原行为）。不触碰 `Model.enabled`、`VendorPreferenceSettings`、catalog 其余字段；未知的 `model-box-preference.json` 文件按「忽略并保留」处理。①的 bug 修复（main.ts 补一行 `ensureBuiltinModelSeeds()`）本身是防御性重复调用，不需要回滚路径。

---

## 9. 验收门（隔离走查，零额度）

- **契约**：`modelBoxPreference.ts` 的 normalize 函数处理未知模型 id、重复、超长 id、schema 版本非法 → 全部降级为默认值，不抛错。
- **①**：新起一个带旧版本 catalog（缺最新内置供应商种子）的隔离 profile，`nomi:model-catalog:vendors:list` 返回值必须包含全部 `BUILTIN_VENDOR_SEEDS`，不需要重启进程。
- **②**：设置里把某个非首位模型移到第一，关闭重开设置，画布节点模型下拉里它确实排在最前。
- **③**：隐藏一个模型后，画布节点模型下拉、批量下拉（`buildVendorExplicitModelOptions`）两处都不再出现该模型；已经用它生成过的旧节点仍正常显示历史结果（不受影响）；「已隐藏 N 个」入口能把它找回来。
- **④**：真实旅程 —— 配置两家同模型 → 在模型 A 上手动点供应商「Kie」chip → 切到模型 B → 切回模型 A → 断言当前生效供应商仍是 Kie（不是全局优先序的 APIMart）。对照组：从未手动选过的模型 C，切换后仍遵循全局序（证明④只影响「手选过」的模型，没有意外改变默认行为）。
- **静态门**：`check:docs-index`、`check:doc-status`、`check:filesize`、`check:boundaries`、`typecheck`、`gates` 全绿；本文档落地时的 PR 按 R22 触发 unit + 相关 journey。
