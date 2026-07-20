import React from 'react'
import { useTranslation } from 'react-i18next'
import { Html } from '@react-three/drei'
import { IconManFilled, IconVideo } from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import type { Scene3DCamera, Scene3DObject } from './scene3dTypes'

// 「操控」入口贴近被选中的角色（用户反馈 #6）：选中假人时，在角色头顶浮出一个画布内「操控」按钮，
// 而不是只藏在右上角顶栏（用户点的是画面里的角色，按钮却在天边）。用 drei <Html> 锚到角色世界坐标，
// 跟随角色位移；只在「选中单个假人、未在操控、非只读」时出现，正在操控/只读不显（退出走底部动作库）。
//
// 不引新依赖（drei 已是依赖）、不造平行实现：点它走与顶栏按钮同一个 enterPossess。保留键盘可达 =
// 顶栏 CharacterPossessButton 不动（它同时承担「退出操控」切换 + tab 可达）。

const HEAD_OFFSET_Y = 2.05 // 假人约 1.8 高，锚在头顶略上方，不挡躯干

export function Scene3DPossessPrompt({
  object,
  onPossess,
}: {
  object: Scene3DObject
  onPossess: (objectId: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <Html
      position={[object.position[0], object.position[1] + HEAD_OFFSET_Y, object.position[2]]}
      center
      distanceFactor={8}
      zIndexRange={[20, 0]}
      // 跟到角色身上的浮层不该被几何体遮挡掉一半，常显更易点中。
      occlude={false}
    >
      <button
        type="button"
        title={t('scene3d.character.possessCharacterHint')}
        className={cn(
          'inline-flex select-none items-center gap-1.5 whitespace-nowrap rounded-nomi px-3 py-1.5',
          'border-0 bg-[var(--nomi-ink)] text-caption font-semibold text-[var(--nomi-paper)]',
          'shadow-[var(--nomi-shadow-md)] transition hover:opacity-90',
          'cursor-pointer',
        )}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onPossess(object.id)
        }}
      >
        <IconManFilled size={14} />
        <span>{t('scene3d.character.control')}</span>
      </button>
    </Html>
  )
}

// 「操控镜头」入口贴近被选中的相机（与角色一视同仁，P4）：选中相机时在相机机身旁浮出画布内
// 「操控」按钮，点它进相机运镜操控（WASD 飞 + 转朝向 + 滚轮）。锚到相机世界坐标，常显易点。
export function Scene3DCameraPossessPrompt({
  camera,
  onPossess,
}: {
  camera: Scene3DCamera
  onPossess: (cameraId: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <Html
      position={[camera.position[0], camera.position[1] + 0.55, camera.position[2]]}
      center
      distanceFactor={8}
      zIndexRange={[20, 0]}
      occlude={false}
    >
      <button
        type="button"
        title={t('scene3d.character.possessCameraHint')}
        className={cn(
          'inline-flex select-none items-center gap-1.5 whitespace-nowrap rounded-nomi px-3 py-1.5',
          'border-0 bg-[var(--nomi-ink)] text-caption font-semibold text-[var(--nomi-paper)]',
          'shadow-[var(--nomi-shadow-md)] transition hover:opacity-90',
          'cursor-pointer',
        )}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onPossess(camera.id)
        }}
      >
        <IconVideo size={14} />
        <span>{t('scene3d.character.control')}</span>
      </button>
    </Html>
  )
}
