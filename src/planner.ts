import { abilityLabels } from './labels'
import type {
  Ability,
  AppSettings,
  MonthlySummary,
  PlanItem,
  Resource,
  StudySession,
  WeeklySchedule,
} from './types'

export function todayKey(date = new Date()) {
  return toDateKey(date)
}

export function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function monthKey(date = new Date()) {
  return toDateKey(date).slice(0, 7)
}

export function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function formatMinutes(minutes: number) {
  if (minutes < 60) {
    return `${minutes} 分钟`
  }

  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
}

export function minutesBetween(start: string, end: string) {
  const [startHour, startMinute] = start.split(':').map(Number)
  const [endHour, endMinute] = end.split(':').map(Number)
  const startTotal = startHour * 60 + startMinute
  let endTotal = endHour * 60 + endMinute

  if (endTotal < startTotal) {
    endTotal += 24 * 60
  }

  return Math.max(1, endTotal - startTotal)
}

export function addMinutesToTime(time: string, minutes: number) {
  const [hour, minute] = time.split(':').map(Number)
  const total = hour * 60 + minute + minutes
  const normalized = total % (24 * 60)
  const nextHour = Math.floor(normalized / 60)
  const nextMinute = normalized % 60
  return `${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`
}

export function formatClock(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function pickRotating(resources: Resource[], date: Date, offset = 0) {
  if (resources.length === 0) {
    return undefined
  }

  const daySeed = Math.floor(
    (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
      Date.UTC(date.getFullYear(), 0, 0)) /
      86_400_000,
  )

  return resources[(daySeed + offset) % resources.length]
}

function createPlanItem(
  date: string,
  resourceId: string,
  plannedMinutes: number,
  source: PlanItem['source'],
  order: number,
) {
  return {
    id: `plan-${date}-${source}-${order}-${resourceId}`,
    date,
    resourceId,
    plannedMinutes,
    status: 'planned' as const,
    source,
    order,
    generatedAt: new Date().toISOString(),
  }
}

export function generateScheduledPlan(
  dateKey: string,
  resources: Resource[],
  schedules: WeeklySchedule[],
) {
  const date = parseDateKey(dateKey)
  const weekday = date.getDay()
  const enabledResources = resources.filter((resource) => resource.enabled)
  const resourceMap = new Map(enabledResources.map((resource) => [resource.id, resource]))

  const scheduledItems = schedules
    .filter((schedule) => schedule.enabled && schedule.weekday === weekday && resourceMap.has(schedule.resourceId))
    .sort((a, b) => a.startTime.localeCompare(b.startTime))

  return scheduledItems.map((schedule, index) =>
    createPlanItem(dateKey, schedule.resourceId, schedule.minutes, 'schedule', index + 1),
  )
}

export function generateDailySuggestions(
  dateKey: string,
  resources: Resource[],
  schedules: WeeklySchedule[],
  settings: AppSettings,
  existingPlans: PlanItem[] = [],
) {
  const date = parseDateKey(dateKey)
  const plans = generateScheduledPlan(dateKey, resources, schedules)
  const enabledResources = resources.filter((resource) => resource.enabled)
  const existingResourceIds = new Set([
    ...plans.map((plan) => plan.resourceId),
    ...existingPlans.filter((plan) => plan.date === dateKey).map((plan) => plan.resourceId),
  ])

  const scheduledMinutes = plans.reduce((total, item) => total + item.plannedMinutes, 0)
  const readingResources = enabledResources.filter(
    (resource) =>
      resource.abilities.includes('reading') &&
      resource.type !== 'live-class' &&
      !existingResourceIds.has(resource.id),
  )
  const listeningResources = enabledResources.filter(
    (resource) =>
      resource.abilities.includes('listening') &&
      resource.type !== 'live-class' &&
      !existingResourceIds.has(resource.id),
  )
  const reviewResource = enabledResources.find((resource) => resource.type === 'review')
  const suggestions: PlanItem[] = []
  let order = 20

  const addRotation = (resource: Resource | undefined, minutes?: number) => {
    if (!resource || existingResourceIds.has(resource.id)) {
      return
    }

    suggestions.push(
      createPlanItem(
        dateKey,
        resource.id,
        Math.max(5, minutes ?? resource.defaultMinutes),
        'rotation',
        order++,
      ),
    )
    existingResourceIds.add(resource.id)
  }

  if (plans.length > 0) {
    addRotation(pickRotating(readingResources, date), scheduledMinutes >= 60 ? 15 : 20)
    if (scheduledMinutes < 60) {
      addRotation(pickRotating(listeningResources, date, 1), 15)
    }
  } else {
    addRotation(pickRotating(readingResources, date), 25)
    addRotation(pickRotating(listeningResources, date, 1), 20)

    const total = plans.reduce((sum, item) => sum + item.plannedMinutes, 0)
    const suggestedTotal = suggestions.reduce((sum, item) => sum + item.plannedMinutes, 0)
    if (total + suggestedTotal < settings.targetMinMinutes) {
      addRotation(pickRotating(readingResources, date, 2), Math.min(20, settings.targetMinMinutes - total - suggestedTotal))
    }

    const nextTotal = total + suggestions.reduce((sum, item) => sum + item.plannedMinutes, 0)
    if (settings.dailyIntensity === 'high' && nextTotal < settings.targetMaxMinutes) {
      addRotation(pickRotating(listeningResources, date, 3), Math.min(20, settings.targetMaxMinutes - nextTotal))
    }
  }

  if (reviewResource && plans.length === 0 && suggestions.length === 0) {
    addRotation(reviewResource, 10)
  }

  return suggestions.sort((a, b) => a.order - b.order)
}

export function generateDailyPlan(
  dateKey: string,
  resources: Resource[],
  schedules: WeeklySchedule[],
) {
  return generateScheduledPlan(dateKey, resources, schedules)
}

export function getMonthDates(month: string) {
  const [year, monthIndex] = month.split('-').map(Number)
  const lastDay = new Date(year, monthIndex, 0).getDate()
  return Array.from({ length: lastDay }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)
}

export function buildMonthlySummary(
  month: string,
  resources: Resource[],
  plans: PlanItem[],
  sessions: StudySession[],
): MonthlySummary {
  const resourceMap = new Map(resources.map((resource) => [resource.id, resource]))
  const monthPlans = plans.filter((plan) => plan.date.startsWith(month))
  const monthSessions = sessions.filter((session) => session.date.startsWith(month))
  const plannedMinutes = monthPlans.reduce((sum, plan) => sum + plan.plannedMinutes, 0)
  const totalMinutes = monthSessions.reduce((sum, session) => sum + session.minutes, 0)
  const doneCount = monthPlans.filter((plan) => plan.status === 'done').length
  const activePlanCount = monthPlans.filter((plan) => plan.status !== 'skipped').length
  const byResourceMap = new Map<string, { id: string; name: string; minutes: number; color: string }>()
  const byAbilityMap = new Map<Ability, number>()

  monthSessions.forEach((session) => {
    const resource = resourceMap.get(session.resourceId)
    const current = byResourceMap.get(session.resourceId) ?? {
      id: session.resourceId,
      name: resource?.name ?? '未知资源',
      minutes: 0,
      color: resource?.color ?? '#6b7280',
    }
    current.minutes += session.minutes
    byResourceMap.set(session.resourceId, current)
    byAbilityMap.set(session.ability, (byAbilityMap.get(session.ability) ?? 0) + session.minutes)
  })

  const byDay = getMonthDates(month).map((date) => ({
    date,
    planned: monthPlans
      .filter((plan) => plan.date === date)
      .reduce((sum, plan) => sum + plan.plannedMinutes, 0),
    actual: monthSessions
      .filter((session) => session.date === date)
      .reduce((sum, session) => sum + session.minutes, 0),
  }))

  return {
    month,
    totalMinutes,
    plannedMinutes,
    completionRate: activePlanCount === 0 ? 0 : Math.round((doneCount / activePlanCount) * 100),
    byResource: Array.from(byResourceMap.values()).sort((a, b) => b.minutes - a.minutes),
    byAbility: Array.from(byAbilityMap.entries())
      .map(([ability, minutes]) => ({ ability, name: abilityLabels[ability], minutes }))
      .sort((a, b) => b.minutes - a.minutes),
    byDay,
  }
}

export function createMonthlyAdvice(summary: MonthlySummary) {
  const advice: string[] = []
  const total = summary.totalMinutes
  const reading = summary.byAbility.find((item) => item.ability === 'reading')?.minutes ?? 0
  const listening = summary.byAbility.find((item) => item.ability === 'listening')?.minutes ?? 0
  const classMinutes = summary.byAbility.find((item) => item.ability === 'class')?.minutes ?? 0
  const speaking = summary.byAbility.find((item) => item.ability === 'speaking')?.minutes ?? 0

  if (total === 0) {
    return ['本月还没有记录，先从今天的计划开始打卡。']
  }

  if (reading / total < 0.28) {
    advice.push('阅读占比偏低，下周可增加 3 次 ABC Reading 或牛津树。')
  }

  if (listening / total > 0.58 && reading / total < 0.35) {
    advice.push('熏听时间较多，建议配一段分级阅读复盘，让输入更扎实。')
  }

  if ((classMinutes + speaking) / total < 0.18) {
    advice.push('口语输出偏少，可在外教课后补 5-10 分钟复述或角色扮演。')
  }

  if (summary.completionRate < 70 && summary.plannedMinutes > 0) {
    advice.push('计划完成率低于 70%，可以把非课日计划压到 45 分钟以内。')
  }

  if (advice.length === 0) {
    advice.push('本月阅读、听力和课程配比比较均衡，可以保持当前周节奏。')
  }

  return advice
}
