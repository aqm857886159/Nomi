# 全模型「模式覆盖」审计 —— 官方支持的生成模式 vs 我们暴露的（2026-06-30）

> 触发：用户「所有模型供应商都基于官方文档完整测跑，不是只整几个」。
> 方法：6 路并行 agent，对**全部 41 个 archetype**逐个抓真实官方文档，列「官方支持的全部生成模式」对比我们 archetype modes + 注册 mappings，找「官方有、我们漏接整条模式」的缺口（继 Seedance t2v 之后系统性排查）。强制引文档原文，查不到标⚠️未验证。
> 真相源：dreamina = 本机 CLI `-h`；其余 = 各家官方文档门户。

## 已修（本轮）
- **kie Seedance 文生视频(t2v)** — commit d6b00d4a（官方支持、我们漏接，已补 mode+mapping）。
- **账号档位闸→用户清晰提示** — commit ab262859（即梦会员/RH企业key/网页授权 统一「账号权限不足」+ 可执行 hint）。

## 缺失模式清单（按「doc 实证 + 可验证 + 价值」排序）

### A 档·doc 铁证 + 可立即验证/低风险
| # | 模型 | 缺的模式 | 状态 |
|---|---|---|---|
| **A2 ✅已做** | **火山 Seedream** | **图生图/改图 i2i**（image 字段数组 + sequential_image_generation）| **真机验证字段契约**（5.0 lite + image:[url] → 服务端识别并下载）+ 已补 edit mode + image_edit mapping |
| **A3 ✅已做** | **kie GPT Image 2** | i2i 参考图上限 4→16 | docs.kie.ai 实证两家都 16，旧值 4 是被证伪的保守猜测，已抬到 16 |
| A1 ⏳待 agnes 真机验 | **Agnes Video V2.0** | **多图视频 + 关键帧动画**（extra_body.image 数组 / extra_body.mode:"keyframes"）| doc 铁证，但 extra_body 嵌套 + i2v 共享 mapping 的空 extra_body 容忍度需 agnes 真机验（异步多图）才安全上，不盲发 |
| A4 ⏳gated | **RunningHub Qwen edit** 1→3 | firsthand 实证，但 RunningHub 标准模型全被企业key闸挡着、当前零用户影响，待企业 key 一起做 |

### B 档·doc 实证但需真机验证端点/字段，或改动较大 → 验证后做
| # | 模型 | 缺的模式 | 卡点 |
|---|---|---|---|
| B1 | apimart Seedance | return_last_frame 视频续写 + 核 image_with_roles role 名(last_frame/reference_image) | doc 实证；需核 combineSlotsInto 发的 role 名 |
| B2 | apimart Omni-Flash-Ext | generation_type:frame 首帧模式 + video_urls 视频参考 | 代码已自承 TODO；video_ref 卡 taskKind 枚举 |
| B3 | apimart Wan 2.7 | video_urls 视频续写 + 新模型 wan2.7-r2v(参考生视频)/wan2.7-videoedit | r2v/videoedit 是新模型需建档 |
| B4 | ModelScope FLUX.2-klein-9B | image edit（模型权重支持）| ⚠️需先真机验 api-inference 托管端点是否暴露 image_url 编辑入参 |
| B5 | 火山豆包语音 | 声音复刻 ICL 2.0 合成（seed-icl-2.0 + S_ speaker + model_type=4）| 合成端小改；上传训练子系统需产品拍板 |

### C 档·RunningHub（多被企业key闸挡住真机验证 + per-model 文档 SPA 取不到字段）→ 需企业 key
| 模型 | 缺的模式 | 状态 |
|---|---|---|
| 可灵 3.0 | multi_shots 多镜头（核心卖点）| 字段名⚠️未验证（kie/fal 同模型用 multi_shots/multi_prompt）|
| Wan 2.7 | reference-to-video 跨镜身份（最多5路参考）| 端点 doc 导航 verbatim 确认存在；字段⚠️未验证 |
| Hailuo 2.3 | t2v-pro / i2v-pro 档 | doc 导航列出 |
| Seedance global | multimodal-video | plan§7b 列出 |
| HiTem3D | multi-image-to-3d | doc 导航列出 |
| 各 image edit | 槽 max:1 偏窄（seedream/nano 多参考图）| 各端点上限⚠️未验证 |
| ⚠️红旗 | Wan 系字段可能是 ComfyUI 节点编码(NN##field) 非扁平 | 被 1014 企业key闸挡住，需企业 key 真机一发确认，否则新模式照扁平发会全失效 |

### D 档·参数/能力级（非整条模式）或已知取舍 → 低优
- kie Kling：multi_shots + kling_elements（参数级，archetype 已注释「后续增强」）
- kie Nano Banana：identifierPatterns 误含 "nano-banana-pro"（实为独立模型）→ 应删该 pattern 避免误归一
- apimart Veo 3.1：变体能力差异未表达（quality 无 reference、lite 仅 t2v）
- apimart Seedream/Nano：sequential_image_generation 组图 / mask_url 局部重绘（子能力）
- dreamina image2video/frames2video：缺 3.0/3.5pro 模型族（archetype 缺 per-mode 模型集表达力）；i2i 多接了 3.0/3.1（官方不支持）；resolution 未按模型收窄（源码已自承兜底）
- dreamina multiframe：段时长下界 0.5 vs 我们 min:1
- 火山 Seedream：组图 sequential_image_generation:auto（需 runtime 支持多 url 返回）
- 火山 Seedance：视频延长/编辑缺**显式入口**（omni 已覆盖输入，仅缺产品引导）
- ⚠️需用户更新 CLI：dreamina v1.4.10 的 generate_num 批量 + seedance2.0_vip 4k（本机 v1.4.8 -h 无此能力，接了反而发非法 flag）

### 健康无缺口（modes 与官方契约一一对应）
- kie：Seedance(已补)/GPT/Seedream/Nano/HappyHorse 主模式全对
- apimart：Sora2/Hailuo/Imagen4/Z-Image/Qwen/Seedream/Nano/GPT 全对
- 火山 Seedance：4 场景一一对应
- ModelScope：6 t2i + Qwen-Edit 全对（除 FLUX.2 待验）
- dreamina：8/8 子命令全接（缺口在子命令内部参数层）
- RunningHub：GPT Image/混元3D/Meshy6 模式完整

## 新模型（非「缺模式」，需用户拍板是否接入）
kie 已上：Nano Banana Pro(google/nano-banana-pro, Gemini 3 Pro) / Nano Banana 2 / Seedream 5.0 Lite。apimart：wan2.7-r2v / wan2.7-videoedit。RunningHub：各 -pro 变体。
