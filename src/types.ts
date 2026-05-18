export type Ability = 'reading' | 'listening' | 'speaking' | 'class'

export type ResourceType =
  | 'graded-reader'
  | 'app'
  | 'live-class'
  | 'audio-video'
  | 'review'

export type PlanStatus = 'planned' | 'done' | 'skipped'

export type PlanSource = 'schedule' | 'rotation' | 'manual'

export type DailyIntensity = 'light' | 'standard' | 'high'

export type Resource = {
  id: string
  name: string
  type: ResourceType
  abilities: Ability[]
  defaultMinutes: number
  enabled: boolean
  color: string
  notes?: string
}

export type WeeklySchedule = {
  id: string
  weekday: number
  startTime: string
  resourceId: string
  minutes: number
  enabled: boolean
}

export type PlanItem = {
  id: string
  date: string
  resourceId: string
  plannedMinutes: number
  status: PlanStatus
  source: PlanSource
  order: number
  generatedAt: string
}

export type StudySession = {
  id: string
  date: string
  resourceId: string
  ability: Ability
  startTime: string
  endTime: string
  minutes: number
  note: string
  planItemId?: string
  createdAt: string
}

export type AppSettings = {
  id: 'default'
  childName: string
  childAgeYears?: number
  childBirthYear: number
  childBirthMonth: number
  childAvatarId: string
  childAvatarDataUrl?: string
  dailyIntensity: DailyIntensity
  targetMinMinutes: number
  targetMaxMinutes: number
}

export type MonthlySummary = {
  month: string
  totalMinutes: number
  plannedMinutes: number
  completionRate: number
  byResource: Array<{ id: string; name: string; minutes: number; color: string }>
  byAbility: Array<{ ability: Ability; name: string; minutes: number }>
  byDay: Array<{ date: string; planned: number; actual: number }>
}
