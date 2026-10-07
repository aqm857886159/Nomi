# 方向检查：参数控件「按键名猜角色」（LAW11-ALIAS-DEDUPE）

> 触发：提交 hook 的 RW 统计——`src/workbench/generationCanvas/nodes/controls/` 近 14 天第 5 个 fix。
> 交给协调会话拍板；本页不改产品方向。

### 0. 一句话根因

参数控件「管的是哪件事」（比例 / 时长 / 清晰度）由**键名别名表**猜，而 `size` 这类键名本身不说明它管什么——同一个名字在一家是 `16:9`，在另一家是 `720P` / `1024x1024`；档案里没有「这个参数是比例」的显式声明。

### 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 本次 LAW11-ALIAS-DEDUPE（Agnes 视频 2.5 / Image 2.1 选不到比例） | 去重把 `size`（清晰度）当比例别名，吞掉了真正的 `aspect_ratio` / `ratio` | 按键名猜角色 |
| cf9e7c009 变体 owner（卡上 Fast、派出去 standard） | 同一事实两处推导 | 一事实多 owner（不同类） |
| 9800e5251 ComfyUI combo 选项类型 | wire 类型被转字符串 | 值类型保真（不同类） |
| af2fbc141 视频卡悬停播放器 | 组件生命周期 | 不同类 |
| bc45ad4b3 React 19 类型 | 依赖升级 | 不同类 |

同目录 5 个 fix 里只有本次属于「按键名猜角色」这一类；其余四个各是别的概念，不构成同一类反复修补。

### 2. 为什么这一类会一直出现

别名表（`ASPECT_RATIO_ALIASES` 等）是「键名 → 角色」的静态映射，新接一家供应商只要它把清晰度叫 `size`，去重、写回、主参数 chip 就一起认错。宿主侧 #1023 已经改成**按选项判比例**（`electron/shared/aspectRatioValue.ts`），渲染层这一处还在按名字猜——同一语义两个判据。

- ⑪ 能选到：直接命中（`tests/experience-laws/parameterReachability.test.mjs` 首跑 4 类缺口）。
- ⑩ 说的=摆的：间接——角色认错时，Agent 说的比例会落到清晰度那个键上。
- ⑫：不适用。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 时长 / 清晰度别名也会撞同样的坑（例如某家把清晰度叫 `quality`、把时长叫 `length` 但取值是档位名） | ⑪ 门：`pnpm exec vitest run tests/experience-laws`，新接模型时表外缺口当场红 |
| 档案把比例放在 `size`、又另有像素档 `image_size` 时，两个都被认成比例或都不认 | 同上；`parameterControlModel.test.ts` 的类测试 |

### 4. 靶子独立性检查

⑪ 的清单从内置目录种子与档案自动生成、入口调的是生产渲染函数，不是这条线手写的期望；判据「声明 ⊆ 可选」与修复实现无关。

### 5. P0：这些是我们独有的吗

是。「哪个供应商参数键管比例」是供应商适配的领域知识，没有通用库知道 Nomi 的档案。判据本身复用仓内唯一 owner `optionsAreAspectRatios`，不新写。

### 6. 对比与推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 无：没有通用库描述「供应商参数键 ↔ 语义角色」 | — | — | 不适用 |
| 补（本提交） | 在唯一共享边界 `parameterEquivalentKeys` 让 `size` 一类按**自己的选项**判是否比例；角色同判据 | 一个函数 + 类测试 | 只覆盖比例；时长 / 清晰度仍按名字 | **推荐，现在做** |
| 重写（限档案契约） | 给 `ModelParameterControl` 加显式 `role`，档案声明、别名表退为迁移兜底 | 全部档案补字段，档案门岗同步 | 动面大，要逐档案对账 | 等 ⑪ 再抓到第二个角色类缺口时再做 |
| 删 | 删别名表 | 旧项目 meta 里多键写回失效 | 高 | 不推荐 |

### 7. 用户要权衡的核心

现在只修「比例」这一个角色、保留按名字猜其它角色，换来改动小；还是一次把「参数是什么」改成档案显式声明，换来这一类不再回来但要改全部档案。

## 特征测试清单

- `src/workbench/generationCanvas/nodes/controls/parameterControlModel.test.ts`「参数去重：size 只有选项是比例时……」五条（变异：换回旧实现 4 条红）。
- `tests/experience-laws/parameterReachability.test.mjs`（变异：换回旧实现，表外新缺口红）。
