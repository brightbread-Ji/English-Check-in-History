import Dexie, { type Table } from 'dexie'
import { defaultResources, defaultSchedules, defaultSettings } from './defaults'
import type { AppSettings, PlanItem, Resource, StudySession, WeeklySchedule } from './types'

class LearningTrackerDb extends Dexie {
  resources!: Table<Resource, string>
  schedules!: Table<WeeklySchedule, string>
  planItems!: Table<PlanItem, string>
  sessions!: Table<StudySession, string>
  settings!: Table<AppSettings, string>

  constructor() {
    super('english-learning-tracker')
    this.version(1).stores({
      resources: 'id, enabled, type',
      schedules: 'id, weekday, resourceId, enabled',
      planItems: 'id, date, resourceId, status, source',
      sessions: 'id, date, resourceId, ability, planItemId',
      settings: 'id',
    })
  }
}

export const db = new LearningTrackerDb()

function normalizeSettings(settings: AppSettings | undefined): AppSettings {
  if (!settings) {
    return defaultSettings
  }

  return {
    ...defaultSettings,
    ...settings,
    childName: settings.childName === '4.5岁女孩' ? '小朋友' : settings.childName,
    childBirthYear: settings.childBirthYear ?? 2021,
    childBirthMonth: settings.childBirthMonth ?? 11,
    childAvatarId: settings.childAvatarId ?? defaultSettings.childAvatarId,
    childAvatarDataUrl: settings.childAvatarDataUrl ?? '',
  }
}

export async function ensureSeedData() {
  const [resourceCount, scheduleCount, settings] = await Promise.all([
    db.resources.count(),
    db.schedules.count(),
    db.settings.get('default'),
  ])

  if (resourceCount === 0) {
    await db.resources.bulkPut(defaultResources)
  }

  if (scheduleCount === 0) {
    await db.schedules.bulkPut(defaultSchedules)
  } else {
    const originalPushUpSeed = await db.schedules.get('schedule-push-up-sat')
    if (
      originalPushUpSeed &&
      originalPushUpSeed.resourceId === 'push-up' &&
      originalPushUpSeed.weekday === 6 &&
      originalPushUpSeed.startTime === '09:30' &&
      originalPushUpSeed.minutes === 90
    ) {
      await db.schedules.delete('schedule-push-up-sat')
      await db.schedules.put({
        ...originalPushUpSeed,
        id: 'schedule-push-up-mon',
        weekday: 1,
      })
    }
  }

  if (!settings) {
    await db.settings.put(defaultSettings)
  } else {
    const normalized = normalizeSettings(settings)
    if (JSON.stringify(normalized) !== JSON.stringify(settings)) {
      await db.settings.put(normalized)
    }
  }
}

export async function readAllData() {
  const [resources, schedules, planItems, sessions, settings] = await Promise.all([
    db.resources.toArray(),
    db.schedules.toArray(),
    db.planItems.toArray(),
    db.sessions.toArray(),
    db.settings.get('default'),
  ])

  return {
    resources,
    schedules,
    planItems,
    sessions,
    settings: normalizeSettings(settings),
  }
}

export async function replaceAllData(payload: {
  resources: Resource[]
  schedules: WeeklySchedule[]
  planItems: PlanItem[]
  sessions: StudySession[]
  settings: AppSettings
}) {
  await db.transaction('rw', [db.resources, db.schedules, db.planItems, db.sessions, db.settings], async () => {
    await Promise.all([
      db.resources.clear(),
      db.schedules.clear(),
      db.planItems.clear(),
      db.sessions.clear(),
      db.settings.clear(),
    ])
    await Promise.all([
      db.resources.bulkPut(payload.resources),
      db.schedules.bulkPut(payload.schedules),
      db.planItems.bulkPut(payload.planItems),
      db.sessions.bulkPut(payload.sessions),
      db.settings.put(payload.settings),
    ])
  })
}
