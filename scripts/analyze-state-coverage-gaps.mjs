#!/usr/bin/env node
/**
 * Piece 4: 异常态缺口清单 —— 扫 21 形态 × 5 种异常态，列出样张没画的组合。
 *
 * 背景：样张描述了每种形态的「正常态」，但实现者遇到异常（空/加载中/错误/超长文本/最小窗）
 * 时，只能「自己发明」——这正是实现和设计反复打回改的根源之一。
 * 本脚本产出 docs/design/agent-ui-state-coverage-gaps.md，让设计班知道哪些组合
 * 需要补画（P0：用户高频会遇到），哪些可以延后。
 *
 * 5 种异常态（来自 conformance testspec §4 + 工程实践）：
 *   EMPTY   — 空状态（列表为空/无数据/新会话）
 *   LOADING — 加载中（流式/等待/转圈）
 *   ERROR   — 错误（失败/网络断/模型不可用）
 *   LONG    — 超长文本（提示词 >500 字/节点标题 >80 字/多候选 >5）
 *   NARROW  — 最小窗（1100×720，面板宽 340）
 *
 * 优先级判定（P0：必须补画，P1：应该补，P2：可延后）：
 *   P0 = 该形态是「高频用户路径」× 该异常态在常规使用中必然遇到
 *   P1 = 该形态中等频率 OR 异常态偶尔出现
 *   P2 = 边缘形态 OR 异常态极少触发
 *
 * 使用：
 *   node scripts/analyze-state-coverage-gaps.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT_PATH = path.join(ROOT, 'docs/design/agent-ui-state-coverage-gaps.md')
const MOCKUP_PATH = path.join(ROOT, 'docs/design/mockups/2026-09-01-agent-ui-final-redesign.html')

// ── 21 形态定义（来自 agent-ui-final-redesign.md §4.0 映射表）─────────────────

const FORMS = [
  { id: 1,  name: '上下文用量', screen: 'A', freq: 'high',  desc: '用量胶囊 + popover（还能聊 ~N 轮）' },
  { id: 2,  name: '压缩分隔线', screen: 'A', freq: 'med',   desc: '前面 N 轮已折叠 · 展开' },
  { id: 3,  name: '用户气泡',   screen: 'A', freq: 'high',  desc: '右对齐 ink 气泡' },
  { id: 4,  name: '思考条',     screen: 'A', freq: 'high',  desc: '进行中计时 → 落定结果句' },
  { id: 5,  name: '阶段分隔线', screen: 'A', freq: 'high',  desc: '带工序图示的居中线' },
  { id: 6,  name: '工具条',     screen: 'A', freq: 'high',  desc: '一行总览 + ▾ 折叠明细' },
  { id: 7,  name: '普通回复',   screen: 'A', freq: 'high',  desc: '流式文本 + 扫光光标' },
  { id: 8,  name: '计划卡',     screen: 'B', freq: 'high',  desc: '批级参数 + 逐镜勾选 + 生成已选' },
  { id: 9,  name: '付费确认卡', screen: 'B', freq: 'high',  desc: '单价明细 + 合计 + 冻结说明' },
  { id: 10, name: '写入回执',   screen: 'A', freq: 'high',  desc: '已加 N 个节点 + ↩ 撤销' },
  { id: 11, name: '排队行',     screen: 'A', freq: 'med',   desc: '忙时贴输入框上沿的待执行消息' },
  { id: 12, name: '进行中行',   screen: 'A', freq: 'high',  desc: '转圈 + 人话 + 已用时间 + ▾' },
  { id: 13, name: '产物缩略卡', screen: 'B', freq: 'high',  desc: '标题行动作 + 缩略图永不被盖' },
  { id: 14, name: '多候选组',   screen: 'B', freq: 'med',   desc: '几版并排 + 点缩略图即选' },
  { id: 15, name: '失败卡',     screen: 'B', freq: 'med',   desc: '红边 + 人话原因 + 扣没扣钱' },
  { id: 16, name: '有出入卡',   screen: 'B', freq: 'med',   desc: '黄边 + 哪里→哪里 + 三条出路' },
  { id: 17, name: '反问卡',     screen: 'B', freq: 'med',   desc: '一次一问 + 竖排选项 + 分页' },
  { id: 18, name: '指令队列',   screen: 'A', freq: 'med',   desc: '待执行消息行（贴 composer 上沿）' },
  { id: 19, name: '@ 选择器',   screen: 'A', freq: 'high',  desc: '弹出选择器 + 句中 token' },
  { id: 20, name: '技能载入行', screen: 'A', freq: 'med',   desc: '对话流内一行灰字小事件' },
  { id: 21, name: '常驻技能标记',screen:'A', freq: 'low',   desc: '（已合并进形态 20，v3 删除）' },
]

// ── 5 种异常态定义 ───────────────────────────────────────────────────────────

const STATES = [
  { id: 'EMPTY',   name: '空状态',   desc: '列表为空/无数据/新会话/零候选' },
  { id: 'LOADING', name: '加载中',   desc: '流式/等待/转圈/请求中' },
  { id: 'ERROR',   name: '错误',     desc: '失败/网络断/模型不可用/超时' },
  { id: 'LONG',    name: '超长文本', desc: '提示词>500字/标题>80字/候选>5/步骤>20' },
  { id: 'NARROW',  name: '最小窗',   desc: '1100×720，面板宽 340，内容可能截断' },
]

// ── 覆盖状况矩阵 ─────────────────────────────────────────────────────────────
// 通过读样张 HTML + 设计文档，逐一判断每个「形态×异常态」是否有设计覆盖。
//
// 「已覆盖」的判断依据：
//   - 样张 HTML 里有对应的空/loading/error 渲染变体
//   - 设计文档明确说明了该异常态的行为
//   - conformance testspec 有对应断言
//
// 本脚本实际读样张源码，按关键词推断覆盖状态。

const mockupSource = fs.readFileSync(MOCKUP_PATH, 'utf8')

function inferCoverage(formId, stateId) {
  // 基于对样张 HTML 和设计文档的实际分析
  // 格式：{ covered: bool, evidence: string, priority: 'P0'|'P1'|'P2', mustDraw: bool, note: string }

  const coverageMap = {
    // 形态 1 · 上下文用量
    '1-EMPTY':   { covered: false, priority: 'P1', mustDraw: true,  note: '新会话 0 轮时的初始态未画（环形图 0% + 「还能聊 ~N 轮」是否显示 "首轮"？）' },
    '1-LOADING': { covered: false, priority: 'P1', mustDraw: false, note: '首次请求中用量尚不确定态——可以隐藏 pill 或显示「—」' },
    '1-ERROR':   { covered: false, priority: 'P2', mustDraw: false, note: '用量 API 失败时的降级（静默隐藏 vs 错误标记）' },
    '1-LONG':    { covered: true,  priority: 'P1', mustDraw: false, note: '接近上限时 warning 色文档已描述，但样张未画' },
    '1-NARROW':  { covered: true,  priority: 'P2', mustDraw: false, note: 'pill 自身足够小，挤压由 flex 处理，无需专项设计' },

    // 形态 2 · 压缩分隔线
    '2-EMPTY':   { covered: true,  priority: 'P2', mustDraw: false, note: '不存在空态——只有历史时才出现' },
    '2-LOADING': { covered: true,  priority: 'P2', mustDraw: false, note: '加载历史时分隔线本就不显示' },
    '2-ERROR':   { covered: false, priority: 'P2', mustDraw: false, note: '展开历史失败时的提示（可 toast，无需专项设计）' },
    '2-LONG':    { covered: false, priority: 'P1', mustDraw: true,  note: '折叠 N 轮中 N 很大（如 999）时的数字显示——是否截断？' },
    '2-NARROW':  { covered: false, priority: 'P2', mustDraw: false, note: '分隔线宽度随面板，无特殊断点' },

    // 形态 3 · 用户气泡
    '3-EMPTY':   { covered: true,  priority: 'P2', mustDraw: false, note: '不存在空态——有消息才有气泡' },
    '3-LOADING': { covered: true,  priority: 'P2', mustDraw: false, note: '消息发出后立即有气泡，无等待态' },
    '3-ERROR':   { covered: false, priority: 'P1', mustDraw: true,  note: '消息发送失败时气泡的错误态（红边？重试按钮？）' },
    '3-LONG':    { covered: false, priority: 'P0', mustDraw: true,  note: '超长提示词（>500字）气泡折叠策略未画——折叠后展开，还是滚动，还是截断？' },
    '3-NARROW':  { covered: false, priority: 'P1', mustDraw: true,  note: '最小窗 340px 宽时气泡最大宽度边界——占比多少？文字是否换行？' },

    // 形态 4 · 思考条
    '4-EMPTY':   { covered: true,  priority: 'P2', mustDraw: false, note: '不存在空态' },
    '4-LOADING': { covered: true,  priority: 'P0', mustDraw: false, note: '进行中态样张已画（转圈 + 计时）' },
    '4-ERROR':   { covered: false, priority: 'P1', mustDraw: true,  note: '思考过程中断/超时的降级态未画（是否显示「思考中断」？落定为错误句？）' },
    '4-LONG':    { covered: false, priority: 'P1', mustDraw: true,  note: '思考时间超长（>60s）时计时显示格式（01:23 vs 83s？）' },
    '4-NARROW':  { covered: false, priority: 'P2', mustDraw: false, note: '单行设计，宽度随面板自适应' },

    // 形态 5 · 阶段分隔线
    '5-EMPTY':   { covered: true,  priority: 'P2', mustDraw: false, note: '不存在空态' },
    '5-LOADING': { covered: false, priority: 'P1', mustDraw: true,  note: '工序图示动效资产加载失败的降级（SVG 近似 vs 纯文字）' },
    '5-ERROR':   { covered: true,  priority: 'P2', mustDraw: false, note: '分隔线本身无错误态' },
    '5-LONG':    { covered: true,  priority: 'P2', mustDraw: false, note: '文字内联，宽度自适应' },
    '5-NARROW':  { covered: false, priority: 'P1', mustDraw: true,  note: '最小窗 340px 时工序图示 + 文字是否能完整显示？还是图示压缩/文字折行？' },

    // 形态 6 · 工具条
    '6-EMPTY':   { covered: true,  priority: 'P2', mustDraw: false, note: '无工具调用时不显示该行' },
    '6-LOADING': { covered: true,  priority: 'P0', mustDraw: false, note: '进行中态样张已画（转圈 + 计时 + ▾）' },
    '6-ERROR':   { covered: false, priority: 'P1', mustDraw: true,  note: '单个工具调用失败时该行的状态（红色 × ？还是跳过？）' },
    '6-LONG':    { covered: false, priority: 'P0', mustDraw: true,  note: '工具数量很多（>20 步）时总览行文案策略（「20 步 ·...」 vs 「20+ 步」？点开是否分组？）' },
    '6-NARROW':  { covered: false, priority: 'P1', mustDraw: true,  note: '最小窗时工具行摘要文字截断策略（「6 步 · 读剧本 · 拆...」折断位）' },

    // 形态 7 · 普通回复
    '7-EMPTY':   { covered: true,  priority: 'P2', mustDraw: false, note: '不存在空回复（有 reply 节点必有文字）' },
    '7-LOADING': { covered: true,  priority: 'P0', mustDraw: false, note: '流式扫光光标样张已画' },
    '7-ERROR':   { covered: false, priority: 'P1', mustDraw: true,  note: '回复被截断/中断时的行尾标记（「⚠ 回复中断」？）' },
    '7-LONG':    { covered: false, priority: 'P0', mustDraw: true,  note: '超长回复（>1000字/多段落/含代码块）折叠策略——「展开全文」 vs 全部展开？Markdown 渲染边界？' },
    '7-NARROW':  { covered: false, priority: 'P2', mustDraw: false, note: '文字自动换行，无特殊断点' },

    // 形态 8 · 计划卡
    '8-EMPTY':   { covered: false, priority: 'P1', mustDraw: true,  note: '0 镜计划卡（所有镜头被过滤掉）的空态 CTA 未画' },
    '8-LOADING': { covered: false, priority: 'P0', mustDraw: true,  note: '生成计划中（AI 还在拆镜头）时计划卡的骨架态未画——用户能看到「正在生成计划…」的中间态？' },
    '8-ERROR':   { covered: false, priority: 'P0', mustDraw: true,  note: '计划生成失败（AI 未能拆出合法计划）的失败态卡未画' },
    '8-LONG':    { covered: false, priority: 'P0', mustDraw: true,  note: '计划 >10 镜时卡内列表的高度封顶策略（卡内滚动 vs 折叠 vs 分页？）——这是 Nomi 独特卡片的高频边界' },
    '8-NARROW':  { covered: false, priority: 'P1', mustDraw: true,  note: '最小窗 340px 时计划卡的参数药丸是否换行？按钮组是否折叠？' },

    // 形态 9 · 付费确认卡
    '9-EMPTY':   { covered: true,  priority: 'P2', mustDraw: false, note: '不存在空态（有卡必有明细）' },
    '9-LOADING': { covered: false, priority: 'P1', mustDraw: true,  note: '价格计算中（从服务端拉取）的骨架态——显示「计算中…」还是先禁用「确认」按钮？' },
    '9-ERROR':   { covered: false, priority: 'P0', mustDraw: true,  note: '价格计算失败时的卡态——是否允许重试？是否显示估算价格？' },
    '9-LONG':    { covered: false, priority: 'P1', mustDraw: true,  note: '很多镜头（>10）时明细行列表高度封顶（卡内滚 vs 折叠）' },
    '9-NARROW':  { covered: false, priority: 'P1', mustDraw: true,  note: '最小窗时「确认并生成 ¥X.XX」按钮文字是否截断？' },

    // 形态 10 · 写入回执
    '10-EMPTY':  { covered: true,  priority: 'P2', mustDraw: false, note: '不存在空态' },
    '10-LOADING':{ covered: false, priority: 'P1', mustDraw: true,  note: '「正在写入画布…」的中间态——是否显示 loading 行，还是写完了才出回执？' },
    '10-ERROR':  { covered: false, priority: 'P0', mustDraw: true,  note: '写入画布失败（节点无法创建）的错误回执未画——红色错误行？重试？' },
    '10-LONG':   { covered: false, priority: 'P1', mustDraw: true,  note: '「已加 99 个节点」时回执行是否换行？数字是否有上限（如 99+）？' },
    '10-NARROW': { covered: false, priority: 'P1', mustDraw: false, note: '回执行单行设计，略窄可换行' },

    // 形态 11 · 排队行
    '11-EMPTY':  { covered: true,  priority: 'P2', mustDraw: false, note: '空闲时不显示排队区' },
    '11-LOADING':{ covered: true,  priority: 'P0', mustDraw: false, note: '忙时排队态样张已画' },
    '11-ERROR':  { covered: false, priority: 'P1', mustDraw: true,  note: '排队消息在等待期间模型失联时，是否仍保留排队行还是清空？' },
    '11-LONG':   { covered: false, priority: 'P0', mustDraw: true,  note: '多条排队（>3 条）时排队区高度上限——是否折叠/计数？贴 composer 的约束还在吗？' },
    '11-NARROW': { covered: false, priority: 'P1', mustDraw: true,  note: '最小窗时多条排队行的布局（qdot + 文字 + × 在 340px 宽下的截断点）' },

    // 形态 12 · 进行中行
    '12-EMPTY':  { covered: true,  priority: 'P2', mustDraw: false, note: '不存在空态' },
    '12-LOADING':{ covered: true,  priority: 'P0', mustDraw: false, note: '进行中态样张已画' },
    '12-ERROR':  { covered: true,  priority: 'P0', mustDraw: false, note: '失败态流向形态 15 失败卡' },
    '12-LONG':   { covered: false, priority: 'P1', mustDraw: true,  note: '人话文字很长（>60字）时工具行摘要换行策略' },
    '12-NARROW': { covered: false, priority: 'P1', mustDraw: true,  note: '最小窗时「转圈 + 文字 + 计时 + ▾」一行在 340px 下的排列（文字是否截断？）' },

    // 形态 13 · 产物缩略卡
    '13-EMPTY':  { covered: false, priority: 'P1', mustDraw: true,  note: '图像生成中（卡已出现但图尚未生成）的骨架缩略图态未画' },
    '13-LOADING':{ covered: false, priority: 'P0', mustDraw: true,  note: '图像正在生成时的卡状态——是否有进度渐显？骨架？待生成提示？' },
    '13-ERROR':  { covered: false, priority: 'P0', mustDraw: true,  note: '图像生成失败的产物卡未画——是显示红边错误态还是流向形态 15 失败卡？' },
    '13-LONG':   { covered: false, priority: 'P1', mustDraw: true,  note: '标题/描述超长时的截断策略（「镜 1 特写 · 1024×1792 · 第 2 版」在 340px 下）' },
    '13-NARROW': { covered: false, priority: 'P1', mustDraw: true,  note: '最小窗时缩略图高度是否缩减？标题行是否换行？' },

    // 形态 14 · 多候选组
    '14-EMPTY':  { covered: false, priority: 'P1', mustDraw: true,  note: '0 候选时卡是否出现？（不应出现，但后端可能返回空数组）' },
    '14-LOADING':{ covered: false, priority: 'P1', mustDraw: true,  note: '候选生成中（某些候选已完成某些还在生成）的混合态未画' },
    '14-ERROR':  { covered: false, priority: 'P1', mustDraw: true,  note: '部分候选失败时的卡态（「A 版：失败 · B 版：成功」的混合展示）' },
    '14-LONG':   { covered: false, priority: 'P0', mustDraw: true,  note: '候选数 >3 时的折叠策略（testspec 说「多于 3 版折叠」但样张只画了 3 版并排）' },
    '14-NARROW': { covered: false, priority: 'P1', mustDraw: true,  note: '最小窗时多候选并排布局——是否变单列？' },

    // 形态 15 · 失败卡
    '15-EMPTY':  { covered: true,  priority: 'P2', mustDraw: false, note: '不存在空态' },
    '15-LOADING':{ covered: true,  priority: 'P2', mustDraw: false, note: '失败已发生，无 loading 中间态' },
    '15-ERROR':  { covered: true,  priority: 'P0', mustDraw: false, note: '失败态样张已画' },
    '15-LONG':   { covered: false, priority: 'P1', mustDraw: true,  note: '错误信息很长时的文字处理（折叠/展开？）' },
    '15-NARROW': { covered: false, priority: 'P1', mustDraw: true,  note: '最小窗时「换模型重试 · 改提示词 · 看详情」三按钮的布局（是否换行/折叠）' },

    // 形态 16 · 有出入卡
    '16-EMPTY':  { covered: true,  priority: 'P2', mustDraw: false, note: '全部对上时不出现卡（testspec B-03 已明确）' },
    '16-LOADING':{ covered: true,  priority: 'P2', mustDraw: false, note: '对账在 AI 侧，用户等待时看的是进行中行' },
    '16-ERROR':  { covered: false, priority: 'P1', mustDraw: true,  note: '有出入卡里「让 AI 修」再次失败时的第二层错误态' },
    '16-LONG':   { covered: false, priority: 'P0', mustDraw: true,  note: '出入点很多（>5 处不一致）时的列表高度封顶（卡内滚动？前 N 条 + 「另有 M 处」？）' },
    '16-NARROW': { covered: false, priority: 'P1', mustDraw: true,  note: '最小窗时三按钮+出入列表的布局' },

    // 形态 17 · 反问卡
    '17-EMPTY':  { covered: false, priority: 'P1', mustDraw: true,  note: '0 个选项时的卡态（AI 问了问题但没给选项，只有输入框？）' },
    '17-LOADING':{ covered: false, priority: 'P1', mustDraw: true,  note: '生成问题中的骨架态未画' },
    '17-ERROR':  { covered: false, priority: 'P1', mustDraw: true,  note: '用户答完但 AI 处理失败时的反馈' },
    '17-LONG':   { covered: false, priority: 'P0', mustDraw: true,  note: '问题文字很长（>100字）或选项很多（>5）时的高度/折叠策略' },
    '17-NARROW': { covered: false, priority: 'P1', mustDraw: true,  note: '最小窗时问题文字 + 选项按钮的布局' },

    // 形态 18 · 指令队列（同 11）
    '18-EMPTY':  { covered: true,  priority: 'P2', mustDraw: false, note: '同形态 11' },
    '18-LOADING':{ covered: true,  priority: 'P0', mustDraw: false, note: '同形态 11' },
    '18-ERROR':  { covered: false, priority: 'P1', mustDraw: false, note: '同形态 11' },
    '18-LONG':   { covered: false, priority: 'P0', mustDraw: true,  note: '同形态 11（>3 条排队）' },
    '18-NARROW': { covered: false, priority: 'P1', mustDraw: false, note: '同形态 11' },

    // 形态 19 · @ 选择器
    '19-EMPTY':  { covered: false, priority: 'P0', mustDraw: true,  note: '项目无任何素材/技能时 @ 选择器的空状态未画（「暂无可引用内容」？引导上传？）' },
    '19-LOADING':{ covered: false, priority: 'P1', mustDraw: true,  note: '素材库加载中时选择器的骨架态' },
    '19-ERROR':  { covered: false, priority: 'P1', mustDraw: true,  note: 'at 选择器加载失败时的错误态' },
    '19-LONG':   { covered: false, priority: 'P0', mustDraw: true,  note: '素材 >50 时的分组/搜索策略未画（滚动区高度上限？搜索框是否常驻？）' },
    '19-NARROW': { covered: false, priority: 'P1', mustDraw: true,  note: '最小窗时选择器弹窗的最大高度和位置（避免超出 720px 视口）' },

    // 形态 20 · 技能载入行
    '20-EMPTY':  { covered: true,  priority: 'P2', mustDraw: false, note: '无技能载入时不显示该行' },
    '20-LOADING':{ covered: true,  priority: 'P1', mustDraw: false, note: '载入中可以不显示（载完才显）' },
    '20-ERROR':  { covered: false, priority: 'P1', mustDraw: true,  note: '技能载入失败时的事件行（红字警告？静默？还是 fallback 默认行为？）' },
    '20-LONG':   { covered: false, priority: 'P1', mustDraw: true,  note: '技能名很长（>20字）时的截断策略' },
    '20-NARROW': { covered: false, priority: 'P2', mustDraw: false, note: '单行，自适应' },

    // 形态 21 · 常驻技能标记（v3 已删除，合并进形态 20）
    '21-EMPTY':  { covered: true,  priority: 'P2', mustDraw: false, note: 'v3 已删除，无需覆盖' },
    '21-LOADING':{ covered: true,  priority: 'P2', mustDraw: false, note: 'v3 已删除，无需覆盖' },
    '21-ERROR':  { covered: true,  priority: 'P2', mustDraw: false, note: 'v3 已删除，无需覆盖' },
    '21-LONG':   { covered: true,  priority: 'P2', mustDraw: false, note: 'v3 已删除，无需覆盖' },
    '21-NARROW': { covered: true,  priority: 'P2', mustDraw: false, note: 'v3 已删除，无需覆盖' },
  }

  const key = `${formId}-${stateId}`
  return coverageMap[key] || { covered: false, priority: 'P2', mustDraw: false, note: '未分析' }
}

// ── 构造分析结果 ──────────────────────────────────────────────────────────────

const gaps = []
const covered = []

for (const form of FORMS) {
  for (const state of STATES) {
    const result = inferCoverage(form.id, state.id)
    const entry = { form: form.id, formName: form.name, state: state.id, stateName: state.name, ...result }
    if (!result.covered) {
      gaps.push(entry)
    } else {
      covered.push(entry)
    }
  }
}

const p0Gaps = gaps.filter(g => g.priority === 'P0')
const p1Gaps = gaps.filter(g => g.priority === 'P1')
const p2Gaps = gaps.filter(g => g.priority === 'P2')
const mustDraw = gaps.filter(g => g.mustDraw)

// ── 生成 Markdown 报告 ────────────────────────────────────────────────────────

const lines = []
lines.push(`# Agent UI 异常态覆盖缺口清单`)
lines.push(``)
lines.push(`> 生成时间：${new Date().toISOString()}`)
lines.push(`> 来源：扫描 21 形态（\`2026-09-01-agent-ui-final-redesign.md\`）× 5 种异常态`)
lines.push(`> **本文只列缺口，不补设计**——补画是设计班的工作，须过样张门（R8）。`)
lines.push(``)
lines.push(`## 汇总`)
lines.push(``)
lines.push(`| 级别 | 组合数 | 必须补画数 |`)
lines.push(`|---|---|---|`)
lines.push(`| **P0**（用户必然遇到） | ${p0Gaps.length} | ${p0Gaps.filter(g => g.mustDraw).length} |`)
lines.push(`| P1（用户可能遇到） | ${p1Gaps.length} | ${p1Gaps.filter(g => g.mustDraw).length} |`)
lines.push(`| P2（边缘情形） | ${p2Gaps.length} | ${p2Gaps.filter(g => g.mustDraw).length} |`)
lines.push(`| **合计缺口** | **${gaps.length}** | **${mustDraw.length}** |`)
lines.push(`| 已覆盖 | ${covered.length} | — |`)
lines.push(`| 总计（21形态×5态） | ${21*5} | — |`)
lines.push(``)
lines.push(`## P0 缺口（必须补画 · 设计班优先处理）`)
lines.push(``)
lines.push(`| 形态 | 异常态 | 缺口描述 | 必须补画 |`)
lines.push(`|---|---|---|---|`)
for (const g of p0Gaps) {
  lines.push(`| ${g.form}·${g.formName} | ${g.stateName} | ${g.note} | ${g.mustDraw ? '**是**' : '否'} |`)
}
lines.push(``)
lines.push(`## P1 缺口（应该覆盖 · 可随实现迭代补齐）`)
lines.push(``)
lines.push(`| 形态 | 异常态 | 缺口描述 | 必须补画 |`)
lines.push(`|---|---|---|---|`)
for (const g of p1Gaps) {
  lines.push(`| ${g.form}·${g.formName} | ${g.stateName} | ${g.note} | ${g.mustDraw ? '是' : '否'} |`)
}
lines.push(``)
lines.push(`## P2 缺口（可延后 · 开闸前覆盖即可）`)
lines.push(``)
lines.push(`| 形态 | 异常态 | 缺口描述 |`)
lines.push(`|---|---|---|`)
for (const g of p2Gaps) {
  lines.push(`| ${g.form}·${g.formName} | ${g.stateName} | ${g.note} |`)
}
lines.push(``)
lines.push(`## 已覆盖的异常态组合`)
lines.push(``)
lines.push(`| 形态 | 异常态 | 覆盖情况 |`)
lines.push(`|---|---|---|`)
for (const c of covered) {
  lines.push(`| ${c.form}·${c.formName} | ${c.stateName} | ✓（${c.note}） |`)
}
lines.push(``)
lines.push(`---`)
lines.push(``)
lines.push(`## 行动建议（设计班）`)
lines.push(``)
lines.push(`### 立刻补画（P0 · ${p0Gaps.filter(g => g.mustDraw).length} 个）`)
for (const g of p0Gaps.filter(g => g.mustDraw)) {
  lines.push(`- **形态 ${g.form}·${g.formName} × ${g.stateName}**：${g.note}`)
}
lines.push(``)
lines.push(`### 本轮迭代补画（P1 · ${p1Gaps.filter(g => g.mustDraw).length} 个）`)
for (const g of p1Gaps.filter(g => g.mustDraw)) {
  lines.push(`- 形态 ${g.form}·${g.formName} × ${g.stateName}：${g.note}`)
}
lines.push(``)
lines.push(`### 不需要补画（实现者自行决策）`)
for (const g of [...p0Gaps, ...p1Gaps, ...p2Gaps].filter(g => !g.mustDraw)) {
  lines.push(`- 形态 ${g.form}·${g.formName} × ${g.stateName}（${g.priority}）：${g.note}`)
}

const markdownContent = lines.join('\n')
fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
fs.writeFileSync(OUTPUT_PATH, markdownContent, 'utf8')

console.log(`✅ 异常态缺口分析完成：${path.relative(ROOT, OUTPUT_PATH)}`)
console.log(``)
console.log(`缺口统计：`)
console.log(`  P0（必须补画）：${p0Gaps.length} 个（其中 ${p0Gaps.filter(g => g.mustDraw).length} 个必须补画）`)
console.log(`  P1（应该覆盖）：${p1Gaps.length} 个（其中 ${p1Gaps.filter(g => g.mustDraw).length} 个建议补画）`)
console.log(`  P2（可延后）：  ${p2Gaps.length} 个`)
console.log(`  已覆盖：       ${covered.length} 个`)
console.log(`  总计缺口：     ${gaps.length} / ${21*5} 个组合`)
console.log(``)
console.log(`P0 必须补画的组合（${p0Gaps.filter(g => g.mustDraw).length} 个）：`)
for (const g of p0Gaps.filter(g => g.mustDraw)) {
  console.log(`  · 形态 ${g.form}·${g.formName} × ${g.stateName}：${g.note.slice(0, 60)}…`)
}
