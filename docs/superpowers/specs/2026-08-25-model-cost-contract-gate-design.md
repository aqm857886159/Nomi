# 新供应商 / 新模型成本契约门禁设计

日期：2026-08-25  
状态：待用户书面复核  
决策：B 方案——结构化成本契约 + 自动门禁

## 1. 要解决的真实问题

模型接入目前已经有官方文档出处、能力档案和真实生成 E2E 规则，但“积分能否估算、供应商是否返回实际扣费”仍靠接入者临时想起。结果是新模型可能已经能生成，却直到用户准备点击时才发现没有成本信息。

新规则不要求所有模型都有价格。它要求每次代码级接入都必须明确回答两个问题：

1. 生成前能否根据模型与参数估算成本？
2. 生成后能否从供应商响应中取得实际扣费？

能回答就落结构化字段；官方没有提供时必须显式声明不可用。任何一项被忘记，门禁直接失败。

## 2. 核心决策

### 2.1 接入完成的新定义

一个新的 curated 供应商或 curated 模型，只有同时具备以下内容才算接入完成：

- 官方 API 与能力契约（沿用 R5 / G1–G3）。
- 成本能力契约：`supported` 或 `unavailable`，二选一。
- 对应的结构测试；真实生成 E2E 仍沿用现有规则。

不得用缺字段表示“暂时不知道”，也不得把未知写成 0。

### 2.2 两层契约

供应商层负责“实际扣费”，模型层负责“生成前估算”。两者不可混在一起：同一供应商下不同模型价格不同，但任务响应中的扣费字段通常是供应商级协议。

```ts
type CostEvidence =
  | { kind: 'official-doc'; url: string; checkedAt: string }
  | { kind: 'local-runtime'; note: string; checkedAt: string }

type ProviderActualCostContract =
  | {
      state: 'supported'
      unit: 'credits'
      fieldPaths: readonly (readonly string[])[]
      evidence: CostEvidence
    }
  | {
      state: 'unavailable'
      reason: 'not_returned' | 'not_documented' | 'local_free' | 'account_specific'
      evidence: CostEvidence
    }

type ModelEstimateCostContract =
  | {
      state: 'supported'
      unit: 'credits'
      pricing: {
        cost: number
        specCosts: readonly { specKey: string; cost: number; enabled: boolean }[]
      }
      evidence: CostEvidence
    }
  | {
      state: 'unavailable'
      reason: 'not_published' | 'variable' | 'local_free' | 'account_specific'
      evidence: CostEvidence
    }
```

第一版只允许 `credits`，因为当前产品展示的是积分。供应商返回美元、人民币等金额时必须单独声明为暂不支持积分估算，不能私自换算。未来增加货币单位时扩展判别联合，不改变供应商/模型接口。

## 3. 单一真相源

### 3.1 供应商实际扣费

`electron/vendor/cost.ts` 中的供应商注册表升级为结构化 `ProviderActualCostContract`，实际扣费解析器直接读取该注册表：

- `supported`：按 `fieldPaths` 安全提取有限非负数。
- `unavailable`：返回 `undefined`。
- 未登记的新 curated 供应商：门禁失败。

APIMart 与 KIE 的现有字段成为首批 `supported` 契约，不再另写第二份字段表。

### 3.2 模型估算

curated 模型定义新增 `estimateCost` 契约：

- `supported`：seed 时把同一份 `pricing` 写入 catalog；画布继续只消费 catalog pricing。
- `unavailable`：catalog 不写 pricing；现有 UI 自动隐藏成本组件。
- 未声明：门禁失败。

这样规则数据、运行时估算和 UI 不会各维护一份价格。

### 3.3 用户自建模型边界

用户在设置页手动接入的自定义中转、ComfyUI 工作流和临时模型不属于 curated 代码接入，不因缺少成本契约而被禁止保存。它们没有可靠 pricing 时沿用当前诚实降级：不显示成本组件。

本规则约束 Nomi 代码库主动策展和发布的新供应商 / 新模型，不把官方未知信息转嫁给终端用户填写。

## 4. 自动门禁

新增 `pnpm run check:model-cost-contracts`，并接入 `pnpm run gates`。门禁读取 fresh curated seeds 与供应商成本注册表，检查：

1. 每个新 curated 供应商都有实际扣费契约。
2. 每个新 curated 模型都有估算契约。
3. `supported` 必须有 `credits` 单位、官方出处和有效字段路径 / pricing。
4. `pricing.cost`、规格加价必须是有限非负数，小数保持原值。
5. 规格 key 非空且不能重复。
6. `unavailable` 必须有闭集 reason 和证据，不能用自由文本糊弄。
7. 模型声明 `supported` 时，seed 后的 catalog pricing 必须与契约逐项相等。
8. 供应商声明 `supported` 时，实际解析器必须用同一份契约通过样例测试。
9. 声明 `unavailable` 的模型不得残留 pricing；未知不能伪装成 0。

### 4.1 存量迁移

现有 curated 模型多数尚未登记 pricing。为避免门禁永久红，新增只减不增的存量基线：

```json
{
  "providersWithoutActualCostContract": ["..."],
  "modelsWithoutEstimateCostContract": ["vendor/model", "..."]
}
```

- 基线只记录启用门禁前已经存在的 key。
- 新供应商 / 新模型不得加入基线。
- 某条补齐契约后，门禁要求同步从基线删除，防止形成永久豁免。
- 本次先把已完成证据核对的 APIMart、KIE 实际扣费契约移出供应商基线；模型价格只在有官方证据时补，不猜值。

## 5. 工程规则文字

在 `AGENTS.md` 的 R5 摘要和 `docs/engineering-rules.md` 的模型接入清单中补充：

> 接入新供应商或新模型时，必须同时提交成本能力契约。供应商声明实际扣费字段或不可用原因；模型声明可验证的 pricing 或不可用原因。没有官方证据不得猜价格，未知不得写 0。缺失契约由 `check:model-cost-contracts` 阻止交付。

R5 的“计费口径”由自由文本要求升级为结构化数据和门禁，沿用 G1–G3 的原则：出处落库、不落注释。

## 6. 用户体验不变量

- 当前模型成本可完整计算：生成按钮显示“约 N 积分”。
- 任一必要价格未知：完全不显示成本组件。
- 批量任务只有全部节点可估算时才显示合计。
- 实际扣费字段存在且合法：结果 provenance 显示实际扣除。
- `unavailable`、缺失响应字段或非法值：不显示实际扣除，不显示 0，不阻塞生成。
- 成本契约只提供信息，不新增第二条生成或确认路径。

## 7. 测试与验收

### 7.1 门禁负向测试

- 新增 curated 供应商但没有 actual contract，门禁失败。
- 新增 curated 模型但没有 estimate contract，门禁失败。
- supported pricing 为负数、NaN、重复 specKey 或无官方证据，门禁失败。
- unavailable 无 reason / evidence，门禁失败。
- unavailable 模型仍写 pricing，门禁失败。

### 7.2 正向测试

- APIMart `data.credits_cost` 与 KIE `data.creditsConsumed` 继续解析为实际积分。
- supported 模型将小数 pricing 原样 seed 进 catalog。
- unavailable 模型不写 pricing，真实 Electron 走查中没有成本组件。
- 新规则加入全门禁后，`pnpm run gates` 全绿。

## 8. 不做的事

- 不要求用户手工填写第三方定价。
- 不根据供应商余额、美元价格或历史任务猜积分。
- 不自动把货币换算成积分。
- 不因成本未知禁止普通手动生成；自动化策略是否允许未知成本仍由现有 spend policy 决定。
- 不在本规则内一次性补齐全部存量模型价格；只建立新接入不能继续遗漏的结构保证。

## 9. 回滚

实现可通过删除成本契约门禁、恢复成本注册表的旧类型并移除规则文字回滚。catalog 的 pricing 仍是可选字段，旧项目和用户自建模型无需数据迁移。
