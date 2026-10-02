export const locales = ['zh-CN', 'en']

export const shared = Object.freeze({
  siteUrl: 'https://nomiaqm.com',
  repositoryUrl: 'https://github.com/aqm857886159/Nomi',
  releaseUrl: 'https://github.com/aqm857886159/Nomi/releases/latest',
  releaseNotesUrl: 'https://github.com/aqm857886159/Nomi/releases',
  businessUrl: 'https://github.com/aqm857886159/Nomi/issues/new?template=business_inquiry.yml',
  discussionUrl: 'https://github.com/aqm857886159/Nomi/discussions',
  bilibiliUrl: 'https://www.bilibili.com/video/BV1Lf8b6nEjf/',
  twitterUrl: 'https://x.com/sdf297417627618',
  licenseName: 'AGPL-3.0-only',
  licenseUrl: 'https://www.gnu.org/licenses/agpl-3.0.html',
  wechatId: 'TZ857886159',
  groupQr: '/assets/group-wechat-2026-10-09.jpg',
  authorQr: '/assets/qingyang-wechat.jpg',
  quickstartUrl: '/quickstart',
  handbookUrl: '/handbook',
  mcpGuideUrl: 'https://github.com/aqm857886159/Nomi/blob/main/docs/guide/capability-core-cli-mcp.md',
  // 0.22 宣传片：一个文件。首屏整片播放；功能段只循环播放它里面对应的那几秒（不另剪短版）。
  film: '/assets/video/nomi-0.22-film.mp4',
  filmPoster: '/assets/promo-0.22/cover-zh-light.jpg',
  filmPosterEn: '/assets/promo-0.22/cover-en-light.jpg',
})

/** 功能段：每段对应宣传片里的一段秒数（与片场 plan.ts 的镜头表一致）。id 与顺序两种语言必须相同。 */
const FEATURE_SEGMENTS = [
  { id: 'agent', start: 13, end: 22, still: '/assets/promo-0.22/still-agent.jpg' },
  { id: 'charge', start: 29, end: 35, still: '/assets/promo-0.22/still-charge.jpg' },
  { id: 'storyboard', start: 35, end: 44, still: '/assets/promo-0.22/still-storyboard.jpg' },
  { id: 'director', start: 44, end: 58, still: '/assets/promo-0.22/still-director.jpg' },
  { id: 'model', start: 58, end: 66, still: '/assets/promo-0.22/still-model.jpg' },
  { id: 'newmodel', start: 66, end: 75, still: '/assets/promo-0.22/still-newmodel.jpg' },
]
const segment = (id) => FEATURE_SEGMENTS.find((item) => item.id === id)

const zhCN = {
  path: '/',
  htmlLang: 'zh-CN',
  ogLocale: 'zh_CN',
  meta: {
    title: 'Nomi — 商业级体验，模型按原价',
    description: '开源、本地优先的 AI 视频工作台。Agent 替你拆镜头、出关键帧、做视频、排进时间轴；用的是你自己接的模型，按供应商原价付钱，连 Agent 也不订阅、不加价。',
    imageAlt: 'Nomi：对话出片，模型按原价',
  },
  nav: {
    ariaLabel: '主导航',
    features: '功能',
    quickstart: '快速上手',
    open: '开源',
    community: '社区',
    download: '下载',
    menu: '菜单',
    locale: 'EN',
    localeLabel: '切换到英文',
  },
  hero: {
    eyebrow: '开源 · 本地优先 · AI 视频工作台',
    titleLead: '商业级体验，',
    titleEmphasis: '模型按原价。',
    lede: 'Nomi 给你商业产品级别的 AI 视频工作流，底下跑的是你自己接的模型。钱直接付给供应商，上游什么价你就付什么价——连 Agent 用的也是你挑的模型。',
    download: '下载 Nomi',
    github: '在 GitHub 上看源码 ↗',
    meta: 'macOS · Windows · AGPL-3.0 · 不用注册',
    macNotice: 'macOS 安装包暂未签名或公证，首次打开可能被系统拦截。',
    macInstallHelp: '查看安全打开方法',
    windowTitle: 'Nomi 0.22 · 90 秒看懂',
    play: '播放宣传片（有声音）',
    posterAlt: 'Nomi 0.22 宣传片封面：对话出片，模型按原价',
  },
  price: {
    eyebrow: '为什么是 Nomi',
    title: '同一个模型，别多付几倍。',
    description: '中转站、官方 API、ComfyUI、本地模型，本身都很便宜。商业 AI 视频产品用的往往是同一批模型，价钱却常常翻几倍。',
    barCommercial: '商业产品',
    barYours: '中转站 · 官方 API · ComfyUI · 本地模型',
    barsLabel: '示意图：商业产品的价格条远长于直接用模型的价格条',
    note: '示意，不是具体报价：各家价格一直在变，Nomi 不替你算价，也不经手你的钱。',
    facts: [
      { title: '接哪家都行', description: 'APIMart、Kie.ai、火山方舟、魔搭社区、即梦会员、任意 OpenAI 兼容的中转站，或者你本地的 ComfyUI。' },
      { title: '钱不经过 Nomi', description: '用你自己的 Key，直接按供应商的价付。Nomi 不代理、不转售任何模型调用。' },
      { title: 'Agent 也按原价', description: '帮你干活的 Agent，用的也是你接的模型——包括免费的。不订阅，不加价。' },
    ],
  },
  features: {
    eyebrow: '0.22 能做什么',
    title: '从一句话，到排好的时间轴。',
    items: [
      { ...segment('agent'), kicker: 'Agent', title: '说一句，它就开始干活', description: '说说你想拍什么。Agent 会看你的画布、把故事拆成镜头、出关键帧、做成视频、排进时间轴。它做的每样东西都落在画布上，看得见，也随时能改。', nodeTitle: 'Agent · 一句话出四个镜头', stillAlt: 'Nomi 的 Agent 把一句需求变成画布上的四张关键帧' },
      { ...segment('charge'), kicker: '你说了算', title: '每一步问不问你，你来定', description: '三档：每步问、自动改（花钱的生成仍然先问）、全自动。切到全自动要你亲手确认一次；不可逆的操作永远先问。', nodeTitle: 'Agent · 自主程度', stillAlt: 'Agent 面板里切到全自动前的确认卡' },
      { ...segment('storyboard'), kicker: '分镜表', title: '一镜一镜，由你导演', description: '一镜一行：提示词、首帧、模型、时长，一眼看全。给角色或场景锁一张参考卡，用到它的镜头都还是同一张脸。', nodeTitle: '分镜表 · 黄雨衣女孩的海边一天', stillAlt: '分镜表里四个镜头都已出片，角色参考卡已锁定' },
      { ...segment('director'), kicker: '3D 导演台', title: '拿起手机，就是取景器', description: '摆好人物姿势、定好机位，用手机取景。拍到的画面直接回到画布上，接着拿去做视频。', nodeTitle: '导演台 · 街角咖啡馆', stillAlt: '3D 导演台和手机取景页' },
      { ...segment('model'), kicker: '换模型', title: '哪家模型都能用，一镜一换', description: '同一个镜头，Seedance、可灵、Wan、海螺随手换一版。模型下拉里直接看得到每个模型在哪几家能用。', nodeTitle: '空镜 · 清晨渔港', stillAlt: '同一张视频卡换成可灵 3.0 再拍一版' },
      { ...segment('newmodel'), kicker: '新模型', title: '新模型，当天就能用', description: '点「用 AI 帮我接入」，让 Claude Code 或 Codex 替你接：地址、参数、模型 ID 它去查；Key 你在 Nomi 自己的页面里贴，助手看不到；真跑一次验证，通过了才上列表。', nodeTitle: '设置 · 模型', stillAlt: '「用 AI 帮我接入」卡片，五步都已完成' },
    ],
  },
  open: {
    eyebrow: '东西都是你的',
    title: '一个项目，就是你硬盘上的一个文件夹。',
    treeLabel: '一个 Nomi 项目的文件夹结构',
    tree: [
      { path: '海边小镇/', note: '' },
      { path: '├─ .nomi/project.json', note: '画布、分镜、时间轴' },
      { path: '├─ assets/generated/', note: '每一张图、每一段视频' },
      { path: '└─ exports/海边小镇.mp4', note: '成片' },
    ],
    points: [
      '不用注册账号，不上报数据。',
      '调用外部模型时，只把完成这一次生成必需的内容发给你配置的那家。',
      '代码全部开源（AGPL-3.0），想改成什么样都行，也可以让你的 AI 编程助手来改。',
    ],
    github: '查看 GitHub',
    license: '查看许可证',
  },
  community: {
    eyebrow: '下一步',
    title: 'AI 剪辑。然后是一站式的内容创作 AI 工作台。',
    description: 'Nomi 是一个人起头的开源项目，更新很快。遇到问题直接说，大家都会碰到的会并进主线；想一起做，欢迎来。',
    discussion: '讨论区',
    bilibili: 'B 站',
    groupAlt: 'Nomi 用户群微信二维码',
    groupCaption: '扫码进用户群',
    authorAlt: 'Nomi 维护者微信二维码',
    authorCaption: '群码过期加维护者 TZ857886159',
    teamsTitle: '团队要把 Nomi 放进真实生产流程？',
    teamsDescription: '定制开发、系统集成、AGPL 合规部署、长期迭代。',
    wechat: '添加维护者微信',
    submit: '提交项目需求',
  },
  footer: {
    license: 'AGPL-3.0 开源',
    releases: '更新说明',
    made: '宣传片里的界面都是 Nomi 的真实组件，画面素材都由 Nomi 生成。',
    locale: 'English',
  },
  quickstart: {
    path: '/quickstart',
    meta: {
      title: 'Nomi 快速上手：从下载到第一个镜头',
      description: '四步上手 Nomi：下载安装、接一个模型、跟 Agent 说你想拍什么、挑片排片导出。附常见问题：要花多少钱、要不要显卡、素材会不会上传。',
      imageAlt: 'Nomi 快速上手',
    },
    eyebrow: '快速上手',
    titleLead: '从下载，',
    titleEmphasis: '到第一个镜头。',
    lede: '四步。唯一要准备的是一个模型供应商的 Key——没有的话，第二步告诉你去哪拿。',
    steps: [
      { id: 'install', label: '下载安装', title: '下载对应你电脑的安装包', description: '安装包暂时没有做签名，第一次打开系统会拦一下，照下面做就行。' },
      { id: 'connect', label: '接模型', title: '接一个模型，贴一个 Key', description: '打开「设置 → 模型」，选 APIMart 或 Kie.ai，贴上在它们官网拿到的 Key，常用的图片、视频、对话模型就都能用了。也可以接你自己的中转站或本地 ComfyUI；不想自己弄，点「用 AI 帮我接入」交给 Claude Code 或 Codex。', image: '/assets/promo-0.22/still-newmodel.jpg', imageAlt: '设置里的「用 AI 帮我接入」卡片' },
      { id: 'ask', label: '跟 Agent 说', title: '说你想拍什么', description: '新建项目，在右边的 Agent 面板里用大白话说：拍什么、几个镜头、大概多长。建议先用默认的「自动改」档：它改文稿和时间轴不打扰你，要花钱生成时先让你确认。', image: '/assets/promo-0.22/still-agent.jpg', imageAlt: 'Agent 在画布上出了四张关键帧' },
      { id: 'export', label: '挑片导出', title: '挑满意的版本，排好，导出', description: '不满意的镜头在分镜表里改提示词、换模型、再生成一版；角色要统一就锁一张参考卡。排好时间轴，导出 MP4。', image: '/assets/promo-0.22/still-storyboard.jpg', imageAlt: '分镜表里四个镜头都已出片' },
    ],
    installTip: 'macOS：在「应用程序」里右键 Nomi →「打开」。Windows：提示风险时点「更多信息 → 仍要运行」。',
    faqTitle: '常见问题',
    faq: [
      { question: '要花多少钱？', answer: 'Nomi 本身免费。生成的费用按你接的那家供应商的价格，直接由你和它结算；接免费模型（比如魔搭社区的部分模型）或本地 ComfyUI 就不花钱。' },
      { question: '没有独立显卡能用吗？', answer: '能。默认走云端 API，普通笔记本就够。本地 ComfyUI 是可选的，想省钱、有显卡再接。' },
      { question: '我的素材会被上传吗？', answer: '项目都存在你自己的电脑上。只有在调用外部模型时，才把完成这一次生成必需的内容发给你配置的那家供应商。' },
      { question: 'Agent 能直接给我出成片吗？', answer: '它能从一句话做到人物、关键帧、视频，再排进时间轴；最后一步导出目前要你自己点一下。长任务中途它可能会停下来确认，回一句「继续」就行。' },
    ],
    more: '想看更细的操作说明',
    handbook: '一页上手手册',
    mcpGuide: 'MCP 指南',
  },
  download: {
    title: '选择适合这台电脑的版本',
    description: '能识别系统时会直接下载；无法可靠判断 Mac 芯片时，请选择对应安装包。',
    windows: 'Windows x64',
    windowsHint: 'Windows 10 / 11 · .exe 安装包',
    macArm: 'Mac Apple 芯片',
    macArmHint: 'macOS 12+ · M1 / M2 / M3 / M4 · .dmg 安装包',
    macIntel: 'Mac Intel 芯片',
    macIntelHint: 'macOS 12+ · Intel 处理器 · .dmg 安装包',
    macGuideTitle: 'macOS 第一次打开',
    macGuideSummary: '当前 macOS 安装包未使用 Apple Developer ID 签名，也未经过 Apple 公证。请只使用本页或 Nomi GitHub 官方仓库的下载链接。',
    macSteps: [
      '下载对应的 DMG，把 Nomi 拖到“应用程序”。',
      '在 Finder 的“应用程序”中右键 Nomi，选择“打开”，再确认“打开”。',
      '如果仍被拦截，打开“系统设置” → “隐私与安全”，找到 Nomi 后点击“仍要打开”。',
    ],
    macDamaged: '仅当 macOS 提示 Nomi“已损坏”时：先确认安装包来自上述官方链接，再打开“终端”运行：',
    macCommand: 'xattr -dr com.apple.quarantine "/Applications/Nomi.app"',
    macSafety: '不需要、也不要全局关闭 Gatekeeper。',
  },
  a11y: {
    skip: '跳到主要内容',
    close: '关闭',
    authorTitle: '添加维护者微信',
    authorCopy: '微信号：TZ857886159。请简单说明项目、当前流程和最想解决的问题。',
  },
}

const english = {
  path: '/en/',
  htmlLang: 'en',
  ogLocale: 'en_US',
  meta: {
    title: 'Nomi — Pro-grade AI video. Models at their real price.',
    description: 'Open-source, local-first AI video studio. The agent splits your story into shots, generates keyframes and video, and lays them on the timeline — on the models you connect, at your provider’s price. No subscription, no markup.',
    imageAlt: 'Nomi: pro-grade AI video, models at their real price',
  },
  nav: {
    ariaLabel: 'Primary navigation',
    features: 'Features',
    quickstart: 'Quick start',
    open: 'Open source',
    community: 'Community',
    download: 'Download',
    menu: 'Menu',
    locale: '中文',
    localeLabel: 'Switch to Chinese',
  },
  hero: {
    eyebrow: 'Open source · Local-first · AI video studio',
    titleLead: 'Pro-grade AI video.',
    titleEmphasis: 'Models at their real price.',
    lede: 'Nomi gives you a pro-grade AI video workflow on top of the models you connect. You pay your provider directly, at their price — even the agent runs on the model you pick.',
    download: 'Download Nomi',
    github: 'Read the source on GitHub ↗',
    meta: 'macOS · Windows · AGPL-3.0 · No account',
    macNotice: 'The macOS build is not yet signed or notarized, so macOS may block the first launch.',
    macInstallHelp: 'View safe opening steps',
    windowTitle: 'Nomi 0.22 · in 90 seconds',
    play: 'Play the film (with sound)',
    posterAlt: 'Nomi 0.22 film poster: pro-grade AI video, models at their real price',
  },
  price: {
    eyebrow: 'Why Nomi',
    title: 'Same model. Stop paying several times over.',
    description: 'Relays, official APIs, ComfyUI, and local models are cheap. Commercial AI video products often run the very same models and charge several times more.',
    barCommercial: 'Commercial products',
    barYours: 'Relays · Official APIs · ComfyUI · Local models',
    barsLabel: 'Illustration: the commercial-product price bar is far longer than the direct-model price bar',
    note: 'Illustrative, not a quote: prices keep changing, and Nomi neither prices nor handles your money.',
    facts: [
      { title: 'Connect anyone', description: 'APIMart, Kie.ai, Volcengine, ModelScope, a Dreamina membership, any OpenAI-compatible relay, or your local ComfyUI.' },
      { title: 'Your money skips Nomi', description: 'Use your own keys and pay providers at their price. Nomi never proxies or resells inference.' },
      { title: 'The agent, at cost too', description: 'The agent that does the work runs on the model you connect — free ones included. No subscription, no markup.' },
    ],
  },
  features: {
    eyebrow: 'What 0.22 does',
    title: 'From one sentence to a finished timeline.',
    items: [
      { ...segment('agent'), kicker: 'Agent', title: 'Just ask — it gets to work', description: 'Describe the film you want. The agent reads your canvas, splits the story into shots, generates keyframes, turns them into video, and arranges the timeline. Everything lands on the canvas, where you can see it and change it.', nodeTitle: 'Agent · four shots from one request', stillAlt: 'The Nomi agent turning one request into four keyframes on the canvas' },
      { ...segment('charge'), kicker: 'You stay in charge', title: 'You decide how much it asks', description: 'Three levels: Ask each step, Auto-edit (paid generation still asks), and Full auto. Switching to Full auto takes your explicit confirmation, and irreversible actions are always confirmed.', nodeTitle: 'Agent · autonomy', stillAlt: 'The confirmation card shown before switching the agent to Full auto' },
      { ...segment('storyboard'), kicker: 'Storyboard', title: 'Direct every shot', description: 'One row per shot — prompt, first frame, model, duration. Lock a reference card for a character or place, and every shot that uses it keeps the same face.', nodeTitle: 'Storyboard · a day by the sea', stillAlt: 'The storyboard with all four shots generated and the character reference locked' },
      { ...segment('director'), kicker: '3D director', title: 'Your phone is the viewfinder', description: 'Pose characters, place cameras, and frame the shot with your phone. The captures go straight back onto the canvas, ready to become video.', nodeTitle: 'Director · corner café', stillAlt: 'The 3D director with the phone viewfinder page' },
      { ...segment('model'), kicker: 'Any model', title: 'Any model, swapped per shot', description: 'Take the same shot again with Seedance, Kling, Wan, or Hailuo. The model picker shows which providers offer each model.', nodeTitle: 'Establishing shot · harbor at dawn', stillAlt: 'The same video card generated again with Kling 3.0' },
      { ...segment('newmodel'), kicker: 'New models', title: 'New model today, in Nomi today', description: 'Click “Let AI connect it for me” and let Claude Code or Codex wire it in: it looks up the endpoint, parameters and model IDs, you paste your key on Nomi’s own page (the assistant never sees it), and it runs one real test before the model is listed.', nodeTitle: 'Settings · Models', stillAlt: 'The “Let AI connect it for me” card with all five steps done' },
    ],
  },
  open: {
    eyebrow: 'Yours',
    title: 'A project is a plain folder on your disk.',
    treeLabel: 'Folder structure of a Nomi project',
    tree: [
      { path: 'seaside-town/', note: '' },
      { path: '├─ .nomi/project.json', note: 'canvas, storyboard, timeline' },
      { path: '├─ assets/generated/', note: 'every image and clip' },
      { path: '└─ exports/seaside-town.mp4', note: 'the film' },
    ],
    points: [
      'No account. No telemetry.',
      'When you call an external model, only what that generation needs goes to the provider you configured.',
      'Fully open source (AGPL-3.0). Change anything — or have your AI coding assistant do it.',
    ],
    github: 'View on GitHub',
    license: 'Read the license',
  },
  community: {
    eyebrow: 'Next',
    title: 'AI editing. Then one studio for everything you make with AI.',
    description: 'Nomi is an open-source project started by one person, and it moves fast. Tell us what breaks — anything everyone runs into goes into the mainline. Want to build it with us? Come on in.',
    discussion: 'Discussions',
    bilibili: 'Bilibili',
    groupAlt: 'WeChat QR code for the Nomi user group',
    groupCaption: 'WeChat user group',
    authorAlt: 'WeChat QR code for the Nomi maintainer',
    authorCaption: 'Group code expired? Add TZ857886159',
    teamsTitle: 'Putting Nomi into a real production workflow?',
    teamsDescription: 'Custom builds, integrations, AGPL-compliant deployment, and ongoing iteration.',
    wechat: 'Maintainer WeChat',
    submit: 'Submit a project brief',
  },
  footer: {
    license: 'Open source · AGPL-3.0',
    releases: 'Release notes',
    made: 'Every screen in the film is Nomi’s real UI; every image and clip was generated with Nomi.',
    locale: '简体中文',
  },
  quickstart: {
    path: '/en/quickstart',
    meta: {
      title: 'Nomi quick start: from download to your first shot',
      description: 'Get started with Nomi in four steps: install, connect a model, tell the agent what you want to make, then keep the good takes and export. Plus: cost, GPU, and privacy FAQ.',
      imageAlt: 'Nomi quick start',
    },
    eyebrow: 'Quick start',
    titleLead: 'From download',
    titleEmphasis: 'to your first shot.',
    lede: 'Four steps. The only thing to prepare is one provider key — step two tells you where to get it.',
    steps: [
      { id: 'install', label: 'Install', title: 'Download the build for your computer', description: 'The installers are not code-signed yet, so the first launch gets a warning. Here’s how to get past it.' },
      { id: 'connect', label: 'Connect', title: 'Connect a model with one key', description: 'Open Settings → Models, pick APIMart or Kie.ai, and paste the key from their site — the common image, video and chat models are ready. You can also add your own relay or local ComfyUI, or click “Let AI connect it for me” and hand it to Claude Code or Codex.', image: '/assets/promo-0.22/still-newmodel.jpg', imageAlt: 'The “Let AI connect it for me” card in settings' },
      { id: 'ask', label: 'Ask', title: 'Say what you want to make', description: 'Create a project and tell the agent panel on the right, in plain words: what, how many shots, roughly how long. Start with the default Auto-edit level — it edits documents and the timeline without bothering you, and asks before any paid generation.', image: '/assets/promo-0.22/still-agent.jpg', imageAlt: 'The agent put four keyframes on the canvas' },
      { id: 'export', label: 'Export', title: 'Keep the good takes, arrange, export', description: 'For a shot you don’t like, change the prompt or the model in the storyboard and generate again; lock a reference card to keep a character consistent. Arrange the timeline and export MP4.', image: '/assets/promo-0.22/still-storyboard.jpg', imageAlt: 'All four shots generated in the storyboard' },
    ],
    installTip: 'macOS: right-click Nomi in Applications → Open. Windows: on the SmartScreen prompt choose More info → Run anyway.',
    faqTitle: 'FAQ',
    faq: [
      { question: 'How much does it cost?', answer: 'Nomi itself is free. Generation costs whatever your provider charges, settled directly between you and them. Free models (some on ModelScope, for example) and local ComfyUI cost nothing.' },
      { question: 'Do I need a GPU?', answer: 'No. By default Nomi uses cloud APIs, so an ordinary laptop is enough. Local ComfyUI is optional — add it if you have a GPU and want to save money.' },
      { question: 'Is my footage uploaded?', answer: 'Projects live on your own computer. Only when you call an external model does the content that generation needs go to the provider you configured.' },
      { question: 'Can the agent hand me a finished film?', answer: 'It can go from one sentence to characters, keyframes and video, and lay them on the timeline. Export is still one click by you. On long tasks it may pause to check in — reply “continue”.' },
    ],
    more: 'Want the detailed walkthrough?',
    handbook: 'Chinese handbook',
    mcpGuide: 'MCP guide',
  },
  download: {
    title: 'Choose the version for this computer',
    description: 'Nomi downloads directly when the platform is known. If the Mac chip cannot be detected reliably, choose the matching installer.',
    windows: 'Windows x64',
    windowsHint: 'Windows 10 / 11 · .exe installer',
    macArm: 'Mac with Apple silicon',
    macArmHint: 'macOS 12+ · M1 / M2 / M3 / M4 · .dmg installer',
    macIntel: 'Mac with Intel',
    macIntelHint: 'macOS 12+ · Intel processor · .dmg installer',
    macGuideTitle: 'First launch on macOS',
    macGuideSummary: 'The current macOS build is not Apple Developer ID signed or notarized. Only use download links on this site or in the official Nomi GitHub repository.',
    macSteps: [
      'Download the matching DMG and drag Nomi to Applications.',
      'In Finder, right-click Nomi in Applications, choose Open, then confirm Open.',
      'If it is still blocked, open System Settings → Privacy & Security, find Nomi, and click Open Anyway.',
    ],
    macDamaged: 'Only if macOS says Nomi is “damaged”: confirm the installer came from an official link above, then open Terminal and run:',
    macCommand: 'xattr -dr com.apple.quarantine "/Applications/Nomi.app"',
    macSafety: 'You do not need to disable Gatekeeper globally, and should not do so.',
  },
  a11y: {
    skip: 'Skip to main content',
    close: 'Close',
    authorTitle: 'Maintainer WeChat',
    authorCopy: 'WeChat ID: TZ857886159. Include a short description of the project, your current workflow, and what you most want to solve.',
  },
}

export const contentByLocale = Object.freeze({ 'zh-CN': zhCN, en: english })

function compareParity(left, right, path = '') {
  const location = path || 'root'
  if (typeof left === 'number' || typeof right === 'number') {
    if (left !== right) throw new Error(`Locale parity error at ${location}`)
    return
  }
  if (typeof left === 'string' || typeof right === 'string') {
    // 空字符串只允许两边同时为空（文件夹树的根那一行没有说明）。
    if (typeof left !== 'string' || typeof right !== 'string' || Boolean(left.trim()) !== Boolean(right.trim())) {
      throw new Error(`Locale parity error at ${location}`)
    }
    return
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      throw new Error(`Locale parity error at ${location}`)
    }
    left.forEach((item, index) => compareParity(item, right[index], `${path}[${index}]`))
    return
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
    if (left !== right) throw new Error(`Locale parity error at ${location}`)
    return
  }
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  if (leftKeys.join('\0') !== rightKeys.join('\0')) throw new Error(`Locale parity error at ${location}`)
  for (const key of leftKeys) compareParity(left[key], right[key], path ? `${path}.${key}` : key)
}

export function assertLocaleParity() {
  compareParity(zhCN, english)
  const featureIds = zhCN.features.items.map(({ id }) => id)
  if (featureIds.join('\0') !== FEATURE_SEGMENTS.map(({ id }) => id).join('\0')) {
    throw new Error('Locale parity error at features.items')
  }
  const stepIds = zhCN.quickstart.steps.map(({ id }) => id)
  if (stepIds.join('\0') !== ['install', 'connect', 'ask', 'export'].join('\0')) {
    throw new Error('Locale parity error at quickstart.steps')
  }
}
