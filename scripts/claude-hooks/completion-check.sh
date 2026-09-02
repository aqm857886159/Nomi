#!/usr/bin/env bash
# Stop hook = 回合结束时的「报完成/交付前」闸（P3/R13 决策点）。保守触发 + fail-open，吵就删。
# 设计见 docs/plan/2026-06-17-discipline-system-overhaul.md（杠杆 1）。
#
# 2026-07-12 眼见链升级（素材盒事故复盘）：修在 win32 分支、mac 没生效；走查截图产出了
# 但没 Read 就把沙盒递给用户——用户当场抓到「和原来一样」。暴露旧版两个洞：
#   ① 「给你看/打开看」这类**交付话术**不算「宣布完成」→ 闸根本没触发；
#   ② 就算触发，只查文字里**提没提**「走查」，不查截图是否真被亲眼 Read 过——
#      产出验证物 ≠ 消费验证物（查嘴不查眼）。
# 升级后判定：本轮改了 src|electron 代码 + 末条消息像宣布完成/交付给用户看
#   + 近窗口内没有任何图片 Read 痕迹（.png/.jpg/.webp）+ 没明说暂缓/纯内部/测试覆盖
#   → block 一次，逼「跑截图→亲眼 Read→确认是用户将跑的那个构建/平台分支→再交付」闭环。
# 已自带 stop_hook_active 防循环。
set +e

# INPUT 经 env 传给 python（heredoc 占了 stdin，不能再用 stdin 传数据）。
INPUT="$(cat)"
CC_INPUT="$INPUT" python3 <<'PY' 2>/dev/null
import os, sys, json, re
try:
    data = json.loads(os.environ.get("CC_INPUT", "") or "{}")
except Exception:
    sys.exit(0)  # 解析失败 → 放行

if data.get("stop_hook_active"):
    sys.exit(0)  # 防循环：已经因本 hook 续过一轮，不再拦

tp = data.get("transcript_path", "")
if not tp:
    sys.exit(0)
try:
    with open(tp, "r") as f:
        lines = f.readlines()
except Exception:
    sys.exit(0)

# 近窗口 ~250 条：足够罩住一整个长回合（改码→走查→Read 截图→收尾）。
recent = lines[-250:]
last_assistant_text = ""
edited_ui_code = False   # 只认 src/ 与 electron/ 的 Edit/Write —— docs/tests 改动不欠走查
image_read = False       # 眼见链证据：本窗口内亲眼 Read 过截图
IMG_EXT = re.compile(r"\.(png|jpe?g|webp)([?#].*)?$", re.I)
UI_PATH = re.compile(r"(^|/)(src|electron)/")
for ln in recent:
    try:
        obj = json.loads(ln)
    except Exception:
        continue
    msg = obj.get("message", obj)
    role = msg.get("role") or obj.get("type")
    content = msg.get("content")
    if isinstance(content, list):
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use":
                name = block.get("name")
                inp = block.get("input") if isinstance(block.get("input"), dict) else {}
                fp = str(inp.get("file_path", "") or "")
                if name in ("Edit", "Write", "NotebookEdit") and UI_PATH.search(fp):
                    edited_ui_code = True
                if name == "Read" and IMG_EXT.search(fp):
                    image_read = True
            if role == "assistant" and block.get("type") == "text":
                last_assistant_text = block.get("text", "") or last_assistant_text
    elif isinstance(content, str) and role == "assistant":
        last_assistant_text = content or last_assistant_text

if not edited_ui_code:
    sys.exit(0)  # 本轮没动 src/electron → 不关这闸的事

t = last_assistant_text
# 像在宣布完成 **或交付给用户看**（事故正是「打开看吧」这类话术漏网）
claim = re.search(
    r"(做完|修好|修复(完成|确认)|搞定|大功告成|全部完成|已(完成|修复|搞定)|done\b|all set|搞定了|完成[了。\s]"
    r"|通过\b|全绿|给你看|打开看|你(再)?(看|核|验)一?下|请?验证一下|已经打开|重新打开"
    r"|窗口.{0,8}(打?开好?了)|递给你|可以体验|去体验)",
    t,
)
# 诚实豁免：明说暂缓/纯内部/由测试覆盖 → 放行（逼的是闭环或坦白，不是逼谎报）
deferred = re.search(
    r"(暂缓|欠走查|未走查|还没走查|走查.{0,10}(排后|之后|待办|欠)|纯内部|非用户可见"
    r"|无 ?UI|不影响界面|不可见改动|单测覆盖|测试覆盖|E2E ?覆盖)",
    t, re.I,
)

if claim and not image_read and not deferred:
    print(json.dumps({
        "decision": "block",
        "reason": "P3/R13 眼见链闸：本轮改了 src/electron 代码，末条消息在宣布完成或把东西交给用户看，但整个近窗口里没有一次对截图(.png/.jpg/.webp)的 Read——截图产出了不等于你看过。补齐眼见链再收尾：①跑走查出截图 ②自己 Read 亲眼看 ③确认截图来自用户将运行的那个构建/平台分支/入口（mac 的 NomiAppBar ≠ win32 windowbar，素材盒修错面栽过）④再交付。确属纯内部/非用户可见/已由测试覆盖，就在回复里明说这一点。"
    }))
    sys.exit(0)

sys.exit(0)
PY
exit 0
