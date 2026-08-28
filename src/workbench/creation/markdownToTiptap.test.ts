import { describe, expect, it } from 'vitest'
import { markdownToTiptapContent } from './markdownToTiptap'

// AI 写回的关键路径：markdownToTiptapContent 把 markdown 转成 Tiptap JSON。
// 新增的表格/待办/高亮必须在这里有解析分支，否则 AI 生成的内容会丢格式（见 docs/设计理念/03）。
describe('markdownToTiptapContent', () => {
  it('解析 ==高亮==（无空格的中文场景）', () => {
    const nodes = markdownToTiptapContent('这是==重点==内容')
    expect(nodes).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '这是' },
          { type: 'text', text: '重点', marks: [{ type: 'highlight' }] },
          { type: 'text', text: '内容' },
        ],
      },
    ])
  })

  it('解析待办列表（- [ ] 与 - [x] 混合）', () => {
    const nodes = markdownToTiptapContent('- [ ] 第一项\n- [x] 第二项')
    expect(nodes).toEqual([
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一项' }] }] },
          { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第二项' }] }] },
        ],
      },
    ])
  })

  it('解析 GFM 表格（表头 + 分隔 + 数据行）', () => {
    const nodes = markdownToTiptapContent('| 镜头 | 类型 |\n| --- | --- |\n| 01 | 视频 |')
    expect(nodes).toEqual([
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '镜头' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '类型' }] }] },
            ],
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '01' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '视频' }] }] },
            ],
          },
        ],
      },
    ])
  })

  it('待办列表优先于普通无序列表', () => {
    const nodes = markdownToTiptapContent('- [ ] 任务\n- 普通项')
    // 第一行是 task，第二行是普通 bullet —— 应拆成两个列表
    expect(nodes[0].type).toBe('taskList')
    expect(nodes[1].type).toBe('bulletList')
  })

  it('非表格的 | 行回退为段落（第二行非分隔符）', () => {
    const nodes = markdownToTiptapContent('| 这不是表格 | 只是文字')
    expect(nodes[0].type).toBe('paragraph')
  })

  it('高亮与粗体混用时不互相干扰', () => {
    const nodes = markdownToTiptapContent('**粗**==亮==')
    const content = nodes[0].content as Array<{ type: string; text?: string; marks?: Array<{ type: string }> }>
    expect(content).toEqual([
      { type: 'text', text: '粗', marks: [{ type: 'bold' }] },
      { type: 'text', text: '亮', marks: [{ type: 'highlight' }] },
    ])
  })
})
