// 3D 场景对象/相机**显示名**的契约。
//
// 2026-09-02 之前:新建对象时把 '假人'/'相机1'/'角色A' 直接写进 name 落盘。后果两条——
//   ① 英文界面照样显示中文(场景树里 假人/相机1,而同一面板其余部分都是英文);
//   ② 想「创建时按当前语言翻译」也不行:name 会写进项目文件,那样等于把**作者那一刻的语言**
//      烤进数据,英文环境建的项目中文用户打开永远是英文名。
// 现在:空名 = 用户没起过名,显示时按类型+序号现算本地化默认名;用户起的名原样存、原样显示。
//
// 这道盯死三件事(缺一都会悄悄退回老样子):
//   · 老项目里已存的名字必须原样显示 —— 这是「不破坏存量项目」的硬要求;
//   · 没起名的对象在中/英下各自给出本地语言的默认名;
//   · 复制品不能凭空拿到一个写死的名字。

import { afterAll, describe, expect, it } from 'vitest'
import i18n from '../../../../i18n'
import { makeCamera, makeObject } from './scene3dMath'
import {
  hasUserGivenName,
  scene3dCameraDisplayName,
  scene3dCharacterMovementName,
  scene3dCopiedName,
  scene3dObjectDisplayName,
  scene3dTrajectoryDisplayName,
  scene3dTrajectoryGroupDisplayName,
} from './scene3dObjectNames'

const HAN = /[一-鿿]/

afterAll(async () => {
  await i18n.changeLanguage('zh-CN') // 别把语言状态漏给同进程里的其它用例
})

describe('场景对象显示名', () => {
  it('新建对象不把默认名落盘(name 为空 = 语言中立)', () => {
    expect(makeObject('mannequin').name).toBe('')
    expect(makeCamera().name).toBe('')
    expect(hasUserGivenName('')).toBe(false)
    expect(hasUserGivenName('   ')).toBe(false)
    expect(hasUserGivenName('女主')).toBe(true)
  })

  it('没起名时按类型+序号现算默认名,中文界面出中文', async () => {
    await i18n.changeLanguage('zh-CN')
    const a = makeObject('mannequin')
    const b = makeObject('mannequin')
    expect(scene3dObjectDisplayName(a, [a, b])).toBe('角色A')
    expect(scene3dObjectDisplayName(b, [a, b])).toBe('角色B') // 第二个假人不再和第一个重名
    const cam1 = makeCamera()
    const cam2 = makeCamera()
    expect(scene3dCameraDisplayName(cam1, [cam1, cam2])).toBe('相机1')
    expect(scene3dCameraDisplayName(cam2, [cam1, cam2])).toBe('相机2')
  })

  it('英文界面出英文(这正是当年那个 bug)', async () => {
    await i18n.changeLanguage('en')
    const a = makeObject('mannequin')
    const cam = makeCamera()
    const objectName = scene3dObjectDisplayName(a, [a])
    const cameraName = scene3dCameraDisplayName(cam, [cam])
    expect(HAN.test(objectName), `英文界面下仍是中文: ${objectName}`).toBe(false)
    expect(HAN.test(cameraName), `英文界面下仍是中文: ${cameraName}`).toBe(false)
    expect(objectName).toBe('Character A')
    expect(cameraName).toBe('Camera 1')
  })

  it('**老项目存量名字原样显示、不被翻译也不被默认名盖掉**', async () => {
    // 改动前落盘的就是这些中文名;打开老项目必须原封不动。
    const legacy = { ...makeObject('mannequin'), name: '假人' }
    const legacyCam = { ...makeCamera(), name: '相机1' }
    const renamed = { ...makeObject('mannequin'), name: '女主' }
    for (const locale of ['zh-CN', 'en']) {
      await i18n.changeLanguage(locale)
      expect(scene3dObjectDisplayName(legacy, [legacy])).toBe('假人')
      expect(scene3dCameraDisplayName(legacyCam, [legacyCam])).toBe('相机1')
      expect(scene3dObjectDisplayName(renamed, [renamed])).toBe('女主')
    }
  })

  it('复制:源没起名 → 副本也不起名;源起过名 → 承接用户那串加后缀', async () => {
    await i18n.changeLanguage('zh-CN')
    expect(scene3dCopiedName('')).toBe('') // 不能变成「 副本」这种空前缀
    expect(scene3dCopiedName('女主')).toBe('女主 副本')
    await i18n.changeLanguage('en')
    expect(scene3dCopiedName('Hero')).toBe('Hero copy')
  })

  it('轨迹/分组同一套:没起名现算、起过名原样、老项目存量不动', async () => {
    const path1 = { id: 'p1', name: '', points: [], tension: 0, closed: false, color: '#fff' }
    const path2 = { id: 'p2', name: '', points: [], tension: 0, closed: false, color: '#fff' }
    const legacyPath = { ...path1, id: 'p3', name: '轨迹1' } // 改动前落盘的中文名
    const g1 = { id: 'g1', name: '', trajectoryIds: [] }
    const legacyGroup = { id: 'g2', name: '组1', trajectoryIds: [] }

    await i18n.changeLanguage('zh-CN')
    expect(scene3dTrajectoryDisplayName(path1, [path1, path2])).toBe('轨迹1')
    expect(scene3dTrajectoryDisplayName(path2, [path1, path2])).toBe('轨迹2')
    expect(scene3dTrajectoryGroupDisplayName(g1, [g1])).toBe('组1')

    await i18n.changeLanguage('en')
    expect(scene3dTrajectoryDisplayName(path1, [path1, path2])).toBe('Trajectory 1')
    expect(scene3dTrajectoryGroupDisplayName(g1, [g1])).toBe('Group 1')
    // 存量名两种语言下都原样,不被翻译也不被默认名盖掉
    for (const locale of ['zh-CN', 'en']) {
      await i18n.changeLanguage(locale)
      expect(scene3dTrajectoryDisplayName(legacyPath, [legacyPath])).toBe('轨迹1')
      expect(scene3dTrajectoryGroupDisplayName(legacyGroup, [legacyGroup])).toBe('组1')
    }
  })

  it('录 take 的轨迹名随语言合成(这条**故意**在创建时定,见 scene3dObjectNames 注释)', async () => {
    await i18n.changeLanguage('zh-CN')
    expect(scene3dCharacterMovementName('角色A')).toBe('角色A 走位')
    await i18n.changeLanguage('en')
    expect(scene3dCharacterMovementName('Character A')).toBe('Character A movement')
  })
})
