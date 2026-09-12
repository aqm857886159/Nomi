// R30 的话术集：**先写用户会怎么说，再跑模型**（2026-09-09 用户定的顺序）。
//
// 这 22 句不是按界面面排出来的 case，是按「一个人想让 Nomi 出一张/一段东西时会怎么开口」写的：
// 有直说的、有含糊的、有带参数的、有带情绪的、有先问后要的、有一次要好几张的、
// 有用错词的（把图说成「照片」「海报」）、有只给场景不给任何技术词的。
// 模型面对它们要做的事只有一件：**建一份草稿**（`nomi_generation_plan`），
// 把「这笔钱花不花」留给面板上那张卡——它自己够不着钱（paidBoundary）。
//
// 判据（两个数都按首次调用算，重试不冲淡首错）：
//   · **工具写对率** = 首次 `nomi_generation_plan` 调用通过运行时校验且真的落成一份待确认草稿 / 有效样本
//   · **回合成功率** = 这一回合最终停在「面板上出现了一张带真实价格的付费卡 + 模型说了句话」/ 有效样本
//
// `expectsDraft:false` 的那几句是**阴性对照**：它们根本不是要生成，模型不该建草稿。
// 没有阴性对照的绿灯不作数（一个「永远建草稿」的模型会在全阳性集上拿满分）。
export const SPEND_R30_CASES = Object.freeze([
  { id: 'c01', text: '帮我生成一张六棱柱的图。', expectsDraft: true },
  { id: 'c02', text: '来张封面图吧，横的，要有点科技感。', expectsDraft: true },
  { id: 'c03', text: '我想要一张照片，夕阳下的海边栈桥，安静一点的感觉', expectsDraft: true },
  { id: 'c04', text: '做个海报：深蓝背景，中间一个发光的立方体', expectsDraft: true },
  { id: 'c05', text: '画一只戴眼镜的柴犬，卡通风', expectsDraft: true },
  { id: 'c06', text: '生成图片：城市夜景，雨后，霓虹反光', expectsDraft: true },
  { id: 'c07', text: '我需要一张产品图，白底，一个陶瓷杯子', expectsDraft: true },
  { id: 'c08', text: '搞张图，随便什么，测试一下能不能用', expectsDraft: true },
  { id: 'c09', text: '能不能出一张 1536x1024 的横图？内容是雪山日出', expectsDraft: true },
  { id: 'c10', text: '给我来张图，主题是"孤独"，抽象一点', expectsDraft: true },
  { id: 'c11', text: '我想看看一个未来感的地铁站长什么样，出张图', expectsDraft: true },
  { id: 'c12', text: '先别管风格，随便生成一张森林小屋', expectsDraft: true },
  { id: 'c13', text: '帮我出图：一只纸飞机飞过写字楼玻璃幕墙', expectsDraft: true },
  { id: 'c14', text: '来一张，赛博朋克的那种巷子，有蒸汽', expectsDraft: true },
  { id: 'c15', text: '做一张宣传图，标题位置留白，背景是麦田', expectsDraft: true },
  { id: 'c16', text: '我要一张图当壁纸，极简，一条地平线就行', expectsDraft: true },
  { id: 'c17', text: '生成一张：老式打字机放在木桌上，侧光', expectsDraft: true },
  { id: 'c18', text: '出个图看看效果，宇航员在便利店买泡面', expectsDraft: true },
  { id: 'c19', text: '帮我画个图标感觉的东西：一颗发芽的种子', expectsDraft: true },
  { id: 'c20', text: '我想要张图，感觉像下午三点的教室', expectsDraft: true },
  // 阴性对照：这两句不该触发任何草稿。
  { id: 'n01', text: '生成一张图大概要花多少钱？先别做。', expectsDraft: false },
  { id: 'n02', text: '你都能生成什么类型的东西？只回答，不要动手。', expectsDraft: false },
])
