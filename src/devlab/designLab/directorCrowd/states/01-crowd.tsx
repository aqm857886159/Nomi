// 设计实验室 · 导演台「群众并进加人」格（2026-10-07，群众并进加人的实现后真样子）。
// 每格都是现役 AddObjectMenu / SceneObjectsTab / ContextCard 本体（见 directorCrowdLabKit 头注释）。
import React from 'react'
import type { LabState } from '../../labScreen'
import { DirectorCrowdLazyStage } from '../directorCrowdLazyStage'

const SOURCE = 'docs/research/2026-10-07-director-add-entries.md · 用户 2026-10-07 拍板：群众并进「加人」，加进场景后是一个群众组'

export const DIRECTOR_CROWD_STATES: readonly LabState[] = [
  {
    id: 'crowd-01-add-menu-character-zh',
    name: '「＋」→「角色」 · 中文',
    source: SOURCE,
    coverage: 'shell',
    capture: 'viewport',
    render: () => <DirectorCrowdLazyStage cell="add-menu-character" locale="zh-CN" />,
  },
  {
    id: 'crowd-01-add-menu-character-en',
    name: '「＋」→「角色」 · 英文',
    source: SOURCE,
    coverage: 'shell',
    capture: 'viewport',
    render: () => <DirectorCrowdLazyStage cell="add-menu-character" locale="en" />,
  },
  {
    id: 'crowd-02-crowd-panel-zh',
    name: '选群众：同浮层设参数 · 中文',
    source: SOURCE,
    coverage: 'shell',
    capture: 'viewport',
    render: () => <DirectorCrowdLazyStage cell="crowd-panel" locale="zh-CN" />,
  },
  {
    id: 'crowd-02-crowd-panel-en',
    name: '选群众：同浮层设参数 · 英文',
    source: SOURCE,
    coverage: 'shell',
    capture: 'viewport',
    render: () => <DirectorCrowdLazyStage cell="crowd-panel" locale="en" />,
  },
  {
    id: 'crowd-03-action-picker-zh',
    name: '点动作：现有动作选择弹窗 · 中文',
    source: SOURCE,
    coverage: 'shell',
    capture: 'viewport',
    render: () => <DirectorCrowdLazyStage cell="action-picker" locale="zh-CN" />,
  },
  {
    id: 'crowd-03-action-picker-en',
    name: '点动作：现有动作选择弹窗 · 英文',
    source: SOURCE,
    coverage: 'shell',
    capture: 'viewport',
    render: () => <DirectorCrowdLazyStage cell="action-picker" locale="en" />,
  },
  {
    id: 'crowd-04-placed-group-zh',
    name: '放下后：大纲一行群众组 + 右卡 · 中文',
    source: SOURCE,
    coverage: 'shell',
    capture: 'viewport',
    render: () => <DirectorCrowdLazyStage cell="placed-group" locale="zh-CN" />,
  },
  {
    id: 'crowd-04-placed-group-en',
    name: '放下后：大纲一行群众组 + 右卡 · 英文',
    source: SOURCE,
    coverage: 'shell',
    capture: 'viewport',
    render: () => <DirectorCrowdLazyStage cell="placed-group" locale="en" />,
  },
  {
    id: 'crowd-05-group-action-changed-zh',
    name: '整组改动作后 · 中文',
    source: SOURCE,
    coverage: 'shell',
    capture: 'viewport',
    render: () => <DirectorCrowdLazyStage cell="group-action-changed" locale="zh-CN" />,
  },
  {
    id: 'crowd-05-group-action-changed-en',
    name: '整组改动作后 · 英文',
    source: SOURCE,
    coverage: 'shell',
    capture: 'viewport',
    render: () => <DirectorCrowdLazyStage cell="group-action-changed" locale="en" />,
  },
]
