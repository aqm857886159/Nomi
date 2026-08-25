// DesignAlert —— 内联提示条（Mantine Alert 的 Nomi 封装，radius 默认 sm、variant 默认 light）。
// 用于**留在页面上**的说明/警告（区别于一闪而过的 toast）。
// D4「诚实交付」：能力缺口要明着标出来，别藏——这个组件就是标缺口的地方。
// 仓库内目前尚无调用点，这里按 Nomi 真实需要的场景组合。
import { IconAlertTriangle, IconInfoCircle, IconCircleCheck, IconExclamationCircle } from '@tabler/icons-react'
import { DesignAlert } from 'nomi'

/** 主变体轴：四种语义色。 */
export const Tones = (): JSX.Element => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 460 }}>
    <DesignAlert color="blue" icon={<IconInfoCircle size={16} />} title="本地模型已就绪">
      ComfyUI 已连上，这些镜头不消耗额度。
    </DesignAlert>
    <DesignAlert color="green" icon={<IconCircleCheck size={16} />} title="6 个镜头都生成完了">
      可以去时间轴预览，或者直接导出 MP4。
    </DesignAlert>
    <DesignAlert color="yellow" icon={<IconAlertTriangle size={16} />} title="唇形同步 Nomi 暂时做不了">
      这段会按普通视频生成，说话口型不会对上台词。
    </DesignAlert>
    <DesignAlert color="red" icon={<IconExclamationCircle size={16} />} title="第 4 镜生成失败">
      供应商返回「内容审核未通过」。改一下提示词再试，或者换个模型。
    </DesignAlert>
  </div>
)

/** variant 轴：light（默认）/ filled / outline。 */
export const Variants = (): JSX.Element => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 460 }}>
    <DesignAlert variant="light" color="yellow" title="额度只剩 ¥3.20">
      按当前设置，还能再生成大约 11 张图。
    </DesignAlert>
    <DesignAlert variant="filled" color="yellow" title="额度只剩 ¥3.20">
      按当前设置，还能再生成大约 11 张图。
    </DesignAlert>
    <DesignAlert variant="outline" color="yellow" title="额度只剩 ¥3.20">
      按当前设置，还能再生成大约 11 张图。
    </DesignAlert>
  </div>
)

/** withCloseButton：用户可以关掉的提示；以及只有标题没有正文的紧凑形态。 */
export const Compact = (): JSX.Element => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 460 }}>
    <DesignAlert
      color="blue"
      icon={<IconInfoCircle size={16} />}
      title="已经自动保存到本地"
      withCloseButton
    />
    <DesignAlert color="gray" icon={<IconInfoCircle size={16} />}>
      没有标题的纯说明：Nomi 的项目文件都在「文稿 / Nomi Projects」里。
    </DesignAlert>
  </div>
)
