# APIMart 音频新型号：真付费抽检（2026-11-07）

- 走查：`tests/ux/catalog-latest-real.paid.mjs`，样本表在 `tests/ux/catalogLatestSamples.ts`。
- 构建：本分支开发构建。
- 隔离：用户资料的隔离副本，只授权样本型号，出网只放行 APIMart。
- 规矩：每条样本只提交一次，失败就停，不自动重试。已在有记录的一轮里成功的样本，下一轮用 `NOMI_CATALOG_LATEST_FROM` 跳过，不重复付费。
- 判据：每条都走付费确认框 → 提交 → 按任务号查到 `succeeded` 才算过。

## 结果

| 样本 | 结果 | 说明 |
|---|---|---|
| Suno V6 Mini（`suno-v6-mini`） | 成功 | 共下单 3 次：第 1 次查结果时脚本读错回执、没取回（已修，`8fdf615cb`）；第 2、3 次成功 |
| Suno Sounds V6 Mini（`suno-sounds-v6-mini`） | 成功 | |
| Lyria 3.5（`flowmusic-lyria-3.5`） | 成功 | |
| Suno V5.5（`suno-v5.5`） | 上游拒单，没扣钱 | HTTP 400「Suno 旧版本 "v5.5" 已下线，请将 version 改为 v6、v6-wild 或 v6-mini。」本 PR 去掉这条样本，退役另开 PR |
| 配音（`nomi-audio`，speech） | 请求发出、扣了钱，存盘失败 | 第 1 次：脚本没带项目号（已修，`199b99ae5`）。第 2 次：落盘关口拒（`generated_output_expected_kind_required`），这是 main 自 10-17 起就有的问题，和本 PR 无关，单独修复后再验 |
| 文字大脑 | 11-08 Agent 通道实测，23 个文字样本、7 个读图样本成功 | 11-07 音频任务脚本首个文字样本被授权拦下。随后按 Agent 主进程实际路径“一问一个”：Fable 文字和读图均为 HTTP 402；旧 V3.1 Terminus 为 HTTP 503。成功样本中有 20 个新声明的文字型号、6 个新声明的读图型号。[逐模型历史记录](../../plan/2026-11-07-catalog-audio-text.md#一问一个结果2026-11-08) |

**「成功」凭什么**：脚本对每条样本都要按任务号查到 `succeeded` 才往下走，失败当场停。按旧样本顺序（V6 Mini → V5.5 → 音效 → Lyria → 配音），各轮停在哪：
- 第 2 次下单那一轮停在 V5.5：说明 V6 Mini 那一条已 `succeeded`。
- 去掉 V5.5 后的那一轮停在配音（缺项目号）：说明 V6 Mini、音效、Lyria 三条都 `succeeded`。

**缺口**：
- 脚本没把逐条任务号和回执写进报告。中途失败时整轮结果一起丢，所以这里拿不出逐条任务号，只能凭「走到了下一条」推断。下一轮修：每条样本跑完立刻把任务号、状态、实扣写进报告，失败也保留前面的。
- 原来放在 `paid/` 的三张截图是同一张空白窗口，证明不了任何一条样本，已删。

## 11-07 音频抽检花费（按 APIMart 公开价估，以账单为准）

| 项 | 单价 | 次数 | 小计 |
|---|---|---|---|
| Suno V6 Mini 音乐 | $0.05 | 3 | $0.15 |
| Suno Sounds V6 Mini | $0.0096 | 1 | ≈ $0.01 |
| Lyria 3.5 生成 | $0.06 | 1 | $0.06 |
| 配音一句（gpt-4o-mini-tts 按 token） | 不到 $0.01 | 2 | < $0.01 |
| 合计 | | | **约 $0.23** |

价格来源：`GET https://api.apimart.ai/api/pricing/model?model=suno` / `flowmusic` / `gpt-4o-mini-tts` 的 `*_paid_prices`，2026-11-07 查。

## 11-08 macOS 开发版免费复核

两场演练均使用临时资料、夹具凭据和本机 HTTP 服务，公网放行名单为空。两份报告均记录 `paidCalls: 0`、`unexpected: []`。

| 命令 | 结果 |
|---|---|
| `NOMI_SPEND_OK=0 node tests/ux/apimart-text-list.rehearsal.walk.mjs` | 已验证目录来源、路由、鉴权、拒绝空表、报告无凭据以及读图的四种组合。修前把已验证的 Opus 当成未声明读图而报红；修后让供应商夹具独立于生产声明，改掉 Opus 的本地读图标记仍会报红。 |
| `NOMI_SPEND_OK=0 node tests/ux/apimart-text-brains.rehearsal.walk.mjs` | 4 个文字样本、2 个读图样本逐项落回执。夹具的 404 和看不到图两种结果均按失败记录。中途续跑只发剩余 3 个样本，每条在各轮只请求一次。随后保留 GPT-6 Astra 可用，Agent 不指定模型的两笔请求依次到达 DeepSeek V4 Pro、停用 Pro 后的 V4 Flash。 |

每次运行输出 `.tmp/pi-apimart-text-{list,brains}-rehearsal-development-<时间戳>/report.json`；同目录保留列表表格、行快照或 Agent 逐条回执。两场演练验证开发版走到本机对端的行为；历史供应商抽检结果见上表。
