import writeExcelFile, { type SheetData } from 'write-excel-file/browser'
import { abilityLabels } from './labels'
import { buildMonthlySummary } from './planner'
import type { AppSettings, PlanItem, Resource, StudySession, WeeklySchedule } from './types'

type BackupPayload = {
  exportedAt: string
  version: 1
  resources: Resource[]
  schedules: WeeklySchedule[]
  planItems: PlanItem[]
  sessions: StudySession[]
  settings: AppSettings
}

function downloadBlob(filename: string, content: BlobPart, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function csvEscape(value: string | number) {
  const text = String(value)
  return `"${text.replaceAll('"', '""')}"`
}

export function exportBackup(payload: Omit<BackupPayload, 'exportedAt' | 'version'>) {
  const backup: BackupPayload = {
    exportedAt: new Date().toISOString(),
    version: 1,
    ...payload,
  }

  downloadBlob(
    `english-learning-backup-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(backup, null, 2),
    'application/json;charset=utf-8',
  )
}

export function parseBackup(content: string) {
  const data = JSON.parse(content) as BackupPayload

  if (!Array.isArray(data.resources) || !Array.isArray(data.sessions) || !data.settings) {
    throw new Error('备份文件格式不正确')
  }

  return {
    resources: data.resources,
    schedules: data.schedules ?? [],
    planItems: data.planItems ?? [],
    sessions: data.sessions,
    settings: data.settings,
  }
}

export function exportMonthCsv(
  month: string,
  resources: Resource[],
  planItems: PlanItem[],
  sessions: StudySession[],
) {
  const resourceMap = new Map(resources.map((resource) => [resource.id, resource]))
  const rows = [
    ['日期', '资源', '能力', '开始', '结束', '分钟', '备注'],
    ...sessions
      .filter((session) => session.date.startsWith(month))
      .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`))
      .map((session) => [
        session.date,
        resourceMap.get(session.resourceId)?.name ?? '未知资源',
        abilityLabels[session.ability],
        session.startTime,
        session.endTime,
        session.minutes,
        session.note,
      ]),
  ]

  const summary = buildMonthlySummary(month, resources, planItems, sessions)
  const summaryRows = [
    [],
    ['月度汇总'],
    ['总分钟', summary.totalMinutes],
    ['计划分钟', summary.plannedMinutes],
    ['完成率', `${summary.completionRate}%`],
    [],
    ['按资源'],
    ...summary.byResource.map((item) => [item.name, item.minutes]),
    [],
    ['按能力'],
    ...summary.byAbility.map((item) => [item.name, item.minutes]),
  ]

  const csv = [...rows, ...summaryRows].map((row) => row.map((cell) => csvEscape(cell)).join(',')).join('\n')
  downloadBlob(`english-learning-${month}.csv`, `\uFEFF${csv}`, 'text/csv;charset=utf-8')
}

function headerRow(values: string[]): SheetData[number] {
  return values.map((value) => ({
    value,
    fontWeight: 'bold',
    backgroundColor: '#e5f1ec',
  }))
}

export async function exportMonthWorkbook(
  month: string,
  resources: Resource[],
  planItems: PlanItem[],
  sessions: StudySession[],
) {
  const resourceMap = new Map(resources.map((resource) => [resource.id, resource]))
  const summary = buildMonthlySummary(month, resources, planItems, sessions)
  const monthSessions = sessions
    .filter((session) => session.date.startsWith(month))
    .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`))

  const sessionSheet: SheetData = [
    headerRow(['日期', '资源', '能力', '开始', '结束', '分钟', '备注']),
    ...monthSessions.map((session) => [
      session.date,
      resourceMap.get(session.resourceId)?.name ?? '未知资源',
      abilityLabels[session.ability],
      session.startTime,
      session.endTime,
      session.minutes,
      session.note,
    ]),
  ]
  const resourceSheet: SheetData = [
    headerRow(['资源', '分钟']),
    ...summary.byResource.map((item) => [item.name, item.minutes]),
  ]
  const abilitySheet: SheetData = [
    headerRow(['能力', '分钟']),
    ...summary.byAbility.map((item) => [item.name, item.minutes]),
  ]
  const dailySheet: SheetData = [
    headerRow(['日期', '计划分钟', '实际分钟']),
    ...summary.byDay.map((item) => [item.date, item.planned, item.actual]),
  ]

  await writeExcelFile([
    { sheet: 'Sessions', data: sessionSheet, stickyRowsCount: 1 },
    { sheet: 'By Resource', data: resourceSheet, stickyRowsCount: 1 },
    { sheet: 'By Ability', data: abilitySheet, stickyRowsCount: 1 },
    { sheet: 'Daily', data: dailySheet, stickyRowsCount: 1 },
  ]).toFile(`english-learning-${month}.xlsx`)
}
