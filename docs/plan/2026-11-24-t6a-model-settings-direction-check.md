# T-6a 模型设置方向复盘 · 2026-11-24

**全图**　交接处表外。已批 [ModelSurfaces 清单](../design/boards/2026-11-07-model-surfaces/ModelSurfaces.board.json) 给出七个样张，分别覆盖账户、旧连接、用量、策略、英文、暗色与窄窗。[七组实窗对照](../evidence/2026-11-24-t6a-model-settings/walkthrough.md) 的修前版本在 `97f03c5d7`。合并的另一侧 `1730b7ea3` 已交付 S6 的账户和 Key 双读面。

### 0. 一句话根因

旧验收把「能点击、能持久化、能截图」当作通过条件，遗漏了创作者看到的词、数和开关方向是否表达真实动作。

### 1. 问题归类

| 原始证据 | 直接原因 | 类 |
|---|---|---|
| Main、英文、暗色、窄窗及旧连接图 | 卡片列缺分隔，链接可拆行；接入主动作、旧连接总数与搜索出现条件偏离样张 | 信息层级与数据条件 |
| 用量与策略图 | 单价省略约号，默认模型无论是否重名都追加平台；上传说明未按样张分层 | 来源和动作的显示语义 |
| `/tmp/t6a-red.log` 两例全红 | `ask` 实读为关、`allow` 实读为开，与「先问我」相反 | 意愿与持久值映射 |
| `bacbc2539`、`252d06033` 和合并双亲 | S6 分开账户与 Key 并共用失败类型；T-6a 已拒收 HTTP 成功包内的业务错误。只取任一侧会丢另一侧语义 | 双亲合同合并 |

### 2. 为什么会复发

铁律⑫「点了=以为的」。修前走查已经记下键盘切换、偏好读回和 7/7 通过，但它许可正负方向相反的开关。验收最早可在设计卡 ★9 拦住：请独立验收者从样张直接写下“旧值 ask → 开 → 点后 allow”，反向也测。默认模型适用⑪，显示名可简化，同名跨平台仍须能分别选中并保存原身份。

### 3. 可验证预测

| 保留旧验收会漏什么 | 验证方法 |
|---|---|
| 修改开关极性，原来「点后值改变」仍可绿 | 对 ask、allow 各断言可访问名称、初始选中状态及一次点击写出的精确值 |
| 无差别追加或删除供应商后会分别出现冗长或重名不可辨 | 给同一媒介分别输入单一名称和跨供应商同名模型，核对标签并往返解码身份 |
| 接入入口、旧连接数量、约价与实扣可同时漂移而截图仍能生成 | 走四条与五条旧连接的边界，按对应样张读 CTA、总数，按独立报价和回执各核一列 |

### 4. 靶子独立性

原七张截图和点击脚本均由实现线产出；已批样张与监督指出的差异来自另一条线。用量应匹配夹具提供的独立报价和实际积分回执，余额应匹配两个来源各自的响应。尚无本次因评测掉分被回滚的证据。隔离响应无法证明真实账户当天余额。

### 5. 这一整块归谁

这一整块：创作者在设置里辨认已接的平台、用量及参考单价，选择新建卡片的模型和公共临时托管许可。

归谁：已批界面归 ModelSurfaces；托管持久值和默认值归 electron/settings/automationPolicyContract.ts:22，设置投影归 src/workbench/settings/AiModelsSection.tsx:234；账户和 Key 归 electron/ai/onboarding/vendorAccountBalance.ts:27，业务错误识别归 electron/ai/requestPipeline.ts:544。报价文案的双语核验归 scripts/check-i18n-no-cost-claims.mjs:66（delivery.money-copy-truth）。

我们哪里绕开了它：修前 97f03c5d7 的 src/workbench/settings/AiModelsSection.tsx:243 把许可开关直接用作询问开关，src/workbench/settings/defaultGenerationModelOptions.ts:70 对所有名称追加供应商。合并结果 cabce4bb8 的 electron/ai/onboarding/vendorAccountBalance.ts:28 漏掉第一亲已有的通用业务错误识别。

自写登记 `gate-family` 现有门岗核对 Nomi 冻结的双语金额词，通用 lint 没有这份产品裁决。本轮只改原断言，登记复查日 **2026-11-30** 依据门岗账本决定去留。登记 `apimart-onboarding-balance` 保留两条官方来源及各自影响的产品动作，通用 HTTP 库无法决定何时提示充值；**2026-11-30** 复查两份响应的独立性，若供应商协议或产品已合并两个信号，再合并相应投影。

### 6. 三条路

| 路径 | 做法与代价 | 遗留风险 |
|---|---|---|
| 接入现成方案（推荐） | 本轮在原设置组件按已批样张投影；复用 DesignSwitch、目录复合身份、既有余额双读与 looksLikeLogicalError。需逐状态复验，无需改旧设置或 Key | 窄窗、翻译与未来报价仍需实窗复查 |
| 沿原方向逐屏打补丁 | 仅改文字、间距及逐屏预期，改动少 | 询问开关反向、同名误选和业务错误余额仍可能通过 |
| 删掉 | 最小可删单位是新设定的「先问我」开关；旧策略可继续执行，创作者失去修改它的入口 | 违反已批 M6；删除全部平台后缀也会使重名模型失去区分 |

### 7. 用户要权衡的核心

监督已定界面和交互方向，两侧余额合同也能同时保留。若提交涉及余额文件，文件本身已连续两次 fix，按 RW 须由用户确认本次共用既有解析器的方向；目录热点代批例外只覆盖文件自身未命中的情形。

**特征测试**　开关红例见 `src/workbench/settings/uploadPolicySwitch.test.tsx`。默认模型身份、账户来源和用量分别由 `src/workbench/settings/defaultGenerationModelOptions.test.ts`、`electron/ai/onboarding/vendorAccountBalance.test.ts`、`tests/ux/t6a-model-settings.walk.mjs` 验收。复查时若极性、复合身份或两类余额任一混淆，重开本案。
