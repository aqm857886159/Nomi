// 设计实验室 · 导演台「群众并进加人」样张格（2026-10-07，等用户拍板；产品行为未改）。
// 现状两格是现役 AddObjectMenu / ContextCard 本体；提案四格用同一批现役组件拼出合并后的样子（见 directorCrowdLabKit 头注释）。
import React from 'react'
import type { LabState } from '../../labScreen'
import { DirectorCrowdLazyStage } from '../directorCrowdLazyStage'

const SOURCE = 'docs/research/2026-10-07-director-add-entries.md · 用户 2026-10-07 反馈：群众并进「加人」'

export const DIRECTOR_CROWD_STATES: readonly LabState[] = [
  {
    id: 'crowd-01-now-add-menu-character-zh',
    name: '现状 · 「＋」→「角色」 · 中文',
    source: SOURCE,
    coverage: 'shell',
    capture: 'viewport',
    render: () => <DirectorCrowdLazyStage cell="now-add-menu-character" locale="zh-CN" />,
  },
  {
    id: 'crowd-01-now-add-menu-character-en',
    name: '现状 · 「＋」→「角色」 · 英文',
    source: SOURCE,
    coverage: 'shell',
    capture: 'viewport',
    render: () => <DirectorCrowdLazyStage cell="now-add-menu-character" locale="en" />,
  },
  {
    id: 'crowd-02-now-crowd-card-zh',
    name: '现状 · 独立的群众卡 · 中文',
    source: SOURCE,
    coverage: 'shell',
    capture: 'viewport',
    render: () => <DirectorCrowdLazyStage cell="now-crowd-card" locale="zh-CN" />,
  },
  {
    id: 'crowd-02-now-crowd-card-en',
    name: '现状 · 独立的群众卡 · 英文',
    source: SOURCE,
    coverage: 'shell',
    capture: 'viewport',
    render: () => <DirectorCrowdLazyStage cell="now-crowd-card" locale="en" />,
  },
  {
    id: 'crowd-03-new-add-menu-character-zh',
    name: '提案 · 「角色」子菜单多「群众」 · 中文',
    source: SOURCE,
    coverage: 'shell',
    capture: 'viewport',
    render: () => <DirectorCrowdLazyStage cell="new-add-menu-character" locale="zh-CN" />,
  },
  {
    id: 'crowd-03-new-add-menu-character-en',
    name: '提案 · 「角色」子菜单多「群众」 · 英文',
    source: SOURCE,
    coverage: 'shell',
    capture: 'viewport',
    render: () => <DirectorCrowdLazyStage cell="new-add-menu-character" locale="en" />,
  },
  {
    id: 'crowd-04-new-crowd-panel-zh',
    name: '提案 · 选群众后同浮层展开 · 中文',
    source: SOURCE,
    coverage: 'shell',
    capture: 'viewport',
    render: () => <DirectorCrowdLazyStage cell="new-crowd-panel" locale="zh-CN" />,
  },
  {
    id: 'crowd-04-new-crowd-panel-en',
    name: '提案 · 选群众后同浮层展开 · 英文',
    source: SOURCE,
    coverage: 'shell',
    capture: 'viewport',
    render: () => <DirectorCrowdLazyStage cell="new-crowd-panel" locale="en" />,
  },
  {
    id: 'crowd-05-after-one-group-zh',
    name: '提案 A · 加入后是一个群众组 · 中文',
    source: SOURCE,
    coverage: 'shell',
    capture: 'viewport',
    render: () => <DirectorCrowdLazyStage cell="after-one-group" locale="zh-CN" />,
  },
  {
    id: 'crowd-05-after-one-group-en',
    name: '提案 A · 加入后是一个群众组 · 英文',
    source: SOURCE,
    coverage: 'shell',
    capture: 'viewport',
    render: () => <DirectorCrowdLazyStage cell="after-one-group" locale="en" />,
  },
  {
    id: 'crowd-06-after-n-independent-zh',
    name: '提案 B · 加入后是 N 个独立角色 · 中文',
    source: SOURCE,
    coverage: 'shell',
    capture: 'viewport',
    render: () => <DirectorCrowdLazyStage cell="after-n-independent" locale="zh-CN" />,
  },
  {
    id: 'crowd-06-after-n-independent-en',
    name: '提案 B · 加入后是 N 个独立角色 · 英文',
    source: SOURCE,
    coverage: 'shell',
    capture: 'viewport',
    render: () => <DirectorCrowdLazyStage cell="after-n-independent" locale="en" />,
  },
]
