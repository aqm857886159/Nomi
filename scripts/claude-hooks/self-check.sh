#!/usr/bin/env bash
# UserPromptSubmit hook —— 每条用户消息前注入「三闸自检」+「最近栽过的坑」。
# 重构（2026-06-17，docs/plan/2026-06-17-discipline-system-overhaul.md）：从平铺 9 条 → 按「三个决策时刻」
# 组织(杠杆2)；顶部吐 violations.log→数据驱动、会变、针对真实毛病(杠杆3，抗横幅失明)。
# 升级（2026-06-21，docs/plan/2026-06-21-context-handoff-and-self-iterating-control-files.md，S2）：
# 改为按「踩坑次数 hits」排序取前 2——反复犯的优先顶眼前，不再单纯按时间。兼容旧平铺行。
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

cat <<'EOF'
【三闸自检 · 到这三刻必停（完整规则见 CLAUDE.md）】
① 动手写码前 —— 想清楚再动(P5)：用户可见? 先读 docs/design/nomi-design-system.md + 出可体验样张 + 用户拍板(R8)，改/扩现有 UI 先看真实样子=读完整外壳组件或截图，加/挪控件先过 §1.5 控件层级｜碰三方库/新框架? 先 Context7+web 查最现役(R5)｜多文件? 先写 docs/plan(R4)｜取舍/架构岔路? 给对比表让用户拍板(R3)
② 报完成/交付给用户看前 —— 全绿≠完成(P3)：和获批样张逐项对账 + 真机走查(R13)，截图必须自己亲眼 Read 过，来自用户将跑的那个构建/平台/入口，拍得到改动区。没闭环就别说「做完/修好/通过/给你看」
③ push 前 —— `pnpm run gates` 全过(R11/R22)。push 闸会拦没过的
【贯穿全程】修 bug 挖根因不修症状·答得出「这类不再复发」才算到根因(P2)｜加新必删旧·无并行版/fallback/逃生口(P1)｜随输入 derive 不 hardcode｜分层·单文件≤800 行(R9)
EOF

# 交付账本提醒（现役欠账 + 最久停滞 top3）——账本设计里「salience 才是关键」的那一半，2026-09-02 接上。
# 现算，不读任何 committed 产物：账本本身是本地视图、不进 git（含全局计数，commit 了会造成
# 人工解不对的合并冲突，见 docs/fixes/2026-09-02-unmergeable-generated-artifact.root-cause.json）。
# 失败静默跳过，不阻塞本 hook 的三闸输出。
node "$ROOT/scripts/build-delivery-ledger.mjs" --brief 2>/dev/null || true
