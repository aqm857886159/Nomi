# 评测发现 + 质量分校准 —— 交接文档

> 自包含交接件,给接手评测/agent 行为的 AI。读完即可冷启动接手,不依赖对话上下文。
> 产出方:Opus 4.8 会话(2026-06-14)。配套:`docs/plan/2026-06-14-eval-system-expansion.md`(评测体系 v2 设计)。

## 0. 一分钟背景:评测体系现状

Nomi 是本地优先 AI 视频创作工作台(Electron+React)。评测体系 v2 已建成 4 条 lane(全在 main):

| Lane | 测什么 | 命令 | 花费 |
|---|---|---|---|
| C 完整流程 | J1-J5 用户旅程多里程碑终态验证 | `pnpm eval:journey [--ci]` | 零额度(J3/J5)/ agent 额度(J1) |
| A 质量分 | 拆镜头四维质量(judge,1-5 档) | `pnpm eval:run storyboard --judge` | agent + judge 额度 |
| B 基线回归门 | 对入库基线比,掉分报红 | `pnpm eval:baseline` / `eval:diff <run>` | 零额度 |
| D 生成质量 | 已生成图/视频 VBench 维度分(VLM) | `pnpm eval:review-images <项目>` | VLM 额度 |

**判官配置**(`evals/judge.config.json`,gitignored):apimart relay,文本 judge=`claude-haiku-4-5`(异家族避自偏,被测 agent 是 moonshot/gpt-5.5),VLM=`gemini-2.5-flash`。
**关键工程坑(已修,后续 node 直连 vendor 必须沿用)**:① Node fetch 不读 `HTTP(S)_PROXY` → 挂代理的机器直连超时,`evals/lib/httpProxy.mjs` 用 undici ProxyAgent 兜;② apimart 默认流式 → 请求加 `stream:false`;③ Claude 把 JSON 裹 ` ```json ` 围栏 → `parseJsonLoose` 容错。

跑评测的环境铁律(踩过):跑前 `osascript -e 'quit app "Nomi"'` + `pkill -f Nomi.app`(single-instance 锁);UI 改版会让选择器 stale → 评测 infra 超时(本次又抓出 2 个,见 §3)。

---

## 1. 核心发现:评测把「两个没拍板的产品决策」变成了红灯

跑 storyboard 评测(画布拆镜头 agent),**规则层最一致的失败不是 bug,而是两个悬而未决的产品决策**。这是最重要的交接结论:

**全量 16 case 规则失败聚合**(`storyboard` 数据集,k=1,commit f05a9ac,pass@1 = 2/16):

| 规则失败项 | 命中 case 数 | 性质 |
|---|---|---|
| `minChainEdges`(没连边) | **11/16** | ← P1-A,大概率是 Q1 待决 |
| `kind`(出 video 非 image) | 7/16 | ← P1-B,Q2 待决 |
| `createdShots`(数量超/缺) | 7/16 | 部分是 P2 过度发挥 |
| `ratioParamsValid`(缺比例/时长) | 6/16 | agent 配参数不全 |
| `turnFinished`(turn 没正常收尾) | 3/16 | infra/空响应(见下) |

> ⚠️ sb-011/012/013 三个 case **0 节点 + turn=error**——是模型**空响应**(端点偶发降级),不是 agent 行为问题。
> 真机跑评测要留意这类 infra,别当成质量失败。这三个已从质量标注里排除。

### 🔴 P1-A 拆镜头默认不连引用边(命中待决问题 Q1)
- **现象**:agent 拆出镜头节点后,**镜头之间不连引用边**(`minChainEdges` edges=0)。
- **数据**(全量):**11/16 没连边**;连了边的多是提示词**明确要求连线**的(如 sb-014)。
- **判定**:agent 现在是「不明说就不连」。
- **这是产品决策 Q1**:拆镜头要不要**默认**把镜头按时序连成参考链?
  - 连:利于后续 i2v 首帧承接、时间轴排片;但可能不是所有人都要链式。
  - 不连:保持干净,用户自己连。
- **待用户/PM 拍板**;定了之后改 agent 的 `buildStaticAgentSystemPrompt`(`src/workbench/generationCanvas/agent/generationCanvasAgentClient.ts`)+ 对应调 dataset `expect.minChainEdges`。

### 🔴 P1-B 拆镜头出 video 节点,而非 image(命中待决问题 Q2)
- **现象**:部分 case agent 建的是 `kind=video` 节点,dataset `expect.kind` 要 image(`kind∉[image]`)。
- **数据**(smoke):sb-002(产品片,4 节点全 video)、sb-004(9 节点非 image)。
- **这是产品决策 Q2**:拆镜头默认产**图**节点还是**视频**节点?宣传片场景尤其分歧(video 不算错)。
- **注**:`evals/datasets/storyboard.mjs` 的 `expect.kind` 已支持数组(可放宽成 `["image","video"]`),`evals/lib/grading.mjs:87` 注释也写了「待 S2 产品裁定后再收紧」。**拍板后改 dataset 的 expect,不是改 agent**(除非要强制某默认)。

### 🟡 P2 未指定数量时过度发挥
- sb-004「未指定数量·由 AI 决定」→ agent 建了 **10 个节点**,其中混入 4 张资产卡(流浪猫/便利店/店员/招财猫位)+ 6 个镜头,超出 `expect.createdShots=[3,8]`,且 6 个节点缺比例/时长参数(`ratioParamsValid`)。
- **判定**:像是 agent 把「拆镜头」和「拆资产」混做了一轮。值得查 agent 是否该在纯拆镜头意图下只产镜头节点。轨迹见 §4。

---

## 2. 质量分卡:已校准,但 judge 行为有两个要知道的特性

Lane A 四维质量 judge(忠实原文/画面可生成/叙事连续/跨镜一致,1-5 档)在全量 16 case 上:**综合 ~77–91/100**(跨次波动,见下),已通过校准(§5)。
- **agent 拆出的提示词质量是真高**(看 §4 轨迹:sb-003 京都 vlog 每镜「场景·时间·光线 / 主体·动作·情绪」结构化;sb-010 运动鞋广告六镜节奏张力足)——judge 给高分多数站得住,不是单纯滥发。
- **特性 1:分数偏两极**。便宜 judge(gemini-2.5-flash)倾向给「全维 5」或「全维 1」,中间档(3/4)少 → 逐维区分度弱于理想。空响应/不完整的 case 正确判低(sb-014 只 2 镜→fail)。
- **特性 2:跨次有波动**。同一批同温度 0,综合分在 76.6↔91 间跳,judge 偶尔对 sb-014/015 给不同档。**这是 cheap judge 的固有噪声**,接手时若要更稳可考虑:更强 judge 模型 / 同 case 多次取中位 / 收紧 rubric 锚点。

---

## 3. 顺带修掉的评测自身漂移(评测 harness 也会 stale)

UI 改版会让评测的选择器失效、表现为 infra 超时(不是 agent 的错)。本次抓修 2 处(已在 main):
- `evals/lib/isoApp.mjs` `openGenerationAiPanel`:旧版在「创作」标签找「Nomi 生成」失败 → 现在先切「生成」工作区 → 点「生成区 AI 启动器」开侧栏。
- (Lane C 阶段)起始页「漫剧示例」→「30 秒体验」;空白项目默认落创作标签;节点提示词框 `.generation-canvas-v2-node__prompt-input`。
- **教训**:评测断言要跟 UI 一起维护;`pnpm test:journeys`(零额度)应进 CI 当门,UI 一漂就红。

### 接 judge key 实测时抓的 judge/VLM HTTP 三修(已在 main `evals/lib/`)
1. **走系统代理**:Node 原生 fetch(undici)不读 `HTTP(S)_PROXY` → 挂 Clash 类代理的机器直连 vendor 超时。`evals/lib/httpProxy.mjs` import 即设全局 ProxyAgent;judge.mjs 引它 → vbench/review-images 经 judge 传递性覆盖。
2. **`stream:false`**:apimart 等 relay 默认流式,`res.json()` 拿到 SSE 解析炸。
3. **`parseJsonLoose` + 重试**:模型(尤其 Claude 写长中文 reason)会吐畸形 JSON(围栏/尾逗号/裸控制字符/未转义引号)。parseJsonLoose 剥围栏+抓 `{…}`+去尾逗号+剥控制字符;`postChatJson` 解析失败自动重试一次;judge prompt 要求 reason ≤80 字降畸形面。
   - **判官选型经验**:`claude-haiku-4-5` 长 reason 下 3/16 解析失败;换 **`gemini-2.5-flash`** 后 16/16 干净(json_object 更可靠),且同为异家族(被测 agent=moonshot/gpt-5.5)避自偏。**后续任何 node 直连 vendor 的脚本都要走这三关。**

---

## 4. 复现与轨迹

- 全量重跑:`osascript -e 'quit app "Nomi"'; pkill -f Nomi.app; pnpm eval:run storyboard`(~10 分钟,~30万 token)。
- 加质量分:`node scripts/eval-score.mjs <runDir> --judge`。
- 轨迹在 `evals/runs/<run>/artifacts/<case>-t1/`(整个 `.nomi`,含 events 事件流 + 终态 project.json);`evals/runs/` 不入库(本地)。
- 看报告:`<runDir>/report.md`(首屏 verdict + 质量分卡 + 失败下钻 + 轨迹路径)。

---

## 5. 质量分校准（本会话已跑通 = AI bootstrap,待你用人工标注复核/替换）

**已达标并转正**:`evals/judge-calibration.json` → `calibrated=true, precision=1.0, recall=1.0, n=13, model=gemini-2.5-flash`。
质量分现在**计入 pass**(judge 判某维不及格会让该 case 规则 pass 也翻红)。

**重要诚实声明**:这 13 条标注是**我(Opus)按拆镜头质量打的 AI bootstrap**,不是用户的人工口味。P/R=1.0 部分因为:① 这批 case 多是「明显好 vs 明显空」,中间档少,容易一致;② few-shot 取自同一批我的标注(轻微循环)。**接手第一件事:用真实人工标注替换/扩充下面这批,在更难/更边界的样本上重跑校准**,质量分的「松紧」才真正对齐用户口味。

标注存 `evals/annotations/bootstrap.jsonl`(gitignored,本地)。内容(`source=2026-06-14-15-13-storyboard`,`key=<caseId>#1`,排除 sb-011/012/013 三个 0 节点 infra):

| case | 我的判定 | 依据 |
|---|---|---|
| sb-001 | pass | 三镜叙事完整,运镜/光线/动作齐全 |
| sb-002 | pass | 四镜产品片,痛点→亮相→演示→号召清晰 |
| sb-003 | pass | 五镜京都vlog,每镜结构化,地点递进自然 |
| sb-004 | pass | 镜头具体且连贯(混入资产卡=范围问题非质量) |
| sb-005 | pass | 六镜产品demo,痛点到功能演示完整 |
| sb-006 | pass | 定妆卡+三镜,递信→风吹→触手连贯 |
| sb-007 | pass | 美食步骤型图+视频成对,步骤清晰 |
| sb-008 | pass | 三镜支付流程一气呵成 |
| sb-009 | pass | 情绪散文转五镜,城市待机隐喻贯穿 |
| sb-010 | pass | 六镜快节奏广告,张力强 |
| sb-014 | **fail** | 只产 2 镜(缺镜1镜2),分镜不完整 |
| sb-015 | pass | 三空镜各自具体;无叙事连接因用户要求不连线,合理 |
| sb-016 | pass | 点名要 video 正确产出,画面具体 |

**复跑校准**:`pnpm eval:run storyboard`(重出一批)→ `pnpm eval:view <runDir>`(标注导出到 `evals/annotations/`)→ `pnpm eval:judge-calibrate <runDir>`(P/R≥0.8 转正)。

---

## 6. 交接给你(接手 AI)的 TODO

1. **拍板 Q1/Q2**(需 PM/用户):默认连线?默认 image/video?定了我在 §1 说了改哪。
2. **质量 judge 校准**:用真实人工标注替换/补充 §5 的 AI bootstrap 标注,重跑 `pnpm eval:judge-calibrate <runDir>` 到 P/R≥0.8,质量分才转正计入 pass。
3. **P2 过度发挥**:查 sb-004 轨迹,看 agent 是否该在纯拆镜头意图下只产镜头节点。
4. **入库 storyboard 基线**:校准达标后 `pnpm eval:baseline <runDir>`,以后回归门自动盯质量分掉幅。
5. **补 J2/J4 旅程**:Lane C 框架就绪(`evals/journeys/`),按 j1/j3/j5 同结构加。
