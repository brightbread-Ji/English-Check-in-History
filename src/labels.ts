import type { Ability, DailyIntensity, ResourceType } from './types'

export const abilityLabels: Record<Ability, string> = {
  reading: '阅读',
  listening: '听力',
  speaking: '口语',
  class: '外教大课',
}

export const resourceTypeLabels: Record<ResourceType, string> = {
  'graded-reader': '分级阅读',
  app: '学习软件',
  'live-class': '外教大课',
  'audio-video': '熏听内容',
  review: '复盘备注',
}

export const intensityLabels: Record<DailyIntensity, string> = {
  light: '轻量平衡',
  standard: '标准推进',
  high: '高强度记录',
}

export const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export const abilityColors: Record<Ability, string> = {
  reading: '#4f8cff',
  listening: '#21b7a8',
  speaking: '#f2a65a',
  class: '#d85f8a',
}
