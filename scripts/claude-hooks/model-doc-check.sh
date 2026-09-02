#!/usr/bin/env bash
# PreToolUse hook（Write|Edit）—— 「接入/改任何模型前必查真实官方 API 文档，禁瞎编」的精准提醒（R5 扩展）。
# 设计：2026-06-30 用户要求——「所有接入的模型都要去真实查到官方文档才接入，而不是自己瞎编；要完整控制下来，必须每次都控制住」。
# 触发：写/改 electron/catalog/ 下的 vendor/模型定义文件（*Vendor/*Images/*Videos/*Texts/*Audios/*Codec/*Cli/kie*）→ 软注入一条「先抓真实官方文档逐项对账」提醒。
# 非阻断（additionalContext）+ fail-open；测试文件(.test.)与纯基础设施文件(catalogStore/catalogCommit/modelLabel/modelKindHeuristic/archetypeInput)忽略。
# 完整规则见 CLAUDE.md R5 / engineering-rules R5 / 记忆 model-onboarding-must-cover-full-api-doc。
set +e
INPUT="$(cat)"
SC_INPUT="$INPUT" python3 <<'PY' 2>/dev/null
import os, sys, json
try:
    d = json.loads(os.environ.get("SC_INPUT", "") or "{}")
except Exception:
    sys.exit(0)  # 解析失败 → 放行
fp = ((d.get("tool_input", {}) or {}).get("file_path", "") or "").replace("\\", "/")
# 覆盖三片 wire 契约区（2026-09-01 补洞：旧版只认 *Vendor/*Images/…后缀+kie* 前缀，
# falOfficial/runwayOfficial/paramTranslate 全溜过——恰是当天三处无出处修复；命中的 kieKling 恰有出处。
# 教训=白名单反向命中：catalog/connectors/videoCapabilities 下默认全命中，仅豁免基础设施与测试）。
WIRE_DIRS = ("electron/catalog/", "electron/connectors/", "electron/shared/videoCapabilities/")
if not fp.endswith(".ts") or not any(w in fp for w in WIRE_DIRS):
    sys.exit(0)
name = fp.rsplit("/", 1)[-1]
if ".test." in name or name.endswith(".generated.ts"):
    sys.exit(0)
# 纯基础设施忽略（不承载供应商 wire 契约的文件）
INFRA = ("catalogStore.ts", "catalogCommit.ts", "catalogImport.ts", "catalogReadOnly.ts",
         "modelLabel.ts", "modelKindHeuristic.ts", "archetypeInput.ts", "assetLocalization.ts",
         "vendorEndpoint.ts", "catalogMigrateV4.ts", "connectorPrefsStore.ts", "registry.ts",
         "credentialConfigFields.ts", "networkConfigStore.ts")
if name in INFRA:
    sys.exit(0)
msg = (
    f"【R5 · 模型/供应商 wire 契约三段核心流程（hook 提醒）】你正在改 {name}。2026-09-01 用户定稿的标准作业："
    "【一·文档给依据】先抓该 vendor/模型**真实官方现役文档**（WebFetch 官方站/Context7，禁凭记忆禁凭报错倒推——报错只是线索，文档才是依据），"
    "{变体×模式×参数}逐字段对账，出处 URL+checkedAt+关键句落库；"
    "【二·零额度给覆盖】测试大头零花费做全：合同测试锁非法组合 + **请求构造干跑逐字段比对文档**（本地假服务器不校验格式，干跑对账才抓得住）+ "
    "免费探针（鉴权/列表端点、非200不计费类 API 的校验级探测）——**全部模式无一漏过**；"
    "【三·付费给封印】前两段全绿后，**每个模型**（不是族代表）一发最小真实生成；封印发选**覆盖面最大的模式**（带参考图/参考视频输入的模式优先——参考模式 wire 是纯文模式超集，一发管两头），"
    "产物亲眼**双验：提示词特征 + 参考特征**（喂特征强参考图，产物没出现该特征=参考没传到，即使 HTTP 200 也不算通）；"
    "封印绑定 wire 契约版本（wire 变更/矩阵漂移才重封）；多模式模型其余模式：wire 形态与已封模式差异大（另端点/另编码）才补发，仅多一字段且干跑+免费探针对账通过的记「结构已验」。"
    "文档给依据、零额度给覆盖、付费给封印——三者齐了才叫修完。"
)
print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": msg}}))
sys.exit(0)
PY
exit 0
