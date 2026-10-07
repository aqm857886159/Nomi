#!/usr/bin/env bash
# UserPromptSubmit hook —— 每条用户消息前注入「三闸自检」+「最近栽过的坑」。
# 重构（2026-06-17，docs/plan/2026-06-17-discipline-system-overhaul.md）：从平铺 9 条 → 按「三个决策时刻」
# 组织(杠杆2)；顶部吐 violations.log→数据驱动、会变、针对真实毛病(杠杆3，抗横幅失明)。
# 升级（2026-06-21，docs/plan/2026-06-21-context-handoff-and-self-iterating-control-files.md，S2）：
# 改为按「踩坑次数 hits」排序取前 2——反复犯的优先顶眼前，不再单纯按时间。兼容旧平铺行。
# 升级（2026-10-02，规则体系瘦身）：常驻只留约 0.7 KB，其余拆成关键词块；用户消息改从 stdin JSON 读（见下）。
# 升级（2026-09-03）：新增设计流程关键词检测，命中时注入一行提示；注入正文按可机器化分诊瘦身（详见 docs/engineering/rule-enforcement-audit.md）。
# 完整规则仍以 CLAUDE.md 为单一真相源。stdout 在 exit 0 被 harness 注入上下文。
set +e
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
LOG="$ROOT/.claude/violations.log"

if [ -s "$LOG" ]; then
  echo "⚠️ 最近栽过的坑（别重蹈 · 来自 violations.log，按踩坑次数排序，反复犯的优先）："
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$LOG" <<'PY'
import sys
rows = []
for ln in open(sys.argv[1]).read().splitlines():
    if not ln.strip():
        continue
    parts = [p.strip() for p in ln.split('|')]
    if len(parts) >= 5 and parts[1].startswith('hits='):
        # 软 prune：status=dead 的行留历史但不再顶眼前（S1）
        if any(p.replace(' ', '') == 'status=dead' for p in parts[5:]):
            continue
        try:
            hits = int(parts[1][5:])
        except Exception:
            hits = 1
        last = parts[3].replace('last=', '')
        rows.append((hits, last, parts[4]))
    else:
        rows.append((1, '', ln))  # 兼容旧平铺行
rows.sort(key=lambda r: (r[0], r[1]), reverse=True)
for hits, _last, text in rows[:2]:
    tag = '(×%d) ' % hits if hits > 1 else ''
    print('   · %s%s' % (tag, text))
PY
  else
    grep -v '^[[:space:]]*$' "$LOG" | tail -2 | sed 's/^/   · /'
  fi
  echo ""
fi

# ── 关键词触发的块：只在用户这条消息命中时才注入（其余时候一个字都不占）─────────────────────────
# 为什么拆出来：每轮常驻只留「删掉它 Claude 就会犯错」的一小段（调研报告 §一.1：规则越长越被无视）；
# 其余按场景在命中时注入——这是确定性触发（UserPromptSubmit 的 stdout 进上下文），不靠 agent 自觉去翻 CLAUDE.md。
# 搬走的每一段 → 由什么触发，对照表在 docs/plan/2026-10-01-rule-reminders-slimming.md。
# 用户这条消息从哪来：官方 hooks 文档里 UserPromptSubmit 通过 stdin 的 JSON（`prompt` 字段）给；没有任何文档化的 CLAUDE_USER_PROMPT
# 环境变量——旧版只读那个环境变量，关键词块很可能从来没命中过。所以先读 stdin，环境变量只当兜底（测试里用）。
PROMPT="${CLAUDE_USER_PROMPT:-}"
if [ -z "$PROMPT" ] && [ ! -t 0 ]; then
  PROMPT="$(node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(String(JSON.parse(d).prompt||""))}catch{}})' 2>/dev/null)"
fi
hit() { echo "$PROMPT" | grep -qiE "$1"; }
# 命中次数记到本机统计文件（.claude/ 整体 gitignore）：下个复查周期（2026-12-01）用它判断哪个块的词表该再收窄。
# 写失败一律静默——统计不能影响提示本身。
HITS_LOG="$ROOT/.claude/self-check-hits.log"
hit_block() {
  hit "$2" || return 1
  { mkdir -p "$(dirname "$HITS_LOG")" && printf '%s|%s
' "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)" "$1" >> "$HITS_LOG"; } 2>/dev/null
  return 0
}

# 设计卡：碰花钱 / 长跑 / 可打断 / 新界面（原【设计流程】+【画新面】两块合成一块；词表收窄，只留这四类的信号词）
if hit_block design-card '付费|扣费|花钱|确认.*生成|批量生成|长跑|队列|取消|中断|断网|新页面|新面板|新界面|画新|新增.*(面板|页面|界面|区域)|从零.*(设计|做)|出个样|样张|mockup'; then
  echo "【设计卡】碰花钱 / 长跑 / 可打断 / 新界面 → 动手前先写设计卡 docs/engineering/design-card.md（四类 9 格全填，其他改动只填 ★1/2/3/4/9），写进任务书或 docs/plan，PR 正文 ## 设计卡 放链接；四类合并前还要另一条线独立验收（## 独立验收，验收线编号不能与实现线相同）｜新增或改动用户可见界面：拍板样张必须是设计实验室用生产组件 + 真实宿主数据（ShellStage 手法）搭出的屏，拍板后生产代码就是它；手写 HTML / 交互 widget 只准标 exploration 做方向探索，不能作实现合同；新组件先写生产目录本体，实验室只给数据；样张用 data-mockup-region 做整张对账表，契约登记 labScreen 后跑 pnpm run check:mockup-contracts (R8)；先看真实 UI 与 docs/design/nomi-design-system.md；加/挪控件先过 §1.5 控件层级"
  echo ""
fi
# 碰框架 / 三方库 / SDK（R5.1 / R5.4）：词表收窄，只留依赖与供应商接口的信号词
if hit_block prior-art 'package\.json|SDK|框架|三方库|第三方|依赖升级|MCP|供应商 ?API'; then
  echo "【先查别人 · R5】结论默认是接入（P0），凭记忆判断 = 没查｜碰三方库的 API → Context7 查官方文档(R5.1)｜碰框架/SDK/运行时或它没用过的层 → 四列表「它提供/我们用了/我们另写了/我们拆散了」＋参考实现逐层对照（一致·有意不同[理由须是领域约束]·没想到）(R5.4)｜外部也读写的格式/协议先找规范、写偏差与理由（建议档）"
  echo ""
fi
# 报完成 / 交付（R13 第二、三档）
if hit_block completion '做完|修好|验收|走查|交付|给你看|可以合了|完成了'; then
  echo "【报完成前 · R13】（P3 全文 docs/engineering/principles-detail.md）Agent/工具/契约改动 → 要有真实模型数字：工具写对率 + 回合成功率，实验室基线只证外观｜功能交付 → 设计卡 ★1 的 ≥2-3 条真实用户任务跑通闭环、冒出的问题全修掉｜画布/性能/导入/导出测试 → 素材必须是 NOMI_REAL_MEDIA_DIR 登记过的真素材，合成夹具证明不了任何事"
  echo ""
fi
# 修 bug（P2 全文在 docs/engineering/principles-detail.md）
if hit_block root-cause 'bug|回归|根因|修复|崩|卡死|报错'; then
  echo "【修根因 · P2】动生产代码前走 .agents/skills/root-cause-remediation：分清症状/直接原因/类根因，先 node scripts/door-map.mjs 数门，修在最早共享边界；同一处近 14 天第 3 个 fix → 先方向检查(RW)。全文 docs/engineering/principles-detail.md"
  echo ""
fi
# 方向检查（RW）：用户消息出现「第 N 轮 / 再修 / 又坏了 / 还是不对」这类反复修的信号
if hit_block direction-check '第 ?([3-9]|[三四五六七八九十]|[0-9]{2,}) ?轮|再修|又坏了|又坏|还是不对|还是有问题|修了又|反复修|越修越'; then
  echo "【方向检查 · RW】反复修的信号：别再派 / 打下一轮补丁。先 node scripts/fix-churn.mjs <路径> 看是不是热点；命中或已是第 3 轮 → 停，先写特征测试钉住现状，再按 docs/engineering/direction-check-template.md 做类根因复盘（归类表、为什么一直冒、2-3 个可验证预测、评测靶子是不是同一条线写的、P0 现成方案、补/重写/删对比），结构性结论交用户拍板｜fix 提交碰热点要带 Direction-Check: <复盘文档路径>（git commit-msg 会校验）"
  echo ""
fi
# 派工 / 子 agent（省 token，编排手册 §20）
if hit_block dispatch-token '派工|派活|子 ?agent|任务书|并行|开 ?lane|token|额度'; then
  echo "【派工 · 省 token】派活前先数轮次：同一处第 3 轮就停，改派复盘｜不读大文件全文，先看大小和标题再按段读，读子 agent 结论不读过程｜子 agent 同时最多 3 个（含续跑）、默认 Sonnet、不再派子 agent｜任务书写清范围 / 不碰清单 / 停点，发前跑 node scripts/check-dispatch-brief.mjs <任务书>，交货报告要短｜确定性的活用脚本｜长输出落文件、同一文件不反复读｜卡住 3 次就停下报告（编排手册 §20）"
  echo ""
fi
# 命令 / 门岗（全表在 docs/engineering/commands.md）
if hit_block commands 'gates|check:|门岗|命令|pnpm run'; then
  echo "【命令全表】CLAUDE.md 只留 gates 一行；各门岗、冒烟、数门、合并前检查命令的全表在 docs/engineering/commands.md；push 前按风险面分层见 docs/engineering/delivery-and-review.md｜门岗红了先读它红在哪条判据，不许抬基线或预算挤 PR(R17)"
  echo ""
fi
# 交付 / 合并 / 交工评审
if hit_block delivery '合并|merge|收据|verify-merged|preflight|开 ?PR|交工|推送'; then
  echo "【交付 · R11/R22】开任务先 pnpm run delivery:preflight｜合并规矩（只由协调会话做；其他会话开 PR 后把号发给它，不自己合）：CI 绿 + 扫描干净就合，最多 3 个在等收据，任何一个收据红了立刻停、交人定修还是回滚｜细则 docs/engineering/delivery-and-review.md"
  echo ""
fi

cat <<'EOF'
【动手前 · 到这三刻必停（详解 CLAUDE.md）】
① 动手前：这段是我们独有的吗？不是 → 先找现成的接入(P0)｜重要改动先 grill：一轮批量问、每题带默认、连带面单独成题（纯 bug 修复不问）｜碰花钱/长跑/可打断/新界面先写设计卡 design-card(P5)
② 报完成前：全绿≠完成(P3)。截图要自己亲眼 Read 过、来自用户将跑的那个构建；没闭环别说「做完」(R13)
③ push 前：pnpm run gates 全过(R11/R22)
贯穿：修根因不修症状(P2)｜加新必删旧(P1)｜同一处第 3 次修 → 先做类根因复盘(RW)
EOF
