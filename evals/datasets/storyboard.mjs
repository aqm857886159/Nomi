// L1 拆镜头评测 dataset v0(15 case,纯确定性断言)。
// 形态:case = { id, description, smoke?, input.message, expect } —— expect 由
// evals/lib/grading.mjs 翻译成 componentResults(评终态不评路径)。
// v0 全部是合成 case(冷启动);S2 首轮 error analysis 后用真实失败补到 30-50,
// 真实失败 case 占比 ≥60% 是 §7 运转验收线。
//
// expect 词表:
//   createdShots: [min,max]   创建的镜头节点数量区间(不含画布预置默认节点)
//   eachPromptMinLen: n       每个创建节点 prompt 最短长度
//   kind: [..]                创建节点允许类型(image|video 都算对——宣传片类输入产 video 合理,真不变量是非 text/audio/3d)
//   minChainEdges: n          创建节点之间的连边下限(null=不断言)
//   maxChainEdges: n          连边上限(指令明确说不连线时为 0)
//   category: 'shots'         创建节点应归入的分类

export const datasetName = "storyboard";

export const cases = [
  {
    id: "sb-001",
    description: "明确 3 镜头·短故事",
    smoke: true,
    input: { message: "把这个故事拆成 3 个镜头铺到画布：清晨渔船出海，渔夫撒网，夕阳下满载归航。" },
    expect: { createdShots: [3, 3], eachPromptMinLen: 30, kind: ["image", "video"], minChainEdges: null, category: "shots" },
  },
  {
    id: "sb-002",
    description: "明确 4 镜头·产品介绍",
    smoke: true,
    input: {
      message:
        "我要做一条 30 秒的产品宣传片，产品是一款 AI 笔记应用。请拆成 4 个镜头铺到画布：痛点引入（信息散落各处）、产品亮相、核心功能演示（语音转笔记）、结尾号召下载。",
    },
    expect: { createdShots: [4, 4], eachPromptMinLen: 30, kind: ["image", "video"], minChainEdges: null, category: "shots" },
  },
  {
    id: "sb-003",
    description: "明确 5 镜头·旅行 vlog",
    input: {
      message: "按这个行程拆 5 个镜头：清晨抵达京都车站、伏见稻荷千本鸟居、鸭川边吃午餐、清水寺黄昏、夜晚祇园街头。铺到画布上。",
    },
    expect: { createdShots: [5, 5], eachPromptMinLen: 30, kind: ["image", "video"], minChainEdges: null, category: "shots" },
  },
  {
    id: "sb-004",
    description: "未指定数量·由 AI 决定",
    smoke: true,
    input: { message: "把这个故事拆成分镜铺到画布：流浪猫在雨夜躲进便利店，店员收留了它，从此店里多了一只招财猫。" },
    expect: { createdShots: [3, 8], eachPromptMinLen: 30, kind: ["image", "video"], minChainEdges: null, category: "shots" },
  },
  {
    id: "sb-005",
    description: "长文案·完整产品 demo 脚本",
    input: {
      message:
        "下面是完整文案，请拆成合适数量的镜头铺到画布。「你是否还在三个应用之间来回切换记笔记？开会记录散在聊天框，灵感丢在备忘录，待办躺在邮件里。NotaFlow 把它们合而为一：说一句话，自动整理成结构化笔记；拍一张白板，自动提取行动项；每周一早上，自动生成本周计划。现在下载，前 30 天免费。」",
    },
    expect: { createdShots: [4, 10], eachPromptMinLen: 30, kind: ["image", "video"], minChainEdges: null, category: "shots" },
  },
  {
    id: "sb-006",
    description: "漫剧·对白场景",
    input: {
      message: "这是漫剧片段，拆成镜头铺到画布：天台上，少女把信递给少年；少年愣住，信纸被风吹走；两人同时伸手去抓，手碰到了一起；夕阳下两人对视脸红。",
    },
    expect: { createdShots: [3, 6], eachPromptMinLen: 30, kind: ["image", "video"], minChainEdges: null, category: "shots" },
  },
  {
    id: "sb-007",
    description: "美食制作·步骤型",
    input: { message: "做一条手冲咖啡教学短片，按步骤拆镜头铺到画布：磨豆、烧水、湿滤纸、注水闷蒸、绕圈冲煮、成品特写。" },
    expect: { createdShots: [4, 7], eachPromptMinLen: 30, kind: ["image", "video"], minChainEdges: null, category: "shots" },
  },
  {
    id: "sb-008",
    description: "明确『3 步』措辞(数量词不在『镜头』上)",
    input: { message: "这个产品用 3 步讲清楚：打开 app、扫码、完成支付。帮我变成画布上的分镜。" },
    expect: { createdShots: [3, 4], eachPromptMinLen: 30, kind: ["image", "video"], minChainEdges: null, category: "shots" },
  },
  {
    id: "sb-009",
    description: "情绪散文·弱结构输入",
    input: { message: "把这段散文变成分镜：深夜的城市像一台不肯关机的旧电脑，路灯是它的待机指示灯，晚归的人是还没保存的文档。" },
    expect: { createdShots: [2, 8], eachPromptMinLen: 30, kind: ["image", "video"], minChainEdges: null, category: "shots" },
  },
  {
    id: "sb-010",
    description: "明确 6 镜头·快节奏广告",
    input: { message: "拆 6 个快节奏广告镜头铺到画布：运动鞋特写、系鞋带、起跑、城市穿梭、跃过水洼慢镜、落地定格出 logo。" },
    expect: { createdShots: [6, 6], eachPromptMinLen: 30, kind: ["image", "video"], minChainEdges: null, category: "shots" },
  },
  {
    id: "sb-011",
    description: "极短单句输入",
    smoke: true,
    input: { message: "一颗种子长成大树。拆镜头铺到画布。" },
    expect: { createdShots: [2, 6], eachPromptMinLen: 30, kind: ["image", "video"], minChainEdges: null, category: "shots" },
  },
  {
    id: "sb-012",
    description: "数字干扰(文中有 10,要求 3)",
    input: { message: "店里有 10 种甜品，但宣传片只要 3 个镜头铺到画布：橱窗全景、招牌可丽饼制作、顾客第一口的表情。" },
    expect: { createdShots: [3, 3], eachPromptMinLen: 30, kind: ["image", "video"], minChainEdges: null, category: "shots" },
  },
  {
    id: "sb-013",
    description: "中英混合文案",
    input: { message: "为我们的 SaaS 产品 LaunchPad 拆 4 个镜头铺到画布：dashboard 总览、一键 deploy 演示、real-time 监控告警、客户 testimonial 收尾。" },
    expect: { createdShots: [4, 4], eachPromptMinLen: 30, kind: ["image", "video"], minChainEdges: null, category: "shots" },
  },
  {
    id: "sb-014",
    description: "明确要求按顺序连线",
    smoke: true,
    input: { message: "拆 3 个镜头铺到画布并按先后顺序连起来：日出、正午、日落。" },
    expect: { createdShots: [3, 3], eachPromptMinLen: 20, kind: ["image", "video"], minChainEdges: 2, category: "shots" },
  },
  {
    id: "sb-015",
    description: "明确要求不连线(指令遵循)",
    input: { message: "拆 3 个独立镜头铺到画布，镜头之间不要连线：森林、海洋、沙漠。" },
    expect: { createdShots: [3, 3], eachPromptMinLen: 20, kind: ["image", "video"], minChainEdges: null, maxChainEdges: 0, category: "shots" },
  },
];
