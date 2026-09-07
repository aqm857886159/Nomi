# 补齐方案 · 本地 vs API 双轨矩阵（含调研覆盖度自报）

> 2026-09-08 · 方案第六部分。Nomi 是本地优先产品，每项能力原则上要有**本地档**与 **API 档**两条轨（P4：档案槽声明云/离线档，不写 if-else）。本文逐项列出两条轨的真实工具与现状，并**诚实标注调研覆盖度**——哪些已实查、哪些还是待办。

---

## 一、14 项补齐功能 · 双轨矩阵

图例：✅ 双轨已写全（含工具实名与接法） · 🟡 已有方向但细节待落 · ⭕ 仅单轨（有明确理由）

| # | 能力 | 本地方案 | API 方案 | 判定 |
|---|---|---|---|---|
| 1 | 扩图 | **ComfyUI outpaint 工作流模板**（FLUX Fill / SDXL outpaint 节点，Nomi 已有 comfyui-local vendor + 模板库 + 工作流导入） | 基准图合成 + 图生图（Nano Banana 2 / Seedream 5 Pro 指令式，已有档案） | ✅ |
| 2 | 重绘/擦除 | **ComfyUI inpaint 工作流**（FLUX Fill / SDXL inpaint + mask 输入；涂抹 UI 复用画板节点，mask 落临时文件喂 ComfyUI） | 指令式编辑（Nano Banana 2/Seedream 5 Pro 四段式系统词） | ✅ |
| 3 | 智能续写 | **无可行本地档**：开源视频续写模型（video extension）当前无达到生产质量的选择（CogVideoX-5B 系画质/一致性不足）；抽帧+本地 ComfyUI i2v 画质断档 | Seedance 2.5 `return_last_frame` / 抽帧→i2v（已对账档案） | ⭕ 仅 API（理由已记录：开源视频模型一致性不达标，本地档等模型成熟） |
| 4 | 片段重拍 | 同上（重拍 = 选段续写族） | 同上（i2v 逐段任务编排） | ⭕ 仅 API |
| 5 | 音频截取/变速/切分 | **ffmpeg**（atrim/atempo/asplit，本地即时，零 API 必要） | 无 API 必要性——本地即最优（更快、免费、离线） | ⭕ 仅本地（合理） |
| 6 | 分离音视频 | **ffmpeg**（-vn/-an） | 同上，无 API 必要 | ⭕ 仅本地（合理） |
| 7 | 人声/背景音分离 | **Demucs v4**（htdemucs 模型，Mac CPU/GPU 可跑）或 MossFormer2（SDR 24+）；Python venv + 子进程，与本地 Whisper 同构 | **ElevenLabs** `POST /v1/audio-isolation`（流式、≤500MB/1h、已在供应商栈） | ✅ |
| 8 | 视频超分 | **Real-ESRGAN ncnn-vulkan**（官方 macOS 二进制，`realesrgan-ncnn-vulkan` 直跑 Metal）；或 ComfyUI 超分工作流 | Replicate real-esrgan-video（先例已有）/ runwayml upscale-v1 / topazlabs（档案槽三模型声明） | ✅ |
| 9 | 音色克隆 | **CosyVoice 2**（Apache 2.0 可商用，中文 MOS 4.7 开源第一，3–10s 参考音，Mac CPU 实测可跑）或 **F5-TTS**（MIT，0.3B 最轻）；均 Python 部署 | **MiniMax Voice Clone**（`/v1/files/upload` → `/v1/voice_clone`，企业认证+7 天时效）或 ElevenLabs 克隆 | ✅（本次补齐：本地档此前缺失，已按 2026-Q3 实测横评选定 CosyVoice 2 为默认本地档、F5-TTS 为轻量备选） |
| 10 | 表情/去AI感/三视图（提示词预设） | 提示词与载体解耦：**本地 ComfyUI 档**（SDXL/FLUX + IPAdapter 一致性）跑同一套提示词；三视图本地另有 CharacterSheet 类 LoRA（社区 4 万+ 下载验证） | Nano Banana 2 / Seedream 5 Pro 档案直接吃提示词 | ✅ |
| 11 | 深度动作捕捉 | **Depth Anything V2**（开源权重本地跑）或 DepthCrafter（时序更稳，需 GPU）；产出深度视频喂 Seedance 多参考 | Replicate depth-anything-video（免装机） | ✅（仍需收益 spike，双轨只解决「怎么跑」不解决「值不值」） |
| 12 | 全景生成 | ComfyUI 全景 LoRA/工作流（社区有 equirectangular 微调，质量不稳定） | 图像档案等距柱状预设 | 🟡（两轨都是试验性质，spike 定去留） |
| 13 | 全局历史/AutoLink/拉片闭环 | 纯本地 UI/数据聚合，无 API 面 | 不适用 | ⭕ 仅本地（本质如此） |
| 14 | 智能剪辑编排（独立立项） | 本地：ffmpeg 剪口水词（Whisper 时间戳已有）+ Remotion 字幕/动效（多后端已有） | 云：口播增强/降噪 API（Eleven isolation 先行）；编排 Agent 模型走已有文本档案 | ✅（立项时细化） |

**双轨覆盖小结**：14 项中 **8 项双轨齐备、3 项仅本地、2 项仅 API（均有记录理由）、1 项双轨均为试验性质**。所有双轨项都走同一档案槽声明（`runtime: local | cloud`），UI 一套。

## 二、配套：已有能力的双轨现状（盘点发现）

| 能力 | 本地 | API | 备注 |
|---|---|---|---|
| 转写 | Whisper（verbose_json 本地） | — | 已是本地优先 |
| 抠图 | @imgly WASM | — | 本地 |
| TTS | （可挂 CosyVoice 2 作为本地 TTS 档） | 豆包/Seed/MiniMax/Eleven | 本地档随 #9 顺带落地 |
| 音乐生成 | **MiniMax Music 3 开源权重**（HF 可下，官方明示 API 停新后引导开源）| Suno v5.5/Lyria/MiniMax API | 🟡 本地档可选，质量低于 Suno，后置 |
| ComfyUI | 本地/云端实例 + 模板库 | — | 是所有「本地图像档」的承载底座 |

## 三、调研覆盖度自报（诚实清单）

**已实查到位**（有原文/有数据/有 file:line）：
1. LibTV 全功能面（docx 1514 段逐段解析 + wiki 全文）
2. Nomi 代码库功能盘点（Explore 深扫，81 项对照全部有证据）
3. GitHub 3 仓库原文抓取（awesome-seedance-2-prompts 6,305 条 / awesome-ad-video-prompts 52 条 / ai-shortfilm-prompts 模板+工具文件，含许可核实）
4. 提示词公式 6 组外部来源（官方指南/实测报告/社区横评，含 73% vs 41% 量化数据）
5. 本地音色克隆 2026-Q3 横评（Mac 实测数据：CosyVoice2/F5-TTS/VoxCPM/GPT-SoVITS 参数、协议、速度、中文质量）
6. 人声分离/超分 API 端点与开源替代（Eleven/Demucs/Real-ESRGAN ncnn macOS 二进制）
7. 设计系统 §1.5/§1.6 全文 + 12 项交互路径设计

**未到位 / 待补**（不许装作做完了）：
1. **ComfyUI 具体工作流模板清单**（outpaint/inpaint/超分三个模板的节点参数级配置）——落地时按 ComfyUI 模板库既有格式逐个建并验收样张
2. **CosyVoice 2 在目标用户 Mac 上的 RTF 实测**（现有数据来自第三方横评，需自跑基准：10s 参考 → 100 字合成的实际耗时/内存）
3. **深度动捕收益 spike**（设计未做，可能直接毙掉）
4. **智能剪辑编排的竞品范式调研**（剪映图文成片/CapCut，立项时按采集三梯补）
5. **本地视频续写的持续观察**（CogVideoX 系成熟度，radar:models 顺带盯）
6. 逐帧拉片的 VLM 分析环节目前依赖云端文本档案——本地 VLM（Qwen-VL 类本地量化）是否够用未测

**结论**：大规模调研在「竞品功能面、内容来源、提示词原文、本地 TTS 横评」四个维度是真做完了；「ComfyUI 工作流参数级、自跑基准」属于实施期动作，已列入落地清单而不是留白。双轨矩阵中 3 项单轨都有明确理由并记录在案，不做假装的双轨。
