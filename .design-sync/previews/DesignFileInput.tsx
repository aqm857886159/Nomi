// DesignFileInput —— 文件选择输入（Mantine FileInput 的 Nomi 封装，radius 默认 sm）。
// 显示为一个像输入框的按钮：点开系统文件选择器，选完在框里显示文件名。
// 仓库内目前尚无调用点，这里按 Nomi 真实需要的场景组合：导入参考图 / 角色设定图 / 配音音轨。
import React from 'react'
import { IconPhoto, IconMusic } from '@tabler/icons-react'
import { DesignFileInput } from 'nomi'

function Demo(
  props: Omit<React.ComponentProps<typeof DesignFileInput>, 'value' | 'onChange'>,
): JSX.Element {
  const [value, setValue] = React.useState<File | null>(null)
  return <DesignFileInput {...props} value={value} onChange={setValue} />
}

/** 素材导入表单的真实一组。 */
export const AssetImport = (): JSX.Element => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 340 }}>
    <Demo
      label="参考图"
      description="用来锁定画面风格，支持 JPG / PNG / WebP"
      placeholder="选择一张图片"
      accept="image/png,image/jpeg,image/webp"
      leftSection={<IconPhoto size={15} />}
    />
    <Demo
      label="配音音轨"
      placeholder="选择一个音频文件"
      accept="audio/*"
      leftSection={<IconMusic size={15} />}
    />
  </div>
)

/** multiple：一次选多张角色设定图。 */
export const Multiple = (): JSX.Element => {
  const [files, setFiles] = React.useState<File[]>([])
  return (
    <div style={{ width: 340 }}>
      <DesignFileInput
        multiple
        label="角色设定图"
        description="同一个角色的多角度图，帮模型认人"
        placeholder="可以一次选多张"
        accept="image/*"
        value={files}
        onChange={setFiles}
        leftSection={<IconPhoto size={15} />}
      />
    </div>
  )
}

/** 状态：必填 / 报错 / 禁用。 */
export const States = (): JSX.Element => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 340 }}>
    <Demo label="参考图" placeholder="选择一张图片" withAsterisk />
    <Demo label="参考图" placeholder="选择一张图片" error="这张图超过 20MB 了" />
    <Demo label="配音音轨" placeholder="当前模型不支持音频" disabled />
  </div>
)
