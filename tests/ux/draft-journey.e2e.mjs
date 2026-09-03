// L2 旅程层 · 六幕体验验收骨架（plan 2026-08-19-experience-acceptance-harness.md §一/§二）。
//
// 被验收对象 = 蓝图六幕体验（2026-08-19-dialogue-draft-quality-blueprint.md）。设计成**逐波点亮**：
// 今天就能跑，蓝图哪波（W1/W2/W3）交付，对应幕从 pending 转 pass——「体验实现了没」以这里为准。
//
// 防假绿纪律（本仓走查门岗口径）：
//  · pending 幕**不做任何断言、不计 pass**，汇总单列并注明「等哪一波」；
//  · 幕点亮时必须先证明「旧代码下该断言红」（stash/开关法），再合入；
//  · fail>0 退非零；pending 不算失败（否则天天红没人看），但 CI 汇总里永远可见。
//
// 传输 = 真 in-Electron MCP stdio server（headless，磁盘网关）+ mock vendor（零额度）。
// GUI 开着的确认卡/双问路径由 spend-elicit-app-open.walk.mjs 专测，此处不重复。
// 用法：pnpm run build && node tests/ux/draft-journey.e2e.mjs
//
// ⚠️ 已知缺口（2026-09-02 面收敛名迁移时如实记录，未修）：幕 5/5b/6 仍驱动 nomi_generate——它在 M1 期
// 已整体退役（nomiGenerateRetirement.test.ts，-32602），且 42→15 收敛映射里没有它的等价名（单次生成 =
// nomi_operation_plan→preview→gate→execute 语义族，结果形状完全不同）。这三幕需要按 operation 语义族重设计
// （mock 目录还得补已知定价，否则付费门 fail-closed），属旅程重构不属名字迁移；在重构落地前本 harness
// 会在幕 5 处红。幕 0（nomi_intake_brief）随收敛从 MCP 面移除（无外部消费者），已删。
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import {
  assertBuilt,
  BAD_SHOT_MARKER,
  makeIsolatedDirs,
  parseToolResult,
  repoRoot,
  spawnMcpStdioClient,
  startMockVendorServer,
  writeIsolatedCatalog,
} from './_mcpJourney.mjs'

const require = createRequire(import.meta.url)

assertBuilt()
const dirs = makeIsolatedDirs('nomi-draft-journey-')
const mockVendor = await startMockVendorServer()
writeIsolatedCatalog(dirs.settingsDir, mockVendor.origin)

const mcp = spawnMcpStdioClient({
  settingsDir: dirs.settingsDir,
  userDataDir: dirs.userDataDir,
  projectsDir: dirs.projectsDir,
  capabilityDir: dirs.capabilityDir,
  clientInfo: { name: 'codex', version: 'draft-journey-l2' },
})

/** 幕结果收集：pass 幕的每条断言都真跑；pending 幕零断言，只记「等哪波」。 */
const acts = []
const record = (act, status, detail) => { acts.push({ act, status, detail }); console.log(`  [${status}] ${act} — ${detail}`) }
const assertTrue = (cond, label) => { if (!cond) throw new Error(label) }
const metricsPath = path.join(repoRoot, 'test-results/draft-journey-metrics.jsonl')
fs.mkdirSync(path.dirname(metricsPath), { recursive: true })
const metrics = []

let exitCode = 0
try {
  const init = await (async () => { for (let i = 0; i < 20; i++) { try { return await mcp.initialize() } catch { await new Promise((r) => setTimeout(r, 1000)) } } throw new Error('initialize 超时') })()
  assertTrue(init?.result, 'MCP stdio server 起来了')

  const created = parseToolResult(await mcp.callToolOrThrow('nomi_project_create', { name: '验收旅程《2:17 的男人》' }))
  const projectId = created.json?.id || created.json?.projectId
  assertTrue(projectId, '建项目返回 id')

  // （幕 0 开场收敛已随面收敛删除：nomi_intake_brief 从 MCP 目录移除，无外部消费者——见 commit a0091dec。）

  // ── 幕 1 · 剧本 + 圣经（今天可测「剧本落节点 + 指改」半幕；圣经字段等 W2） ──
  {
    const added = parseToolResult(await mcp.callToolOrThrow('nomi_canvas_edit', {
      projectId,
      action: 'add_nodes',
      nodes: [
        { kind: 'shot', title: '#1 外·夜', prompt: '暴雨中的便利店招牌，2:17 的钟面特写' },
        { kind: 'shot', title: '#2 内', prompt: '小周整理货架，玻璃映出街对面的人影' },
        { kind: 'shot', title: '#3 内', prompt: '男人进店，径直走向冰柜，拿同一瓶水' },
      ],
    }))
    const sceneIds = added.json?.ids || []
    assertTrue(sceneIds.length === 3, `3 场剧本场景落画布（得 ${sceneIds.length}）`)
    // 指改 #3：编号即地址 → canvas_edit(set_prompt) → 回读验证生效且其余不动。
    const newPrompt = '男人进店，没拿水，只是站在冰柜前数了 17 秒'
    await mcp.callToolOrThrow('nomi_canvas_edit', { projectId, action: 'set_prompt', nodeId: sceneIds[2], prompt: newPrompt })
    const canvas = parseToolResult(await mcp.callToolOrThrow('nomi_read', { target: 'canvas', projectId }))
    const nodes = canvas.json?.nodes || []
    const scene3 = nodes.find((n) => n.id === sceneIds[2])
    const scene2 = nodes.find((n) => n.id === sceneIds[1])
    assertTrue(scene3?.prompt === newPrompt, '指改 #3 生效（prompt 已换）')
    assertTrue(scene2?.prompt?.includes('小周整理货架'), '未指的 #2 一字未动')
    record('幕1 剧本+指改', 'pass', '3 场落画布；#3 指改生效、#2 未动。圣经 static/dynamic 字段等 W2 点亮。')
  }

  // ── 幕 2 · 定妆冻结门（W2 点亮：未冻结锚拒批量 / 冻结后放行 / 单镜不拦破死锁） ──
  {
    // 冻结门的**真实拦截判据**是 electron 单一真相源 `anchorBible`（headless 冻结门 + production 冻结门读它；
    // GUI 依赖波次读 src 镜像，equivalence 测钉死两侧语义等价）。这里 require **已构建的真判据**（同 harness
    // 既有 require(dist-electron/nodeKindDomain.js) 的先例），对三种锚形态判——即 buildDependencyWaves 把镜头
    // 踢进 blocked('unfrozen-anchor') 时用的**同一个谓词**。先红后绿：stash 掉 electron/anchorBible.ts 后此
    // require 取不到（模块不存在）→ 幕 2 直接红；接回即绿。
    const anchorBible = require(path.join(repoRoot, 'dist-electron/capabilityCore/anchorBible.js'))
    const anchorNode = (frozen) => ({
      id: 'anchor-林夏', kind: 'character',
      meta: { referenceSheet: true, ...(frozen ? { frozen: { at: 1_700_000_000_000, by: 'user' } } : {}) },
    })
    // ① 未冻结拒批量的判据：未冻结视觉锚被真判据挑出 → 这正是「引用它的镜头进 blocked（拒发批量）」的触发条件。
    const unfrozen = anchorBible.unfrozenVisualAnchors([anchorNode(false)])
    assertTrue(unfrozen.length === 1 && unfrozen[0].id === 'anchor-林夏', '未冻结角色卡被真判据挑出（→ 引用它的镜头拒发批量）')
    assertTrue(anchorBible.isVisualAnchorNode(anchorNode(false)) && !anchorBible.isAnchorFrozen(anchorNode(false)), '未冻结锚：isVisualAnchor∧¬isFrozen（波次拦截命中条件）')
    // ② 冻结后放行：同一张卡点了「冻结」（meta.frozen 落时间戳）→ 真判据不再挑出 → 引用它的镜头放行。
    assertTrue(anchorBible.isAnchorFrozen(anchorNode(true)), '冻结后 isAnchorFrozen=真（→ 镜头放行、强制引用该冻结卡）')
    assertTrue(anchorBible.unfrozenVisualAnchors([anchorNode(true)]).length === 0, '冻结后不再被挑出（放行）')
    // 真实画布拓扑：锚 + 镜头 + character_ref 边真的落 headless 画布（冻结门要拦的就是这条引用边的下游）。
    const a2 = parseToolResult(await mcp.callToolOrThrow('nomi_canvas_edit', {
      projectId,
      action: 'add_nodes',
      nodes: [
        { kind: 'character', title: '幕2锚 · 林夏定妆', prompt: '齐肩黑发、左眉一颗痣，红色校服，正面平光定妆照' },
        { kind: 'video', title: '#幕2镜 引用林夏', prompt: '林夏倚护栏远望，缓慢推近', vendor: 'nomi-mock', modelKey: 'nomi-mock-video' },
      ],
    }))
    const [freezeAnchorId, freezeShotId] = a2.json?.ids || []
    assertTrue(freezeAnchorId && freezeShotId, '幕2 锚 + 引用镜头落画布')
    await mcp.callToolOrThrow('nomi_canvas_edit', { projectId, action: 'connect', connections: [{ source: freezeAnchorId, target: freezeShotId, mode: 'character_ref' }] })
    const c2 = parseToolResult(await mcp.callToolOrThrow('nomi_read', { target: 'canvas', projectId }))
    const anchorBack = (c2.json?.nodes || []).find((n) => n.id === freezeAnchorId)
    const refEdge = (c2.json?.edges || []).find((e) => e.source === freezeAnchorId && e.target === freezeShotId)
    assertTrue(anchorBack?.kind === 'character' && refEdge, '锚(kind=character)+镜头+character_ref 边真的持久化（批量拓扑成立）')
    // ③ 单镜不拦（破死锁）的判据面：冻结门只作用于「参考卡（视觉锚）」；镜头节点本身不是视觉锚 → 单镜
    //    生成它/生成锚卡都不被冻结门谓词命中（锚要先出图才能冻结，若单镜也拦则永远死锁）。这里用真判据证「镜头
    //    节点不被当作待冻结锚」；「未冻结锚在本批内仍可单镜跑、只有引用它的镜头被拦」的完整波次流程见
    //    dependencyWaves.test.ts。生成放行本身由幕 5 的真 nomi_generate 顺带证（此处不重复花付费确认，免扰幕 5 计数）。
    assertTrue(!anchorBible.isVisualAnchorNode({ id: freezeShotId, kind: 'video', meta: {} }), '镜头节点不是视觉锚（单镜生成不被冻结门拦——破死锁）')
    // ④ 冻结门第三层的**验证挪到幕 5**：那里本来就有一次真 generate，在这儿再跑一次会提前建立
    //    会话信任、打乱幕 5 的「首镜确认恰 1 次」计数（原注释早就警告过这点）。
    // 完整「镜头→blocked / 冻结确认恰 1 次」的拦截**流程**由铁律层覆盖（gate 的执行面是渲染层/production，非
    // headless MCP 可达）：GUI 波次拦截 dependencyWaves.test.ts、production 冻结门 productionRunDriver.test.ts。
    record('幕2 定妆冻结', 'pass', '真判据(dist-electron/anchorBible)：未冻结锚被挑出(拒批量)/冻结后放行/镜头非锚(单镜不拦破死锁)；锚+镜头+引用边真落画布；第三层单镜提醒真到 agent 眼前且不拦。镜头→blocked 全流程 + 确认恰 1 次由 L1(dependencyWaves/productionRunDriver)覆盖(gate 执行面在渲染层/production，非 headless 可达)。')
  }

  // ── 幕 3 · 分镜落画布 + 参考连线（今天可测） ────────────────────
  let anchorId = ''
  let shotNodeIds = []
  {
    const anchors = parseToolResult(await mcp.callToolOrThrow('nomi_canvas_edit', {
      projectId,
      action: 'add_nodes',
      nodes: [
        { kind: 'character', title: '小周 · 定妆', prompt: '短发圆脸、左眉一颗痣，深蓝工装，正面平光定妆照' },
        { kind: 'scene', title: '便利店 · 场景卡', prompt: '暴雨夜便利店内景，冷白灯光，货架与冰柜' },
      ],
    }))
    const anchorIds = anchors.json?.ids || []
    assertTrue(anchorIds.length === 2, '角色/场景锚落画布')
    anchorId = anchorIds[0]
    const shots = parseToolResult(await mcp.callToolOrThrow('nomi_canvas_edit', {
      projectId,
      action: 'add_nodes',
      nodes: [
        { kind: 'video', title: '#S1 远景·缓推', prompt: '暴雨夜便利店外观，招牌闪烁，缓慢推近', vendor: 'nomi-mock', modelKey: 'nomi-mock-video' },
        { kind: 'video', title: '#S2 中景·固定', prompt: '小周理货抬头看钟，冷白灯光', vendor: 'nomi-mock', modelKey: 'nomi-mock-video' },
      ],
    }))
    shotNodeIds = shots.json?.ids || []
    assertTrue(shotNodeIds.length === 2, '2 个可生成镜头节点落画布')
    await mcp.callToolOrThrow('nomi_canvas_edit', {
      projectId,
      action: 'connect',
      connections: shotNodeIds.map((target) => ({ source: anchorId, target, mode: 'character_ref' })),
    })
    const canvas = parseToolResult(await mcp.callToolOrThrow('nomi_read', { target: 'canvas', projectId }))
    const edges = canvas.json?.edges || []
    const linked = edges.filter((e) => e.source === anchorId && shotNodeIds.includes(e.target))
    assertTrue(linked.length === 2, `锚→镜头参考边齐（得 ${linked.length}/2）`)
    record('幕3 分镜+连线', 'pass', '锚 2 + 镜 2 + 参考边 2；节点带模型绑定。镜头语言字段化等 W4。')
  }

  // ── 幕 4 · 批次确认闸 ───────────────────────────────────────────
  {
    // W3 幕 4 点亮：批次披露纯核（与幕 2 同法 require 已构建的真判据——这是确认闸真正摊给用户看的那段文案）。
    const batch = require(path.join(repoRoot, 'dist-electron/capabilityCore/mcpBatchGate.js'))
    const d = batch.buildBatchDisclosure({
      shots: [
        { index: 1, title: '开场', anchorNames: ['小周'], intent: 'image', model: 'seedream' },
        { index: 2, title: '对视', anchorNames: ['小周', '便利店'], intent: 'video', model: 'seedance' },
      ],
      retryBudgetPerShot: 2,
      verifyEnabled: true,
    })
    assertTrue(d.imageCount === 1 && d.videoCount === 1, '图/视频分开计数（价位差一个量级）')
    assertTrue(d.maxGenerations === 6, `重试预算计入上界（2 镜×(1+2)=6，得 ${d.maxGenerations}）——自动重滚的花费不瞒着`)
    assertTrue(d.message.includes('最坏跑 6 次'), '披露里明说最坏跑几次')
    assertTrue(d.lines[0].includes('#1') && d.lines[1].includes('小周、便利店'), '逐镜清单带镜号（指改地址）与引用锚')
    assertTrue(d.message.includes('不再逐镜打断'), '明说批准后整批跑完——这正是它区别于逐镜确认的价值')
    assertTrue(!/[¥$€]|元/.test(d.message), '不谎报金额（跨 vendor 计费口径不一，凑数字=误导）')
    record('幕4 批次确认闸', 'pass', '批次披露真判据：图/视频分计、重试预算计入上界(最坏 6 次)、逐镜清单带镜号与锚、明示整批不打断、不谎报金额。授权仍走既有付费闸(幕5 已验)。')
  }

  // ── 幕 5 · 生成 + 审片重试（今天可测：生成/进度/会话信任；审片环等 W1） ──
  {
    const before = mcp.elicitationCount()
    const gen1 = parseToolResult(await mcp.callTool('nomi_generate', {
      projectId, nodeId: shotNodeIds[0], vendor: 'nomi-mock', modelKey: 'nomi-mock-video', intent: 'video',
      prompt: '暴雨夜便利店外观，招牌闪烁，缓慢推近',
    }, { timeoutMs: 90_000, progressToken: 'dj-s1' }))
    assertTrue(!gen1.isError && gen1.json?.status === 'succeeded', `镜 S1 生成成功（status=${gen1.json?.status}）`)
    assertTrue(mcp.progressForToken('dj-s1') >= 1, '生成期间有进度帧')
    assertTrue(Boolean(gen1.deepLink), '结果带 nomi:// 深链')
    // 冻结门**第三层**（2026-08-20 补，F15 起词汇统一为「定妆」）：单镜生成不拦，但必须如实提醒
    //「你引用的卡还没定妆」——否则 MCP 客户端绕开 playbook 一镜一镜循环，一次门都不过，二十个镜头全建在
    // 没定妆的脸上。这一镜引用的锚（幕 3 建的）此刻确实未定妆，故提醒必须出现在**给 agent 的文本里**，
    // 不能只挂在结构化字段里没人读。（真实事故：MCP 建的角色卡从来没带 referenceSheet 标记，
    // 冻结门在整条 MCP 路上失明——这条断言就是那个洞的哨兵。）
    assertTrue(/还没定妆/.test(gen1.text || ''), '单镜生成如实提醒「引用的卡还没定妆」（第三层：只提醒不拦）')
    assertTrue(/林夏|小周|锚/.test(gen1.text || ''), '提醒里点名是哪张卡（说「有问题」不说是哪张 = 等于没说）')
    assertTrue(!gen1.isError, '★提醒不拦：带着未冻结锚照样生成成功（增益不是关卡）')
    const askedFirst = mcp.elicitationCount() - before
    assertTrue(askedFirst === 1, `首镜付费确认恰 1 次（得 ${askedFirst}）`)
    // 会话信任：同项目第二镜不再问（昨天落的机制，这里是它在旅程里的横切断言）。
    const gen2 = parseToolResult(await mcp.callTool('nomi_generate', {
      projectId, nodeId: shotNodeIds[1], vendor: 'nomi-mock', modelKey: 'nomi-mock-video', intent: 'video',
      prompt: '小周理货抬头看钟，冷白灯光',
    }, { timeoutMs: 90_000, progressToken: 'dj-s2' }))
    assertTrue(!gen2.isError && gen2.json?.status === 'succeeded', '镜 S2 生成成功')
    const askedSecond = mcp.elicitationCount() - before - askedFirst
    assertTrue(askedSecond === 0, `同项目第二镜免问（多问了 ${askedSecond} 次）`)
    record('幕5 生成+信任', 'pass', '2 镜真跑 mock 管线；进度帧/深链齐；付费确认全程恰 1 次（会话信任生效）。审片 stub 判分 + 定向重试等 W1 点亮。')
  }
  // ── 幕 5b · 审片重试环（W1 点亮：注入坏判分镜头 100% 走重试、重试仍败带红标交付） ──
  let badVerify = null
  let badDelivery = null
  {
    // 注入 1 坏镜：图片镜（图片镜跳过抽帧，判分直接吃 result.url——mock 图是真 PNG），prompt 埋 BAD_SHOT_MARKER
    // → mock judge 命中标记返回身份 1 档。带角色锚引用边 → 身份轴被评（有 anchorDescriptions）。
    const badAnchorRes = parseToolResult(await mcp.callToolOrThrow('nomi_canvas_edit', {
      projectId,
      action: 'add_nodes',
      nodes: [{ kind: 'character', title: '坏镜锚 · 定妆', prompt: '短发圆脸、左眉痣、深蓝工装，正面平光' }],
    }))
    const badAnchorId = (badAnchorRes.json?.ids || [])[0]
    assertTrue(badAnchorId, '坏镜的角色锚落画布')
    const badShotRes = parseToolResult(await mcp.callToolOrThrow('nomi_canvas_edit', {
      projectId,
      action: 'add_nodes',
      nodes: [{ kind: 'image', title: '#坏镜 身份错', prompt: `小周站在冰柜前的画面 ${BAD_SHOT_MARKER}`, vendor: 'nomi-mock', modelKey: 'nomi-mock-image' }],
    }))
    const badShotId = (badShotRes.json?.ids || [])[0]
    assertTrue(badShotId, '坏镜节点落画布')
    await mcp.callToolOrThrow('nomi_canvas_edit', {
      projectId,
      action: 'connect',
      connections: [{ source: badAnchorId, target: badShotId, mode: 'character_ref' }],
    })
    // 生成坏镜 → 审片环应判分低 → 定向重试（复用首发 grant，K≤2）→ 仍低 → 红标交付。
    const gen = parseToolResult(await mcp.callTool('nomi_generate', {
      projectId, nodeId: badShotId, vendor: 'nomi-mock', modelKey: 'nomi-mock-image', intent: 'image',
      prompt: `小周站在冰柜前的画面 ${BAD_SHOT_MARKER}`,
    }, { timeoutMs: 90_000, progressToken: 'dj-bad' }))
    assertTrue(!gen.isError && gen.json?.status === 'succeeded', `坏镜生成成功（status=${gen.json?.status}）`)
    badDelivery = gen
    // 审片环结果在结构化 outcome.verify（模型稳定读，不必抠文本）。
    badVerify = gen.outcome?.verify || null
    assertTrue(badVerify && badVerify.evaluated !== false, '审片真的跑了（outcome.verify 存在）——旧构建下此处为空即红')
    assertTrue(badVerify.passed === false, '注入坏判分镜头未通过审片（passed=false）')
    assertTrue(badVerify.retries === 2, `坏镜走满定向重试 K=2（实际 ${badVerify.retries}）——「100% 走重试」`)
    const flaggedDims = (badVerify.flagged || []).map((f) => f.dimension)
    assertTrue(flaggedDims.includes('identity'), `身份轴被标红（flagged=${flaggedDims.join(',')}）`)
    // 会话信任下坏镜生成不再问人（幕 5 已批准过本项目）。
    record('幕5b 审片重试环', 'pass', `注入坏判分镜头 100% 走重试（K=2）、仍败带红标交付（flagged=${flaggedDims.join(',')}）。judge 走真 stdio + mock-catalog-judge，零额度。`)
  }

  // ── 幕 6 · 交付报告（W1 点亮：过检数/红标/建议/深链结构化） ───────
  {
    // 交付物结构：passed / flagged / suggestion / 深链缺一不可（harness 幕 6 硬判据 + 四硬判据④）。
    assertTrue(badVerify, '幕 6 依赖幕 5b 的审片交付')
    assertTrue(typeof badVerify.passed === 'boolean', '交付含过检结论（passed 布尔）')
    assertTrue(Array.isArray(badVerify.flagged) && badVerify.flagged.length >= 1, '交付含红标清单（flagged 非空，诚实标崩坏）')
    assertTrue(typeof badVerify.suggestion === 'string' && badVerify.suggestion.length > 0, '交付含建议（suggestion 人话，非空）')
    assertTrue(Boolean(badDelivery?.deepLink), '交付含 nomi:// 深链')
    // 文本转述里红标可见（诚实不藏，D4）：⚠️ 红标标记 + 审片行（stdio locale 可能是 en，故 审片/Review 二择一）。
    const t = badDelivery.text
    assertTrue(t.includes('⚠️') && (t.includes('审片') || t.includes('Review')), '交付文本含审片红标行（⚠️ + 审片/Review）')
    record('幕6 交付报告', 'pass', '交付结构含 过检结论/红标清单/建议/深链，文本红标行可见（诚实标崩坏，不藏）。')
  }

  // ── 横切指标（对今天已点亮的部分） ──────────────────────────────
  {
    const total = mcp.elicitationCount()
    assertTrue(total <= 4, `全旅程 Block 确认 ≤4（实际 ${total}）`)
    record('横切 · 打扰预算', 'pass', `全程 elicitation 共 ${total} 次（上限 4）；指改零弹窗（幕 1 已验）。`)
  }

  for (const a of acts) metrics.push(JSON.stringify({ ts: new Date().toISOString(), ...a }))
  fs.writeFileSync(metricsPath, metrics.join('\n') + '\n', 'utf8')

  const pass = acts.filter((a) => a.status === 'pass').length
  const pending = acts.filter((a) => a.status === 'pending').length
  console.log(`\nDRAFT-JOURNEY L2：${pass} 幕通过 · ${pending} 幕待点亮（W1/W2/W3 逐波转绿）· 指标 → test-results/draft-journey-metrics.jsonl`)
} catch (err) {
  exitCode = 1
  console.log(`✗ FAIL: ${err?.message || err}`)
} finally {
  await mcp.terminate()
  await mockVendor.close().catch(() => undefined)
  fs.rmSync(dirs.tempRoot, { recursive: true, force: true })
  process.exit(exitCode)
}
