# HuggingFace Minimax LoRA 生态扫描（2026-09-07）

> 目的：回答「把 HF 上的 Minimax LoRA 收进 Registry 做成可看效果、一键接入」是否可行、怎么分区。
> 方法：HF API 聚合搜索（minimax lora / minimax-h3 lora / h3 lora / minimax h3 + 对照 hunyuan、wan）+ 111 个 LoRA 条目逐条 detail 抓取。全部真实数据，2026-09-07。

## 0. 结论先行

**可行，且生态真实存在。** 但两件事必须分开做：**① 目录收录（开放目录，HF 就是自己的上游）** 与 **② 接入 Nomi（分型，多数只能走本地 ComfyUI）**。治理线：约 1/3 无 license、真人 likeness 与 NSFW 内容真实存在 → 开放目录照抄 HF/Civitai 的分区 + 分级 + 免责模式，**不做**的只有「内置策展区」（红线不动：只收自有/授权/无真人内容）。

## 1. 存量与热度（量化）

| 指标 | 数值 | 含义 |
|---|---|---|
| 搜索命中（聚合） | 601 个模型 | 含底座/工具/文档等，需过滤 |
| 其中 LoRA / adapter | **111 个** | 真实可收录标的 |
| 单条最高下载 | **50.2 万**（larryvrh/MiniMax-H3-Turbo-Lora） | 需求真实存在 |
| 单条最高 likes | 932 | 质量信号可用 |
| likes ≥ 50 的 | 约 12+ 条 | 头部可优先策展 |
| 明确 comfyui tag | 36 个 | 可直接落 ComfyUI 的比例 |

## 2. license 分布（开放目录分区的硬依据）

| license | 数量 | 占比 | 收录含义 |
|---|---|---|---|
| apache-2.0 | 42 | 38% | 可进内置策展区（仅当内容合规） |
| **无 license** | 33 | 30% | 只进开放目录 + 明示"无许可证，自行确认权利" |
| other / 自定义 | 32 | 29% | 逐个看（如 fal 的 Realism-People 是 other） |
| mit / gpl-2.0 | 4 | 4% | 看内容 |

## 3. 底座兼容性（决定「接入 Nomi」怎么接）

`base_model:adapter` 分布 top：
- **MiniMaxAI/MiniMax-H3**（官方底座）：36 条 —— diffusers/peft 系
- **Comfy-Org/MiniMax-H3**（ComfyUI 重打包底座）：25 条 —— **comfyui 系，与 Nomi 现有 comfyui-local vendor 同生态**
- 其余分散：Qwen 系 prompt-rewriter 类、SDXL、MiniMax-Music3 等

library_name 分布：minimax-h3 50 / peft 25 / diffusers 19 / gguf·mlx·llama.cpp 等零星。

**含义**：H3 的 LoRA 适配器主要服务两类宿主——官方推理（peft/diffusers）与 **ComfyUI**。对 Nomi，「一键接入」的真实路径 = **检测本地 ComfyUI + Comfy-Org/MiniMax-H3 底座 → 权重落位 `models/loras/`（或 equivalent）→ 生成带该 LoRA 的 ComfyUI 工作流 → Nomi 编排运行**。官方底座类可作「参考/待适配」，或经 Nomi 的托管 Ref 通道另说。

## 4. 文件形态（决定「展示/预览」怎么做）

以头部 larryvrh 为例（23 siblings）：`*.safetensors` 权重 + `*.json` 配置 + `README.md` + `generate.py` + requirements。**HF 无统一预览元数据**——"看效果"只能：
- 抓 README / model card 里的样张（图/视频链接），作者自行展示（Civitai 模式）
- 或 Nomi 检测到本地底座后**真跑一条小样**（Effect Pack 式托管预览做不到，LoRA 必须在对应底座上跑）

## 5. 真人 likeness 与 NSFW（存在，需分区治理）

- 头部即见真人向：`fal/MiniMax-H3-Realism-People-LoRA`（35.7k 下载 / license=other）
- NSFW 仓库真实存在：lynaNSFW 一族（DaSiWa / minimaxH3_Collection）、Hearmeman、SimpleTuner 部分条目带 adult 标签
- 结论：**开放目录必带**内容分级 + 作者声明 + 免责（抄 HF 自身与 Civitai 的做法，而不是假装没有）

## 6. 对 Registry 的影响（并入立项）

1. catalog entry 加 **`kind: skill | effect-pack | lora`** + `modality`（形象/声音/风格/动作…）；现有 domain/craft 分类保留（分类维度不冲突）。
2. `adapterForNomi` 分型：skill→拷目录；effect-pack→铺画布；**lora→comfyui-local 检测 + 权重落位 + 工作流生成**。
3. curation 加一档：`open-directory`（开放目录，全量带分级）与现有 `official/curated/candidate` 并列；license=无/other 的条目只进 open-directory。
4. 「看效果」按 kind 走不同预览：skill 读文档 / effect-pack 托管小样 / **lora 作者样张或本地真跑**。
5. 采集管线新增 HF source type：`source.type: huggingface` + `repoId` + `siblings` 文件清单 + license 映射 + gated/adult 标记。

## 附：原始数据
- 聚合 601 命中明细与 111 LoRA 标注：扫描脚本产物（/tmp 一次性，可重跑：`hf_scan.py` / `hf_scan2.py` 逻辑见本目录）
- 核验口径：条目均经 HF API detail 抓取；未人工逐条审内容（真人 likeness 判定靠命名+标签抽样，非全量人工审查）
