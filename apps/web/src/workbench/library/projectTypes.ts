export type Project = {
  id: string
  name: string
  updatedAt: string        // human-readable: "3 天前"
  thumbStyle?: string      // CSS background for card thumbnail
}

/** Mock data — replace with real store/API later */
export const MOCK_PROJECTS: Project[] = [
  { id: 'p1', name: '灯塔海岸宣传片',   updatedAt: '3 天前',  thumbStyle: 'linear-gradient(135deg, oklch(0.85 0.05 230), oklch(0.78 0.08 200))' },
  { id: 'p2', name: '产品发布 2025 Q1', updatedAt: '1 周前',  thumbStyle: 'linear-gradient(135deg, oklch(0.92 0.04 50),  oklch(0.85 0.07 40))'  },
  { id: 'p3', name: '夏日海边 Vlog',    updatedAt: '2 周前',  thumbStyle: undefined },
  { id: 'p4', name: '自然纪录片开场',   updatedAt: '3 周前',  thumbStyle: 'linear-gradient(135deg, oklch(0.88 0.05 150), oklch(0.80 0.08 160))' },
  { id: 'p5', name: 'UI 动效演示集',    updatedAt: '1 个月前', thumbStyle: 'linear-gradient(135deg, oklch(0.90 0.04 300), oklch(0.82 0.07 290))' },
  { id: 'p6', name: '城市街头纪录',     updatedAt: '1 个月前', thumbStyle: 'linear-gradient(135deg, oklch(0.90 0.03 20),  oklch(0.84 0.05 10))'  },
]

export const RECENT_PROJECT_IDS = ['p1', 'p2', 'p3']
