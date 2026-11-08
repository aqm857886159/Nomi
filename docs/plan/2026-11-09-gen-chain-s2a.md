# 模式与比例的单一事实源

类别：其他；纯修复，不增加界面、操作或执行能力。实现只删重复比较、扩充已有比例解析、替换消费者的解析和维护走查判据。四笔独立提交；本卡在实现前确定。

## ★1 用户怎么用

当创作者指定模式或画幅时，要让草稿、授权与请求保留这个意图。流程：说出目标 → Agent 从目录选模型与模式 → 宿主按模式定种类 → 语义比例落到真实参数 → 查看草稿/确认卡 → 授权后提交。真实任务：首尾帧生视频；火山 Seedream 2560×1440；只收冒号比例的模型生成 16:9。

指标及量具：指定模式冲突拒收率，`mcpGenerationVideoResolve.test.ts` 重放十个历史形状，目标 0/10；Seedream 比例拒收率，`semanticAspectRatio.test.ts` 重放十二个历史形状，目标 0/12；请求体变化率，`officialWire.matrix.test.ts` 的 NOMI_OFFICIAL_WIRE_DUMP 逐格 JSON 对比，替换消费者后目标 0%；默认模型判据，`agent-default-model-real.test.mjs` 换序/删除反例与发送时序测试，目标全通过。真实模型遵从与 39 题评测未验证，由协调另跑。

★1b：现有 Agent 拒收出口中删掉 modeId 与 taskKind 冲突的两句英文；未知模式仍走原有问题码。其他界面文案不变。比例 owner 的消费者包含画布控件；本线不另做 Seedream 可见界面改版。

★1c：不迁移或重写存量工程。旧草稿无 modeId 时保留 byId/byTask/推荐逻辑。旧节点迁移只换宽高解析，迁移条件、有限正数验证、既有显式比例优先保留。分镜几何保持自己的 slash/decimal 读取合同。

## ★2 谁说了算

模式事实 owner：`videoModeForPlan`；传输种类 owner：`modeTransportFor`。给 modeId 时不再比较第二份 taskKind。比例解析和宽高 owner：`electron/shared/aspectRatioValue.ts`；四处消费者删自己的正则，只读共享导出，所有尺寸策略原样保留。

`door-map` 主链 13 扇/20 处：mcpGenerationVideoResolve 的 videoModeForPlan；generationPlanPatch 与 mcpGenerationTools 的 normalizeAuthoredCandidate；semanticAspectRatio 与 aspectRatioValue 的 resolveAspectRatioChoice；aspectRatioValue 自读 parse/normalize；generationListMediaFacts、nodes/aspectRatio、parameterControlModel、NodeParameterControls、videoAspectSeed 读 parse/normalize。相同 owner 的多个读者不能合并为一个业务入口。

向上一跳：应用内 Agent 与外部 MCP 经 generationTransportAdapters / mcpGenerationTools 进入同一个 normalizeAuthoredCandidate；草稿补丁经 generationPlanPatch；Run 契约编译经 videoCompileOptions/videoModeForPlan。检索未找到另一处拿作者 taskKind 拒绝已选合法视频模式的比较；映射查找的 taskKind/modeId 是路由匹配，不是作者冲突拒收。

范围外重复事实现已授权替换：paramTranslate、runwayImage、runwayRatio、archetypeMeta；另设扫描守卫，唯一例外为 shotFrameGeometry，原因见 ★3。守卫登记 scripts/pre-push-scan-guards.mjs。

## ★3 一致与复用

方向来源：`docs/engineering/direction-checks/2026-11-08-generation-request-chain.md`；共享 owner 的原决策：`docs/plan/2026-10-05-agent-aspect-ratio-semantic.md`。保留创作者模式/画幅，三条路中选择删除重复比较、替换解析；不新增供应商分支，不新增尺寸策略或依赖。

解析与规范化共享一条正则，认冒号与 x/×/*，不认 slash 或单个小数。公开导出已有 widthHeightOf，避免消费者再次拆字符串；normalize 保留冒号/具名的原行为，将像素分隔符规范化为冒号宽高。纯冒号目标按同一比例匹配到已有合法选项；像素目标仍优先精确匹配，多个像素档仍按当前/默认同档规则，不猜尺寸。

分镜例外：现役 propose_storyboard_plan、规划模型 schema、外部 JSON、旧工程读取接受 16/9 和 1.78；离线生产边界重放两值均保留，现有预览为 240×135，owner 返回 null。写入边界统一前不删其读法；owner 不扩此两种格式，shotFrameGeometry.ts 不改，守卫只放行这一项。

### 外部规范对齐（核对日期 2026-11-09）

| 规范链接 | 我们的偏差 | 偏差理由 |
|---|---|---|
| [火山方舟图像 API](https://docs.volcengine.com/docs/82379/1541523) | 未验证：原页超时，依据 `seedreamVolcengine.ts` sources 的既有官方事实记录：4.5 像素积 3686400..16777216、比例 1/16..16；现有声明只暴露十个合法像素档 | 保留已声明档位与同档选择，不扩大到任意上游可用像素尺寸；2560x1440 是现有合法档，原样发 |
| [APIMart Seedream 4.5](https://docs.apimart.ai/en/api-reference/images/seedream-4.5/generation.md) | 无：size 是冒号比例，resolution 分开；官方 2K 映射列出 16:9 对应 2560x1440 | 像素意图转成所声明比例 size=16:9；不把火山像素串传给此渠道 |
| [APIMart Seedream 5 Pro](https://docs.apimart.ai/en/api-reference/images/seedream-5-0-pro/generation.md) | 官方支持比例/精确像素；我们仍只选现有声明的合法项 | 保留当前目录合同与 resolution，不增加自由像素输入 |
| `electron/parity/officialWire.matrix.test.ts` 与 `tests/fixtures/vendor-official/apimart/doubao-seedream-4.5.json` / `doubao-seedream-5-0-pro.json` | 这些靶子量参考字段、模式与两路一致，不完整覆盖 size | 不把参考事实误当尺寸规范；size 另用上述官方原页和已有火山事实核对 |

## ★4 全状态

空：未指定比例时原样保留。加载/取消中/过期：解析是同步纯函数，不增加状态。成功：模式定种类、比例落到合法原值。失败：未知模式、非法比例、同档不明仍走既有拒收。部分成功：本层原子解析，不新增部分写入。能力不可用：无比例控件仍报告原原因和合法下一步。中文/英文既有出口复用，未新增词条。

## ★9 动手前验收合同

1. 给了合法 modeId、taskKind 写反：不拒，normalize 输出模式声明的传输种类；十个历史形状逐条重放（firstlast 两条、omni 五条、first 一条、ref/edit 各一条）。未知 modeId 仍拒。
2. 未给 modeId、只给 taskKind：byId/byTask 与推荐照旧；没有有效模式仍拒。
3. 2560x1440、2560×1440、2560*1440：owner 解析相同；火山 Seedream 精确合法 size 原样保留；只收冒号的模型落 16:9。十二个历史 Seedream 比例拒收逐条重放。
4. abcx、0x720、2560x、零/负数等非法形状不认且宿主拒收；冒号、全角冒号、说明后缀和 portrait_4_3 不变。slash/decimal owner 不认。
5. 当前/默认像素同档与 several_sizes 行为保留；多个档位不自动跨档。合法选项外不任意写像素。
6. 消费者只换解析；朝向、像素积预算、取整、合法枚举、非法输入策略、旧迁移有限性验证不变。已有相关全目录测试通过；officialWire 在 owner 修改前、修改后、消费者替换后三份 dump 逐格比较，第三步必须零差异，否则停。
7. 扫描守卫修前抓到四个文件（共多份正则），只放行 owner 和协调明确的分镜几何文件；媒体真实宽高相除与像素输出拼装不误报；出现第二个所需例外即停。
8. 默认模型从本次隔离目录及其默认设置读取，不依赖固定模型 id；换序不变、移除固定 id 后随目录选择；发送前卡不算，发送后读取节点付费卡；判据纯函数单测，付费脚本不跑。
9. typecheck、改到文件所在目录全部单测、officialWire、pre-push-contracts 与正文预检完成；真实上游/付费/39 题未验证，正文明确标注。

## 已知限制

分镜方案里写成 16/9 / 1.78 的比例，画布与生成侧的 owner 不认；分镜写入边界统一成冒号写法另列。
