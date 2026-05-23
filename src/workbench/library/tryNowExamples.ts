import type { WorkbenchDocument } from '../workbenchTypes'

export type TryNowExample = {
  id: 'manga' | 'product-demo' | 'travel-vlog'
  emoji: string
  label: string
  subtitle: string
  projectName: string
  story: string
}

/**
 * Three preset stories that the project library hero uses to walk new
 * users through the Story → Storyboard demo end-to-end. Each story is
 * intentionally short (~150-250 字) so the storyboard planner can return
 * a 6-12 节点 plan quickly and the user sees the whole flow in under a
 * minute.
 */
export const TRY_NOW_EXAMPLES: TryNowExample[] = [
  {
    id: 'manga',
    emoji: '🎭',
    label: '漫剧示例',
    subtitle: '二次元短剧 · 校园天台',
    projectName: '示例：天台上的告白',
    story: [
      '放学后的天台。夕阳把整座教学楼镀成橘金色，风把白色窗帘吹得鼓起。',
      '林夏抱着一摞试卷站在天台门口，看见顾辰背对着她，正撑在栏杆上望远方。',
      '她深吸一口气走过去：「学长，这次月考……我超过你了。」',
      '顾辰转过头，露出一个意外又骄傲的笑。「那你之前说要拿第一就跟我告白，记得吗？」',
      '林夏的脸瞬间红到耳根。风掠过两个人之间，把她手里的卷子吹得四散。',
      '她小声说：「记得。」',
      '夕阳落在两个少年人之间，定格成一帧少女漫的封面。',
    ].join('\n\n'),
  },
  {
    id: 'product-demo',
    emoji: '🚀',
    label: '产品 demo 示例',
    subtitle: 'SaaS 30 秒介绍 · AI 协作工具',
    projectName: '示例：30 秒产品介绍',
    story: [
      '镜头一：一个团队负责人深夜加班，对着满屏的文档和聊天窗口皱眉。屏幕的蓝光打在她疲惫的脸上。',
      '镜头二：她打开我们的产品 LumenFlow，输入一句话："帮我把这周所有客户反馈整理成下周路线图。"',
      '镜头三：界面上 AI 自动抓取来自 Slack、Notion、邮件的散落信息，可视化地汇集成一份结构化报告。',
      '镜头四：早晨九点，团队成员陆续打开同一份报告，每个人都看到了清晰的优先级和分工。',
      '镜头五：负责人在咖啡馆轻松地喝着拿铁，手机推送显示：今天的会议比预定时间早结束 45 分钟。',
      '收尾：产品 logo 出现在屏幕中央，下方一行字：LumenFlow — 让团队像一个人一样思考。',
    ].join('\n\n'),
  },
  {
    id: 'travel-vlog',
    emoji: '🎒',
    label: '短视频示例',
    subtitle: 'Vlog 风格 · 京都一日',
    projectName: '示例：京都一日 vlog',
    story: [
      '清晨六点，京都还在睡。我提着相机从青旅出门，街道上只有送报纸的自行车。',
      '第一站是伏见稻荷。还没到旅行团到来的时间，千本鸟居里只有我一个人，阳光从鸟居缝隙漏下来，洒成一地金色的格子。',
      '中午在锦市场吃了一串现烤的鳗鱼，老板用京都腔说着「ありがとうね」。',
      '下午沿着哲学之道走，樱花已经落了大半，但溪流里漂着粉色的花瓣，比盛开时更安静。',
      '傍晚去了八坂神社旁边的小山。爬到顶上时，整座京都正好在脚下慢慢被夕阳染红。',
      '回到青旅那一刻，我打开相机预览，发现今天拍了三百多张照片。但最想分享的，只有一句话：',
      '"京都最美的时刻，永远在游客醒来之前。"',
    ].join('\n\n'),
  },
]

/**
 * Convert a plain story (paragraphs separated by blank lines) into a
 * tiptap-compatible workbench document. Each paragraph becomes a
 * `paragraph` node with a single `text` child, which is the shape the
 * normalizer in `workbenchTypes` understands.
 */
export function buildStoryDocument(story: string, title = ''): WorkbenchDocument {
  const paragraphs = story
    .split(/\n{2,}/g)
    .map((line) => line.trim())
    .filter(Boolean)
  return {
    version: 1,
    title,
    contentJson: {
      type: 'doc',
      content: paragraphs.length === 0
        ? [{ type: 'paragraph' }]
        : paragraphs.map((text) => ({
            type: 'paragraph',
            content: [{ type: 'text', text }],
          })),
    },
    updatedAt: Date.now(),
  }
}
