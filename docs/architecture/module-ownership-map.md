# Nomi 模块归属地图（一功能一个家）

日期：2026-09-01
状态：现役约定（配 `check:boundaries` 门岗执行 · R21）
依据：`docs/audit/2026-08-31-architecture-coupling-audit.md`（分析二/四/五）

> **这份文件干什么**：给「一个职能住哪、允许有哪些卫星、什么绝对禁止」定唯一答案，
> 让人和 agent 写新代码时有据可依、不再往第 N 个门牌号里塞。**机器那半由
> `check:boundaries` 拦**（渲染层越界 / 主进程反向 / 新增静态硬环，基线只减不增）；
> **这份文件负责机器拦不住的那半**——同一职能别再开新家。
>
> 读法：先看「依赖方向铁律」（一句话记住哪条箭头合法），再按职能查表。
> 存量违规已由门岗基线冻结、只减不增（二期档案归一后：104 处 `src→electron` + 6 个静态硬环 = 110；
> 归一前 137 + 6 = 143）；清零路线见审计分析六（分期，搬迁类须等在途大线合入）。

---

## 依赖方向铁律（记住这张图，其余都是它的展开）

```
  ┌────────────────────── 渲染层 (src/) ──────────────────────┐
  │  UI  →  bridge (src/desktop/bridge.ts)  ─────┐            │
  │  UI  →  design / i18n / utils / config       │            │
  └──────────────────────────────────────────────┼────────────┘
                                                  │ IPC
  ┌───────────────────────────────────────────────▼───────────┐
  │  主进程 (electron/)  →  中立契约层 electron/shared/contracts/ │  ← 待建（第二期）
  │  主进程  →  持久化 (projects/settings/workspace/memory)      │
  └────────────────────────────────────────────────────────────┘

  合法箭头：UI → bridge → electron（经 IPC）；UI → design/i18n/utils/config；
            electron → contracts；electron → 持久化。
  禁止箭头：✗ UI → electron 直连（value import）   ✗ electron → UI（反向）
            ✗ UI → scripts（门岗脚本）             ✗ 新增完全静态循环
```

**为什么渲染层不许直捅主进程**：value import 会把主进程常量/函数打进渲染 bundle
（体积 + 泄漏主进程实现）；伸手拿类型则暴露「跨进程契约没有中立的家」这个根因。
正解是走 `src/desktop/bridge.ts`（IPC）或（第二期建成后）中立契约层。

---

## 一功能一个家（canonical 清单）

| 职能 | Canonical 家（唯一真源） | 允许的卫星 | 禁止 |
|---|---|---|---|
| **模型档案定义** | video → `electron/shared/videoCapabilities/`（含 barrel `index.ts` 为渲染层导出的唯一公共面）；image/3D → `src/config/modelArchetypes/` | 无 | 新增 re-export 壳（历史 33 个已于二期清净，见下） |
| **跨进程契约 / 类型** | `electron/shared/contracts/`（**待建中立层**，第二期） | 无 | `src/` 直捅 `electron/*/…Contract.ts` / `…Types.ts` 拿类型 |
| **供应商/模型目录存储 · 生命周期** | `electron/catalog/` | 无 | 渲染层直引 catalog（走 bridge）；与 providerAdapter/certification 直环 |
| **供应商适配** | `electron/providerAdapter/` | 无 | 与 `catalog` / `integrationCertification` 互相直引成硬环（第三期解耦） |
| **集成认证 / 会话** | `electron/integrationCertification/` | 无 | 同上直环；`integrationSession.ts`（1696 行）新增职责（第三期拆） |
| **AI 调用 / 供应商语言模型** | `electron/ai/` | 无 | 反向被 catalog/adapter 直引 |
| **定价 / 成本（算价）** | `electron/productionRun/catalogPricingResolver.ts`（+ `shotPricing.ts`）唯一算价 | `src/workbench/generationCanvas/spend/` 仅做**展示格式化** | 渲染层重新 derive 价格数值（碰钱双真相源，P2/R20） |
| **生产提交链** | `electron/productionRun/` + `electron/capabilityCore/` | 无 | 绕过 reducer 另开第二写入口 |
| **Onboarding（引导 UI）** | `src/ui/onboarding/` | `src/workbench/onboarding/`（工作台内嵌壳） | 供应商专属逻辑（如 `useAntigravitySettings`）混进 UI（挪 `src/config`/领域）；直捅 `electron/shared/antigravity.ts` |
| **画布节点渲染分发** | `nodes/registry.ts`（路由）+ `nodes/BaseGenerationNode.tsx`（分发） | `nodes/render/`、`nodes/controls/` | 渲染逻辑再散出第五处（第四期收敛低内聚子目录） |
| **画布状态** | `src/workbench/generationCanvas/store/`（+ 顶层 `workbenchStore.ts`） | 各面 `*Store.ts` slice | store ↔ 节点 UI 回边成环（第四期打断软环） |
| **设计系统 / token** | `src/design/` + `src/styles/`（只减不增，R10） | 无 | 组件里写任意 px 字号/圆角、hex 色（`check:tokens`） |
| **i18n 文案** | `src/i18n/`（`locales/`、`resources`） | 无 | 硬编码 UI 文案（`check:i18n`） |
| **资产（导入/媒体探测）** | `electron/assets/` + `electron/export/mediaProbe.ts` | `src/workbench/generationCanvas/assets/`（渲染层资产 UI） | 主进程媒体探测散进 providerAdapter（现存 1 处跨引，见审计 C8） |
| **设置 / 自动化策略** | `electron/settings/`（契约 + 存储） | `src/workbench/settings/`（设置 UI） | 渲染层直捅 `settings/*Contract.ts`（应经中立层） |
| **持久化** | `electron/projects/` · `electron/settings/` · `electron/workspace/` · `electron/memory/` | 无 | 渲染层直读磁盘（走 bridge） |
| **门岗脚本** | `scripts/` | 无 | `src/` 或 `electron/` 生产码 import `scripts/`（`check:boundaries`） |

---

## 疤痕组织清零清单（P1：搬家不留转发壳）

- **✅ 已清（二期，`arch/phase2-archetype-consolidation`）：33 个 `src/config/modelArchetypes/*` 纯 re-export 壳**
  （29 个审计点名的 video 档案壳 + `videoGenerationRecommendation` + `runninghubVideoArchetypes`
  + `seedanceApimart` + `seedance25Apimart`）。做法：`electron/shared/videoCapabilities/index.ts`
  升为「渲染层可见的唯一公共面」（把各 video 档案的具名导出集中在这个 barrel），
  渲染层 `src/config/modelArchetypes/index.ts` 与相关测试改为从该 barrel import，
  同 commit 删净 33 个壳（P1）。**净效果**：34 条分散 `src→electron` value 越界收敛为 **1 条**
  （`modelArchetypes/index.ts → videoCapabilities/index.ts`，即渲染 barrel 从 canonical 家的 barrel 取值），
  `check:boundaries` 基线 143 → 110（棘轮下调）。纯搬迁、全量测试 delta = 0。

- **✅ 已清（二期单元 2）：video 双登记**。渲染层 `MODEL_ARCHETYPES` 的 video 块改为从
  `sourceBackedVideoProfiles()` **整块派生**（35 项手列 + 35 具名 import 删净），登记点唯一
  = `registry.ts::SOURCE_BACKED_PROFILES`。顺序敏感性用证据处理：全 pattern 语料（1042 条，
  raw/大小写/前缀/末段变形）在新旧数组序上跑三趟匹配逐一对比，渲染层与主进程身份表两侧均
  diffs=0；唯一同串反序对 `"veo3.1"`（Runway 平台判别串 vs Veo 家族键）由
  `LEGACY_RESOLUTION_ORDER_PINS` 钉住渲染层存量赢家。跨档案同串的全部存量赢家锁在
  `src/config/modelArchetypes/resolutionOrder.test.ts`（重排/新增翻转赢家即红）。
  ⚠️ 已记录存量分裂：裸 `"veo3.1"` 渲染层解析 runway-video、registry 平局判据出 veo-3.1，
  两侧本就相反——修它属行为变更，单独立项裁决（契约：
  `docs/fixes/2026-09-02-archetype-video-registry-derivation.root-cause.json`）。

- **原则（新代码即刻生效）**：迁移文件时，re-export 壳必须与迁移**同 commit 删除**，
  不留垫片。新增壳 = 违反 P1，评审直接打回。

---

## 边界怎么被机器守住

- `check:boundaries`（`.dependency-cruiser.mjs` 规则 + `scripts/boundaries-baseline.json` 冻结存量）：
  `src→electron`、`electron→src`、`src→scripts`、新增静态硬环——四个方向，棘轮只减不增。
  加规则前先验它会红（R17）；修掉一处越界必须同步删 baseline 一行。
- 循环的软/硬之分：懒加载 `import()` 环（约 495 个，`registry.ts` 主犯）是**认知耦合**不是
  加载顺序炸弹，故意不入门岗（否则永红被无视）；只拦「每条环边都非懒加载、非纯类型」的静态硬环。
- 分期重组路线见审计分析六。一期加门岗+地图（零搬迁）；二期档案归一（清 33 转发壳、
  video 档案 canonical 家收敛为 `videoCapabilities` barrel，见上「疤痕组织清零清单」）。
