import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Crown,
  Database,
  Download,
  FileSpreadsheet,
  Heart,
  Headphones,
  Home,
  ListChecks,
  Mic2,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Save,
  SkipForward,
  Snowflake,
  Sparkles,
  Square,
  Trash2,
  Upload,
  UsersRound,
} from 'lucide-react'
import './App.css'
import { db, ensureSeedData, readAllData, replaceAllData } from './db'
import { exportBackup, exportMonthCsv, exportMonthWorkbook, parseBackup } from './exports'
import { abilityColors, abilityLabels, intensityLabels, resourceTypeLabels, weekdays } from './labels'
import { fetchRemoteData, loadSyncConfig, pushRemoteData, saveSyncConfig, type RemoteSnapshot, type SyncConfig } from './sync'
import {
  addMinutesToTime,
  buildMonthlySummary,
  createMonthlyAdvice,
  formatClock,
  formatMinutes,
  generateDailySuggestions,
  generateDailyPlan,
  generateScheduledPlan,
  getMonthDates,
  todayKey,
} from './planner'
import type {
  Ability,
  AppSettings,
  DailyIntensity,
  PlanItem,
  Resource,
  ResourceType,
  StudySession,
  WeeklySchedule,
} from './types'

type View = 'today' | 'analysis' | 'resources' | 'schedule' | 'data'

type ResourceDraft = {
  id: string
  name: string
  type: ResourceType
  ability: Ability
  defaultMinutes: number
  enabled: boolean
  color: string
  notes: string
}

type ScheduleDraft = {
  id: string
  weekday: number
  startTime: string
  resourceId: string
  minutes: number
  enabled: boolean
}

type ManualDraft = {
  date: string
  ability: Ability
  resourceId: string
  minutes: number
  note: string
}

type ActiveSession = {
  resourceId: string
  planItemId?: string
  startIso: string
}

type AvatarOption = {
  id: string
  label: string
  group: string
  colors: [string, string]
  icon: typeof Crown
}

const emptyResourceDraft: ResourceDraft = {
  id: '',
  name: '',
  type: 'app',
  ability: 'reading',
  defaultMinutes: 20,
  enabled: true,
  color: '#2f7d68',
  notes: '',
}

const emptyScheduleDraft: ScheduleDraft = {
  id: '',
  weekday: 1,
  startTime: '18:30',
  resourceId: '',
  minutes: 25,
  enabled: true,
}

const statusLabels: Record<PlanItem['status'], string> = {
  planned: '待完成',
  done: '已完成',
  skipped: '已跳过',
}

const sourceLabels: Record<PlanItem['source'], string> = {
  schedule: '课表',
  rotation: '建议',
  manual: '手动',
}

const abilityOrder: Ability[] = ['reading', 'listening', 'speaking', 'class']

const categoryLabels: Record<Ability, string> = {
  reading: '阅读',
  listening: '听力',
  speaking: '口语',
  class: '外教大课',
}

const avatarOptions: AvatarOption[] = [
  { id: 'rose-princess', label: '玫瑰公主', group: '公主系', colors: ['#f7a8c4', '#f6d365'], icon: Crown },
  { id: 'ocean-princess', label: '海湾公主', group: '公主系', colors: ['#61c8ff', '#b6e3d4'], icon: Crown },
  { id: 'starlight-princess', label: '星光公主', group: '公主系', colors: ['#b08cff', '#ffd166'], icon: Sparkles },
  { id: 'snow-princess', label: '雪花公主', group: '冰雪系', colors: ['#93c5fd', '#e0f2fe'], icon: Snowflake },
  { id: 'ice-queen', label: '冰晶女王', group: '冰雪系', colors: ['#818cf8', '#67e8f9'], icon: Snowflake },
  { id: 'pink-piglet', label: '粉粉小猪', group: '小猪系', colors: ['#fb8fb7', '#ffc2d1'], icon: Heart },
  { id: 'story-piglet', label: '故事小猪', group: '小猪系', colors: ['#fda4af', '#fbcfe8'], icon: Heart },
]

const viewItems: Array<{ id: View; label: string; icon: typeof Home }> = [
  { id: 'today', label: '今日计划', icon: Home },
  { id: 'analysis', label: '月度分析', icon: BarChart3 },
  { id: 'resources', label: '资源库', icon: BookOpen },
  { id: 'schedule', label: '固定课表', icon: CalendarDays },
  { id: 'data', label: '数据管理', icon: Database },
]

function newId(prefix: string) {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) {
    return `${prefix}-${uuid}`
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function primaryAbility(resource: Resource | undefined): Ability {
  return resource?.abilities[0] ?? 'reading'
}

function getResource(resources: Resource[], resourceId: string) {
  return resources.find((resource) => resource.id === resourceId)
}

function resourcesForCategory(resources: Resource[], category: Ability) {
  return resources.filter((resource) => {
    if (category === 'class') {
      return resource.type === 'live-class' || resource.abilities.includes('class')
    }

    if (category === 'speaking') {
      return resource.abilities.includes('speaking') && resource.type !== 'live-class'
    }

    return resource.abilities.includes(category)
  })
}

function buildAbilityBreakdown(plans: PlanItem[], resources: Resource[]) {
  const totals = new Map<Ability, number>(abilityOrder.map((ability) => [ability, 0]))

  plans.forEach((plan) => {
    const ability = primaryAbility(getResource(resources, plan.resourceId))
    totals.set(ability, (totals.get(ability) ?? 0) + plan.plannedMinutes)
  })

  const total = Array.from(totals.values()).reduce((sum, minutes) => sum + minutes, 0)

  return abilityOrder.map((ability) => {
    const minutes = totals.get(ability) ?? 0
    return {
      ability,
      name: abilityLabels[ability],
      minutes,
      percent: total === 0 ? 0 : Math.round((minutes / total) * 100),
      color: abilityColors[ability],
    }
  })
}

function buildDonutGradient(items: ReturnType<typeof buildAbilityBreakdown>) {
  const activeItems = items.filter((item) => item.percent > 0)

  if (activeItems.length === 0) {
    return 'conic-gradient(var(--soft) 0 100%)'
  }

  let cursor = 0
  const segments = activeItems.map((item, index) => {
    const start = cursor
    const end = index === activeItems.length - 1 ? 100 : cursor + item.percent
    cursor = end
    return `${item.color} ${start}% ${end}%`
  })

  return `conic-gradient(${segments.join(', ')})`
}

function compactMinutes(minutes: number) {
  if (minutes < 60) {
    return `${minutes}分`
  }

  if (minutes % 60 === 0) {
    return `${minutes / 60}h`
  }

  return `${(minutes / 60).toFixed(1)}h`
}

function calculateAgeLabel(year: number, month: number) {
  const now = new Date()
  let totalMonths = (now.getFullYear() - year) * 12 + (now.getMonth() + 1 - month)
  totalMonths = Math.max(0, totalMonths)
  const years = Math.floor(totalMonths / 12)
  const months = totalMonths % 12

  if (years === 0) {
    return `${months}个月`
  }

  return months === 0 ? `${years}岁` : `${years}岁${months}个月`
}

function getAvatar(id: string | undefined) {
  return avatarOptions.find((avatar) => avatar.id === id) ?? avatarOptions[0]
}

function App() {
  const [view, setView] = useState<View>('today')
  const [ready, setReady] = useState(false)
  const [resources, setResources] = useState<Resource[]>([])
  const [schedules, setSchedules] = useState<WeeklySchedule[]>([])
  const [planItems, setPlanItems] = useState<PlanItem[]>([])
  const [sessions, setSessions] = useState<StudySession[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [selectedDate, setSelectedDate] = useState(todayKey())
  const [toast, setToast] = useState('')
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null)
  const [resourceDraft, setResourceDraft] = useState<ResourceDraft>(emptyResourceDraft)
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>(emptyScheduleDraft)
  const [manualDraft, setManualDraft] = useState<ManualDraft>({
    date: todayKey(),
    ability: 'reading',
    resourceId: '',
    minutes: 20,
    note: '',
  })
  const [selectedSuggestionCategory, setSelectedSuggestionCategory] = useState<Ability>('reading')
  const [selectedSuggestionResourceId, setSelectedSuggestionResourceId] = useState('')
  const [syncConfig, setSyncConfig] = useState<SyncConfig>(() => loadSyncConfig())
  const [remoteSnapshot, setRemoteSnapshot] = useState<RemoteSnapshot | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const resourceEditorRef = useRef<HTMLElement | null>(null)

  const selectedMonth = selectedDate.slice(0, 7)

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }, [])

  const loadData = useCallback(async (dateForPlan = todayKey()) => {
    const data = await readAllData()
    let nextPlanItems = data.planItems

    if (data.resources.length > 0) {
      const scheduledPlans = generateScheduledPlan(dateForPlan, data.resources, data.schedules)
      const currentPlans = nextPlanItems.filter((plan) => plan.date === dateForPlan)
      const currentSchedulePlans = currentPlans.filter((plan) => plan.source === 'schedule')
      const schedulePlanIds = new Set(scheduledPlans.map((plan) => plan.id))
      const missingPlans = scheduledPlans.filter((plan) => !currentSchedulePlans.some((current) => current.id === plan.id))
      const obsoletePlans = currentSchedulePlans.filter((plan) => !schedulePlanIds.has(plan.id))

      if (missingPlans.length > 0 || obsoletePlans.length > 0) {
        await db.transaction('rw', db.planItems, async () => {
          if (obsoletePlans.length > 0) {
            await db.planItems.bulkDelete(obsoletePlans.map((plan) => plan.id))
          }
          if (missingPlans.length > 0) {
            await db.planItems.bulkPut(missingPlans)
          }
        })
        nextPlanItems = [
          ...nextPlanItems.filter((plan) => !obsoletePlans.some((obsolete) => obsolete.id === plan.id)),
          ...missingPlans,
        ]
      }
    }

    const firstResource = data.resources.find((resource) => resource.enabled) ?? data.resources[0]

    setResources(data.resources)
    setSchedules(data.schedules)
    setPlanItems(nextPlanItems)
    setSessions(data.sessions)
    setSettings(data.settings)
    if (firstResource) {
      setManualDraft((draft) => (draft.resourceId ? draft : { ...draft, resourceId: firstResource.id }))
      setScheduleDraft((draft) => (draft.resourceId ? draft : { ...draft, resourceId: firstResource.id }))
    }
    setReady(true)
  }, [])

  useEffect(() => {
    void ensureSeedData().then(() => loadData(todayKey()))
  }, [loadData])

  const selectDate = async (date: string) => {
    setSelectedDate(date)
    setManualDraft((draft) => ({ ...draft, date }))
    await loadData(date)
  }

  const datePlans = useMemo(
    () =>
      planItems
        .filter((plan) => plan.date === selectedDate)
        .sort((a, b) => a.order - b.order),
    [planItems, selectedDate],
  )

  const dailySuggestions = useMemo(
    () =>
      settings
        ? generateDailySuggestions(selectedDate, resources, schedules, settings, datePlans)
        : [],
    [datePlans, resources, schedules, selectedDate, settings],
  )

  const dateSessions = useMemo(
    () =>
      sessions
        .filter((session) => session.date === selectedDate)
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [selectedDate, sessions],
  )

  const monthlySummary = useMemo(
    () => buildMonthlySummary(selectedMonth, resources, planItems, sessions),
    [planItems, resources, selectedMonth, sessions],
  )

  const advice = useMemo(() => createMonthlyAdvice(monthlySummary), [monthlySummary])
  const todayAbilityBreakdown = useMemo(() => buildAbilityBreakdown(datePlans, resources), [datePlans, resources])
  const todayAbilityGradient = useMemo(() => buildDonutGradient(todayAbilityBreakdown), [todayAbilityBreakdown])
  const todayPlanAbilityTotal = todayAbilityBreakdown.reduce((sum, item) => sum + item.minutes, 0)
  const todayPlanned = datePlans.reduce((sum, plan) => sum + plan.plannedMinutes, 0)
  const todayActual = dateSessions.reduce((sum, session) => sum + session.minutes, 0)
  const todayRemaining = Math.max(0, todayPlanned - todayActual)
  const enabledResources = resources.filter((resource) => resource.enabled)
  const plannedResourceIds = new Set(datePlans.map((plan) => plan.resourceId))
  const suggestionResourceOptions = resourcesForCategory(enabledResources, selectedSuggestionCategory).filter(
    (resource) => !plannedResourceIds.has(resource.id),
  )
  const suggestionByResourceId = new Map(dailySuggestions.map((suggestion) => [suggestion.resourceId, suggestion]))
  const selectedSuggestionResource = suggestionResourceOptions.find(
    (resource) => resource.id === selectedSuggestionResourceId,
  )
  const selectedSuggestionMinutes = selectedSuggestionResource
    ? (suggestionByResourceId.get(selectedSuggestionResource.id)?.plannedMinutes ?? selectedSuggestionResource.defaultMinutes)
    : 0
  const selectedAvatar = getAvatar(settings?.childAvatarId)
  const birthYears = Array.from({ length: 12 }, (_, index) => new Date().getFullYear() - index)
  const childAgeLabel = settings ? calculateAgeLabel(settings.childBirthYear, settings.childBirthMonth) : ''
  const manualResourceOptions = resourcesForCategory(enabledResources, manualDraft.ability)
  const selectedManualResource =
    manualResourceOptions.find((resource) => resource.id === manualDraft.resourceId) ?? manualResourceOptions[0]

  const saveResource = async () => {
    if (!resourceDraft.name.trim()) {
      showToast('请先填写资源名称')
      return
    }

    const resource: Resource = {
      id: resourceDraft.id || newId('resource'),
      name: resourceDraft.name.trim(),
      type: resourceDraft.type,
      abilities: [resourceDraft.ability],
      defaultMinutes: Math.max(5, Number(resourceDraft.defaultMinutes) || 5),
      enabled: resourceDraft.enabled,
      color: resourceDraft.color,
      notes: resourceDraft.notes.trim(),
    }

    await db.resources.put(resource)
    setResourceDraft(emptyResourceDraft)
    await loadData(selectedDate)
    showToast('资源已保存')
  }

  const editResource = (resource: Resource) => {
    setResourceDraft({
      id: resource.id,
      name: resource.name,
      type: resource.type,
      ability: primaryAbility(resource),
      defaultMinutes: resource.defaultMinutes,
      enabled: resource.enabled,
      color: resource.color,
      notes: resource.notes ?? '',
    })
    setView('resources')
    window.setTimeout(() => resourceEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
    showToast(`正在编辑：${resource.name}`)
  }

  const toggleResource = async (resource: Resource) => {
    await db.resources.update(resource.id, { enabled: !resource.enabled })
    await loadData(selectedDate)
  }

  const saveSchedule = async () => {
    if (!scheduleDraft.resourceId) {
      showToast('请先选择资源')
      return
    }

    await db.schedules.put({
      id: scheduleDraft.id || newId('schedule'),
      weekday: Number(scheduleDraft.weekday),
      startTime: scheduleDraft.startTime,
      resourceId: scheduleDraft.resourceId,
      minutes: Math.max(5, Number(scheduleDraft.minutes) || 5),
      enabled: scheduleDraft.enabled,
    })
    setScheduleDraft((draft) => ({ ...emptyScheduleDraft, resourceId: draft.resourceId }))
    await loadData(selectedDate)
    showToast('课表已保存')
  }

  const editSchedule = (schedule: WeeklySchedule) => {
    setScheduleDraft(schedule)
    setView('schedule')
  }

  const deleteSchedule = async (scheduleId: string) => {
    await db.schedules.delete(scheduleId)
    await loadData(selectedDate)
    showToast('课表项已删除')
  }

  const regenerateSelectedDate = async () => {
    if (!settings) {
      return
    }

    const generated = generateDailyPlan(selectedDate, resources, schedules)
    const currentSchedulePlans = await db.planItems
      .where('date')
      .equals(selectedDate)
      .filter((plan) => plan.source === 'schedule')
      .toArray()
    await db.planItems.bulkDelete(currentSchedulePlans.map((plan) => plan.id))
    if (generated.length > 0) {
      await db.planItems.bulkPut(generated)
    }
    await loadData(selectedDate)
    showToast('已同步固定课表')
  }

  const addSelectedSuggestionToPlan = async () => {
    if (!selectedSuggestionResource) {
      showToast('请先选择要加入的内容')
      return
    }

    if (datePlans.some((plan) => plan.resourceId === selectedSuggestionResource.id)) {
      showToast('这个内容已经在今日计划里')
      return
    }

    await db.planItems.put({
      id: newId(`plan-${selectedDate}-rotation`),
      date: selectedDate,
      resourceId: selectedSuggestionResource.id,
      plannedMinutes: selectedSuggestionMinutes,
      status: 'planned',
      source: 'rotation',
      order: 20 + datePlans.length,
      generatedAt: new Date().toISOString(),
    })
    setSelectedSuggestionResourceId('')
    await loadData(selectedDate)
    showToast('建议已加入今日计划')
  }

  const generateMonthPlans = async () => {
    if (!settings) {
      return
    }

    let added = 0
    for (const date of getMonthDates(selectedMonth)) {
      const count = await db.planItems.where('date').equals(date).count()
      if (count === 0) {
        const generated = generateDailyPlan(date, resources, schedules)
        if (generated.length > 0) {
          await db.planItems.bulkPut(generated)
          added += generated.length
        }
      }
    }
    await loadData(selectedDate)
    showToast(added > 0 ? `已生成 ${added} 个计划项` : '本月计划已存在')
  }

  const completeAsPlanned = async (plan: PlanItem) => {
    const resource = getResource(resources, plan.resourceId)
    const endTime = formatClock(new Date())
    const startTime = addMinutesToTime(endTime, -plan.plannedMinutes)

    await db.sessions.add({
      id: newId('session'),
      date: selectedDate,
      resourceId: plan.resourceId,
      ability: primaryAbility(resource),
      startTime,
      endTime,
      minutes: plan.plannedMinutes,
      note: '按计划完成',
      planItemId: plan.id,
      createdAt: new Date().toISOString(),
    })
    await db.planItems.update(plan.id, { status: 'done' })
    await loadData(selectedDate)
    showToast('已按计划记录')
  }

  const skipPlan = async (plan: PlanItem) => {
    await db.planItems.update(plan.id, { status: 'skipped' })
    await loadData(selectedDate)
  }

  const deletePlanItem = async (plan: PlanItem) => {
    await db.planItems.delete(plan.id)
    await loadData(selectedDate)
    showToast('计划项已移除')
  }

  const startPlan = (plan: PlanItem) => {
    if (activeSession) {
      showToast('已有正在计时的项目')
      return
    }

    setActiveSession({
      resourceId: plan.resourceId,
      planItemId: plan.id,
      startIso: new Date().toISOString(),
    })
  }

  const stopActiveSession = async () => {
    if (!activeSession) {
      return
    }

    const resource = getResource(resources, activeSession.resourceId)
    const start = new Date(activeSession.startIso)
    const end = new Date()
    const minutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000))

    await db.sessions.add({
      id: newId('session'),
      date: selectedDate,
      resourceId: activeSession.resourceId,
      ability: primaryAbility(resource),
      startTime: formatClock(start),
      endTime: formatClock(end),
      minutes,
      note: '计时打卡',
      planItemId: activeSession.planItemId,
      createdAt: new Date().toISOString(),
    })

    if (activeSession.planItemId) {
      await db.planItems.update(activeSession.planItemId, { status: 'done' })
    }

    setActiveSession(null)
    await loadData(selectedDate)
    showToast('计时已保存')
  }

  const addManualSession = async () => {
    if (!selectedManualResource) {
      showToast('请先选择资源')
      return
    }

    await db.sessions.add({
      id: newId('session'),
      date: manualDraft.date,
      resourceId: selectedManualResource.id,
      ability: manualDraft.ability,
      startTime: '',
      endTime: '',
      minutes: Math.max(1, Number(manualDraft.minutes) || 1),
      note: manualDraft.note.trim(),
      createdAt: new Date().toISOString(),
    })
    setManualDraft((draft) => ({ ...draft, note: '' }))
    await loadData(manualDraft.date)
    showToast('补录已保存')
  }

  const deleteSession = async (sessionId: string) => {
    await db.sessions.delete(sessionId)
    await loadData(selectedDate)
    showToast('记录已删除')
  }

  const updateSettings = async (patch: Partial<AppSettings>) => {
    if (!settings) {
      return
    }

    const next = { ...settings, ...patch }
    await db.settings.put(next)
    setSettings(next)
    showToast('设置已保存')
  }

  const uploadAvatar = async (file: File | undefined) => {
    if (!file) {
      return
    }

    if (!file.type.startsWith('image/')) {
      showToast('请选择图片文件')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      void updateSettings({
        childAvatarId: 'custom-upload',
        childAvatarDataUrl: String(reader.result),
      })
    }
    reader.readAsDataURL(file)
  }

  const importBackupFile = async (file: File | undefined) => {
    if (!file) {
      return
    }

    try {
      const text = await file.text()
      await replaceAllData(parseBackup(text))
      await loadData(selectedDate)
      showToast('备份已导入')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '导入失败')
    }
  }

  const saveCloudConfig = () => {
    saveSyncConfig(syncConfig)
    showToast('同步配置已保存')
  }

  const checkCloudStatus = async () => {
    setSyncBusy(true)
    try {
      const remote = await fetchRemoteData(syncConfig)
      setRemoteSnapshot(remote)
      showToast(remote.exists ? `云端版本 ${remote.revision}` : '云端还没有数据')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '检查云端失败')
    } finally {
      setSyncBusy(false)
    }
  }

  const pullCloudData = async () => {
    setSyncBusy(true)
    try {
      const remote = await fetchRemoteData(syncConfig)
      setRemoteSnapshot(remote)
      if (!remote.exists || !remote.data) {
        showToast('云端还没有数据')
        return
      }

      await replaceAllData(remote.data)
      await loadData(selectedDate)
      showToast(`已拉取云端版本 ${remote.revision}`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '拉取云端失败')
    } finally {
      setSyncBusy(false)
    }
  }

  const pushCloudData = async () => {
    if (!settings) {
      return
    }

    setSyncBusy(true)
    try {
      const remote = await fetchRemoteData(syncConfig)
      const localData = await readAllData()
      const result = await pushRemoteData(syncConfig, localData, remote.revision)
      setRemoteSnapshot({ ...result, data: localData })
      showToast(`已上传云端版本 ${result.revision}`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '上传云端失败')
    } finally {
      setSyncBusy(false)
    }
  }

  if (!ready || !settings) {
    return (
      <main className="loading-screen">
        <Clock3 aria-hidden="true" />
        <span>正在打开学习记录...</span>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <AvatarBadge avatar={selectedAvatar} className="brand-avatar" dataUrl={settings.childAvatarDataUrl} />
          <div>
            <strong>英语启蒙打卡</strong>
            <span>{settings.childName}</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="主导航">
          {viewItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                className={view === item.id ? 'nav-item active' : 'nav-item'}
                onClick={() => setView(item.id)}
              >
                <Icon size={18} aria-hidden="true" />
                {item.label}
              </button>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <span>本地保存</span>
          <strong>IndexedDB</strong>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">每日工作台</p>
            <h1>
              {view === 'today'
                ? `${settings.childName || '孩子'}今日计划与时间轴`
                : viewItems.find((item) => item.id === view)?.label}
            </h1>
          </div>
          <div className="date-controls">
            <label>
              <span>日期</span>
              <input type="date" value={selectedDate} onChange={(event) => void selectDate(event.target.value)} />
            </label>
            <button type="button" className="ghost-button" onClick={() => void selectDate(todayKey())}>
              <RotateCcw size={16} aria-hidden="true" />
              今天
            </button>
          </div>
        </header>

        {view === 'today' && (
          <section className="today-layout">
            <div className="primary-column">
              <div className="metric-row">
                <Metric label="今日计划" value={formatMinutes(todayPlanned)} icon={<ListChecks size={18} />} />
                <Metric label="已记录" value={formatMinutes(todayActual)} icon={<Clock3 size={18} />} />
                <Metric label="待补足" value={formatMinutes(todayRemaining)} icon={<CalendarDays size={18} />} />
              </div>

              <section className="panel">
                <div className="section-head">
                  <div>
                    <h2>今日计划</h2>
                    <p>固定课表会自动同步；其他内容从下方建议里选择加入。</p>
                  </div>
                  <button type="button" className="ghost-button" onClick={regenerateSelectedDate}>
                    <RotateCcw size={16} aria-hidden="true" />
                    同步课表
                  </button>
                </div>

                <div className="plan-list">
                  {datePlans.length === 0 ? (
                    <EmptyState text="今天没有固定课表项目，可以从下方建议里添加阅读或熏听。" />
                  ) : (
                    datePlans.map((plan) => {
                      const resource = getResource(resources, plan.resourceId)
                      const isActive = activeSession?.planItemId === plan.id
                      return (
                        <article key={plan.id} className={`plan-row ${plan.status}`}>
                          <span className="resource-dot" style={{ background: resource?.color }} />
                          <div className="plan-main">
                            <strong>{resource?.name ?? '未知资源'}</strong>
                            <span>
                              {formatMinutes(plan.plannedMinutes)} · {sourceLabels[plan.source]} ·{' '}
                              {resource ? abilityLabels[primaryAbility(resource)] : '未分类'}
                            </span>
                          </div>
                          <span className="status-pill">{statusLabels[plan.status]}</span>
                          <div className="row-actions">
                            {isActive ? (
                              <button
                                type="button"
                                className="icon-button strong"
                                title="结束计时"
                                aria-label="结束计时"
                                onClick={stopActiveSession}
                              >
                                <Square size={16} aria-hidden="true" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="icon-button"
                                title="开始计时"
                                aria-label="开始计时"
                                onClick={() => startPlan(plan)}
                                disabled={plan.status === 'done'}
                              >
                                <Play size={16} aria-hidden="true" />
                              </button>
                            )}
                            <button
                              type="button"
                              className="icon-button"
                              title="按计划完成"
                              aria-label="按计划完成"
                              onClick={() => completeAsPlanned(plan)}
                              disabled={plan.status === 'done'}
                            >
                              <CheckCircle2 size={16} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="icon-button"
                              title="跳过"
                              aria-label="跳过"
                              onClick={() => skipPlan(plan)}
                              disabled={plan.status === 'done'}
                            >
                              <SkipForward size={16} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="icon-button"
                              title="移除计划项"
                              aria-label="移除计划项"
                              onClick={() => deletePlanItem(plan)}
                            >
                              <Trash2 size={16} aria-hidden="true" />
                            </button>
                          </div>
                        </article>
                      )
                    })
                  )}
                </div>

                <div className="suggestion-block">
                  <div className="suggestion-head">
                    <h3>可添加建议</h3>
                    <span>自己选择内容，系统给出推荐时长</span>
                  </div>
                  <div className="suggestion-picker">
                    <label>
                      <span>类型</span>
                      <select
                        value={selectedSuggestionCategory}
                        onChange={(event) => {
                          setSelectedSuggestionCategory(event.target.value as Ability)
                          setSelectedSuggestionResourceId('')
                        }}
                      >
                        {abilityOrder.map((ability) => (
                          <option key={ability} value={ability}>
                            {categoryLabels[ability]}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      <span>二级内容</span>
                      <select
                        value={
                          selectedSuggestionResource &&
                          suggestionResourceOptions.some((resource) => resource.id === selectedSuggestionResource.id)
                            ? selectedSuggestionResource.id
                            : ''
                        }
                        onChange={(event) => setSelectedSuggestionResourceId(event.target.value)}
                        disabled={suggestionResourceOptions.length === 0}
                      >
                        <option value="">
                          {suggestionResourceOptions.length === 0 ? '该类型今天暂无可添加内容' : '请选择具体内容'}
                        </option>
                        {suggestionResourceOptions.map((resource) => (
                          <option key={resource.id} value={resource.id}>
                            {resource.name} · {resourceTypeLabels[resource.type]}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="suggestion-preview">
                      {selectedSuggestionResource ? (
                        <>
                          <span className="resource-dot" style={{ background: selectedSuggestionResource.color }} />
                          <div>
                            <strong>{selectedSuggestionResource.name}</strong>
                            <span>
                              建议 {formatMinutes(selectedSuggestionMinutes)} ·{' '}
                              {abilityLabels[primaryAbility(selectedSuggestionResource)]}
                            </span>
                          </div>
                        </>
                      ) : (
                        <span>选择后显示建议时长和能力分类</span>
                      )}
                    </div>

                    <button
                      type="button"
                      className="ghost-button"
                      onClick={addSelectedSuggestionToPlan}
                      disabled={!selectedSuggestionResource}
                    >
                      <Plus size={15} aria-hidden="true" />
                      加入今日计划
                    </button>
                  </div>
                </div>
              </section>

              <section className="panel">
                <div className="section-head">
                  <div>
                    <h2>手动补录</h2>
                    <p>用于记录临时熏听、亲子阅读或课后复盘。</p>
                  </div>
                </div>
                <div className="manual-grid">
                  <label>
                    <span>补录日期</span>
                    <input
                      type="date"
                      value={manualDraft.date}
                      onChange={(event) => setManualDraft((draft) => ({ ...draft, date: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>类型</span>
                    <select
                      value={manualDraft.ability}
                      onChange={(event) => {
                        const ability = event.target.value as Ability
                        const firstResource = resourcesForCategory(enabledResources, ability)[0]
                        setManualDraft((draft) => ({
                          ...draft,
                          ability,
                          resourceId: firstResource?.id ?? '',
                        }))
                      }}
                    >
                      {abilityOrder.map((ability) => (
                        <option key={ability} value={ability}>
                          {categoryLabels[ability]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>二级内容</span>
                    <select
                      value={selectedManualResource?.id ?? ''}
                      onChange={(event) => setManualDraft((draft) => ({ ...draft, resourceId: event.target.value }))}
                      disabled={manualResourceOptions.length === 0}
                    >
                      {manualResourceOptions.length === 0 && <option value="">该类型暂无资源</option>}
                      {manualResourceOptions.map((resource) => (
                        <option key={resource.id} value={resource.id}>
                          {resource.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>分钟</span>
                    <input
                      type="number"
                      min={1}
                      value={manualDraft.minutes}
                      onChange={(event) =>
                        setManualDraft((draft) => ({ ...draft, minutes: Number(event.target.value) }))
                      }
                    />
                  </label>
                  <label className="wide-field">
                    <span>备注</span>
                    <input
                      value={manualDraft.note}
                      onChange={(event) => setManualDraft((draft) => ({ ...draft, note: event.target.value }))}
                      placeholder="例如：牛津树 2 本，Little Fox S1E3"
                    />
                  </label>
                  <button type="button" className="primary-button" onClick={addManualSession}>
                    <Plus size={16} aria-hidden="true" />
                    保存记录
                  </button>
                </div>
              </section>
            </div>

            <section className="panel timeline-panel">
              <div className="section-head">
                <div>
                  <h2>时间轴</h2>
                  <p>{selectedDate} 的实际记录。</p>
                </div>
              </div>
              <div className="timeline">
                {dateSessions.length === 0 ? (
                  <EmptyState text="还没有打卡记录。" />
                ) : (
                  dateSessions.map((session) => {
                    const resource = getResource(resources, session.resourceId)
                    return (
                      <article key={session.id} className="timeline-row">
                        <div className="time-range">
                          <strong>{session.startTime || '补录'}</strong>
                          {session.endTime ? <span>{session.endTime}</span> : <span>{session.date}</span>}
                        </div>
                        <div className="timeline-body">
                          <strong>{resource?.name ?? '未知资源'}</strong>
                          <span>
                            {formatMinutes(session.minutes)} · {abilityLabels[session.ability]}
                          </span>
                          {session.note && <p>{session.note}</p>}
                        </div>
                        <button
                          type="button"
                          className="icon-button"
                          title="删除记录"
                          aria-label="删除记录"
                          onClick={() => deleteSession(session.id)}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </article>
                    )
                  })
                )}
              </div>
            </section>
          </section>
        )}

        {view === 'analysis' && (
          <section className="analysis-layout">
            <div className="metric-row">
              <Metric label="本月总时长" value={formatMinutes(monthlySummary.totalMinutes)} icon={<Clock3 size={18} />} />
              <Metric label="计划完成率" value={`${monthlySummary.completionRate}%`} icon={<CheckCircle2 size={18} />} />
              <Metric
                label="日均时长"
                value={formatMinutes(Math.round(monthlySummary.totalMinutes / new Date(Number(selectedMonth.slice(0, 4)), Number(selectedMonth.slice(5, 7)), 0).getDate()))}
                icon={<BarChart3 size={18} />}
              />
            </div>

            <section className="panel">
              <div className="section-head">
                <div>
                  <h2>月度趋势</h2>
                  <p>计划分钟和实际分钟对比。</p>
                </div>
                <button type="button" className="ghost-button" onClick={generateMonthPlans}>
                  <CalendarDays size={16} aria-hidden="true" />
                  生成本月计划
                </button>
              </div>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={monthlySummary.byDay}>
                    <CartesianGrid stroke="#e7e4da" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={(value) => value.slice(8)} tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} width={34} />
                    <Tooltip />
                    <Line type="monotone" dataKey="planned" name="计划" stroke="#8f5f3f" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="actual" name="实际" stroke="#2f7d68" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            <div className="split-panels">
              <section className="panel">
                <div className="section-head">
                  <div>
                    <h2>按资源</h2>
                    <p>看教材和内容投入是否偏科。</p>
                  </div>
                </div>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={monthlySummary.byResource.slice(0, 8)}>
                      <CartesianGrid stroke="#e7e4da" vertical={false} />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} height={58} />
                      <YAxis tickLine={false} axisLine={false} width={34} />
                      <Tooltip />
                      <Bar dataKey="minutes" name="分钟" radius={[4, 4, 0, 0]}>
                        {monthlySummary.byResource.slice(0, 8).map((entry) => (
                          <Cell key={entry.id} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="panel">
                <div className="section-head">
                  <div>
                    <h2>按能力</h2>
                    <p>阅读、听力、口语和外教课配比。</p>
                  </div>
                </div>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={monthlySummary.byAbility}
                        dataKey="minutes"
                        nameKey="name"
                        innerRadius={58}
                        outerRadius={92}
                        paddingAngle={2}
                      >
                        {monthlySummary.byAbility.map((entry) => (
                          <Cell key={entry.ability} fill={abilityColors[entry.ability]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="legend-list">
                  {monthlySummary.byAbility.map((item) => (
                    <span key={item.ability}>
                      <i style={{ background: abilityColors[item.ability] }} />
                      {item.name} {formatMinutes(item.minutes)}
                    </span>
                  ))}
                </div>
              </section>
            </div>
          </section>
        )}

        {view === 'resources' && (
          <section className="settings-layout">
            <section className="panel" ref={resourceEditorRef}>
              <div className="section-head">
                <div>
                  <h2>{resourceDraft.id ? '编辑资源' : '新增资源'}</h2>
                  <p>默认时长和能力标签会进入计划生成与统计。</p>
                </div>
              </div>
              <div className="form-grid">
                <label>
                  <span>名称</span>
                  <input
                    value={resourceDraft.name}
                    onChange={(event) => setResourceDraft((draft) => ({ ...draft, name: event.target.value }))}
                    placeholder="例如：海尼曼 GK"
                  />
                </label>
                <label>
                  <span>类型</span>
                  <select
                    value={resourceDraft.type}
                    onChange={(event) =>
                      setResourceDraft((draft) => ({ ...draft, type: event.target.value as ResourceType }))
                    }
                  >
                    {Object.entries(resourceTypeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>能力</span>
                  <select
                    value={resourceDraft.ability}
                    onChange={(event) =>
                      setResourceDraft((draft) => ({ ...draft, ability: event.target.value as Ability }))
                    }
                  >
                    {Object.entries(abilityLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>默认分钟</span>
                  <input
                    type="number"
                    min={5}
                    value={resourceDraft.defaultMinutes}
                    onChange={(event) =>
                      setResourceDraft((draft) => ({ ...draft, defaultMinutes: Number(event.target.value) }))
                    }
                  />
                </label>
                <label>
                  <span>颜色</span>
                  <input
                    type="color"
                    value={resourceDraft.color}
                    onChange={(event) => setResourceDraft((draft) => ({ ...draft, color: event.target.value }))}
                  />
                </label>
                <label>
                  <span>启用</span>
                  <select
                    value={resourceDraft.enabled ? 'yes' : 'no'}
                    onChange={(event) =>
                      setResourceDraft((draft) => ({ ...draft, enabled: event.target.value === 'yes' }))
                    }
                  >
                    <option value="yes">启用</option>
                    <option value="no">停用</option>
                  </select>
                </label>
                <label className="wide-field">
                  <span>备注</span>
                  <input
                    value={resourceDraft.notes}
                    onChange={(event) => setResourceDraft((draft) => ({ ...draft, notes: event.target.value }))}
                    placeholder="适合记录级别、阶段或使用方式"
                  />
                </label>
                <div className="form-actions">
                  <button type="button" className="primary-button" onClick={saveResource}>
                    <Save size={16} aria-hidden="true" />
                    保存资源
                  </button>
                  <button type="button" className="ghost-button" onClick={() => setResourceDraft(emptyResourceDraft)}>
                    取消编辑
                  </button>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="section-head">
                <div>
                  <h2>资源库</h2>
                  <p>预置资源可直接使用，也可以停用或调整。</p>
                </div>
              </div>
              <div className="resource-table">
                {resources.map((resource) => (
                  <article
                    key={resource.id}
                    className={
                      `${resource.enabled ? 'resource-row' : 'resource-row muted'} ${resourceDraft.id === resource.id ? 'editing' : ''}`
                    }
                  >
                    <span className="resource-dot" style={{ background: resource.color }} />
                    <div>
                      <strong>{resource.name}</strong>
                      <span>
                        {resourceTypeLabels[resource.type]} · {abilityLabels[primaryAbility(resource)]} ·{' '}
                        {formatMinutes(resource.defaultMinutes)}
                      </span>
                    </div>
                    <button type="button" className="ghost-button compact" onClick={() => toggleResource(resource)}>
                      {resource.enabled ? '停用' : '启用'}
                    </button>
                    <button type="button" className="ghost-button compact" onClick={() => editResource(resource)}>
                      <Pencil size={16} aria-hidden="true" />
                      编辑
                    </button>
                  </article>
                ))}
              </div>
            </section>
          </section>
        )}

        {view === 'schedule' && (
          <section className="settings-layout">
            <section className="panel">
              <div className="section-head">
                <div>
                  <h2>{scheduleDraft.id ? '编辑课表' : '新增课表'}</h2>
                  <p>固定外教课会优先进入每日计划。</p>
                </div>
              </div>
              <div className="form-grid">
                <label>
                  <span>星期</span>
                  <select
                    value={scheduleDraft.weekday}
                    onChange={(event) =>
                      setScheduleDraft((draft) => ({ ...draft, weekday: Number(event.target.value) }))
                    }
                  >
                    {weekdays.map((weekday, index) => (
                      <option key={weekday} value={index}>
                        {weekday}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>开始时间</span>
                  <input
                    type="time"
                    value={scheduleDraft.startTime}
                    onChange={(event) => setScheduleDraft((draft) => ({ ...draft, startTime: event.target.value }))}
                  />
                </label>
                <label>
                  <span>资源</span>
                  <select
                    value={scheduleDraft.resourceId}
                    onChange={(event) => setScheduleDraft((draft) => ({ ...draft, resourceId: event.target.value }))}
                  >
                    {resources.map((resource) => (
                      <option key={resource.id} value={resource.id}>
                        {resource.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>分钟</span>
                  <input
                    type="number"
                    min={5}
                    value={scheduleDraft.minutes}
                    onChange={(event) =>
                      setScheduleDraft((draft) => ({ ...draft, minutes: Number(event.target.value) }))
                    }
                  />
                </label>
                <label>
                  <span>状态</span>
                  <select
                    value={scheduleDraft.enabled ? 'yes' : 'no'}
                    onChange={(event) =>
                      setScheduleDraft((draft) => ({ ...draft, enabled: event.target.value === 'yes' }))
                    }
                  >
                    <option value="yes">启用</option>
                    <option value="no">停用</option>
                  </select>
                </label>
                <div className="form-actions">
                  <button type="button" className="primary-button" onClick={saveSchedule}>
                    <Save size={16} aria-hidden="true" />
                    保存课表
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setScheduleDraft((draft) => ({ ...emptyScheduleDraft, resourceId: draft.resourceId }))}
                  >
                    取消编辑
                  </button>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="section-head">
                <div>
                  <h2>每周课表</h2>
                  <p>用于生成每一天的固定课程。</p>
                </div>
              </div>
              <div className="schedule-list">
                {schedules
                  .slice()
                  .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime))
                  .map((schedule) => {
                    const resource = getResource(resources, schedule.resourceId)
                    return (
                      <article key={schedule.id} className={schedule.enabled ? 'schedule-row' : 'schedule-row muted'}>
                        <div className="schedule-time">
                          <strong>{weekdays[schedule.weekday]}</strong>
                          <span>{schedule.startTime}</span>
                        </div>
                        <div>
                          <strong>{resource?.name ?? '未知资源'}</strong>
                          <span>{formatMinutes(schedule.minutes)}</span>
                        </div>
                        <button
                          type="button"
                          className="icon-button"
                          title="编辑课表"
                          aria-label="编辑课表"
                          onClick={() => editSchedule(schedule)}
                        >
                          <Pencil size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          title="删除课表"
                          aria-label="删除课表"
                          onClick={() => deleteSchedule(schedule.id)}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </article>
                    )
                  })}
              </div>
            </section>
          </section>
        )}

        {view === 'data' && (
          <section className="settings-layout">
            <section className="panel">
              <div className="section-head">
                <div>
                  <h2>孩子档案与计划强度</h2>
                  <p>姓名、出生年月和头像会用于工作台显示。</p>
                </div>
              </div>

              <div className="child-profile">
                <div className="child-card">
                  <AvatarBadge avatar={selectedAvatar} className="profile-avatar" dataUrl={settings.childAvatarDataUrl} />
                  <div>
                    <strong>{settings.childName || '小朋友'}</strong>
                    <span>{childAgeLabel}</span>
                  </div>
                </div>

                <div className="form-grid profile-form">
                  <label>
                    <span>名字</span>
                    <input
                      value={settings.childName}
                      onChange={(event) => updateSettings({ childName: event.target.value })}
                      placeholder="例如：Emma"
                    />
                  </label>
                  <label>
                    <span>出生年份</span>
                    <select
                      value={settings.childBirthYear}
                      onChange={(event) => updateSettings({ childBirthYear: Number(event.target.value) })}
                    >
                      {birthYears.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>出生月份</span>
                    <select
                      value={settings.childBirthMonth}
                      onChange={(event) => updateSettings({ childBirthMonth: Number(event.target.value) })}
                    >
                      {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                        <option key={month} value={month}>
                          {month}月
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>当前年龄</span>
                    <input value={childAgeLabel} readOnly />
                  </label>
                  <label>
                    <span>强度</span>
                    <select
                      value={settings.dailyIntensity}
                      onChange={(event) => {
                        const intensity = event.target.value as DailyIntensity
                        const target =
                          intensity === 'light'
                            ? { targetMinMinutes: 30, targetMaxMinutes: 45 }
                            : intensity === 'high'
                              ? { targetMinMinutes: 75, targetMaxMinutes: 120 }
                              : { targetMinMinutes: 45, targetMaxMinutes: 75 }
                        updateSettings({ dailyIntensity: intensity, ...target })
                      }}
                    >
                      {Object.entries(intensityLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>每日下限</span>
                    <input
                      type="number"
                      value={settings.targetMinMinutes}
                      onChange={(event) => updateSettings({ targetMinMinutes: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    <span>每日上限</span>
                    <input
                      type="number"
                      value={settings.targetMaxMinutes}
                      onChange={(event) => updateSettings({ targetMaxMinutes: Number(event.target.value) })}
                    />
                  </label>
                </div>
              </div>

              <div className="avatar-section">
                <div>
                  <h3>头像选择</h3>
                  <span>原创主题头像：公主系、冰雪系、小猪系。</span>
                </div>
                <div className="avatar-grid">
                  {avatarOptions.map((avatar) => (
                    <button
                      key={avatar.id}
                      type="button"
                      className={settings.childAvatarId === avatar.id ? 'avatar-option active' : 'avatar-option'}
                      onClick={() => updateSettings({ childAvatarId: avatar.id, childAvatarDataUrl: '' })}
                    >
                      <AvatarBadge avatar={avatar} />
                      <strong>{avatar.label}</strong>
                      <span>{avatar.group}</span>
                    </button>
                  ))}
                </div>
                <div className="avatar-upload-row">
                  <label className="file-button avatar-upload">
                    <Upload size={16} aria-hidden="true" />
                    上传本地头像
                    <input type="file" accept="image/*" onChange={(event) => uploadAvatar(event.target.files?.[0])} />
                  </label>
                  {settings.childAvatarDataUrl && (
                    <span className="avatar-upload-note">当前使用本地上传头像，数据保存在本机浏览器。</span>
                  )}
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="section-head">
                <div>
                  <h2>服务器同步</h2>
                  <p>连接自己的 SQLite 同步服务，多台设备使用同一份学习记录。</p>
                </div>
              </div>
              <div className="sync-grid">
                <label>
                  <span>同步地址</span>
                  <input
                    value={syncConfig.baseUrl}
                    onChange={(event) => setSyncConfig((config) => ({ ...config, baseUrl: event.target.value }))}
                    placeholder="留空使用当前域名，或填写 https://api.example.com"
                  />
                </label>
                <label>
                  <span>数据空间</span>
                  <input
                    value={syncConfig.datasetId}
                    onChange={(event) => setSyncConfig((config) => ({ ...config, datasetId: event.target.value }))}
                    placeholder="default"
                  />
                </label>
                <label>
                  <span>同步密钥</span>
                  <input
                    type="password"
                    value={syncConfig.token}
                    onChange={(event) => setSyncConfig((config) => ({ ...config, token: event.target.value }))}
                    placeholder="服务器 SYNC_TOKEN"
                  />
                </label>
              </div>
              <div className="sync-actions">
                <button type="button" className="ghost-button" onClick={saveCloudConfig} disabled={syncBusy}>
                  <Save size={16} aria-hidden="true" />
                  保存配置
                </button>
                <button type="button" className="ghost-button" onClick={checkCloudStatus} disabled={syncBusy}>
                  <Database size={16} aria-hidden="true" />
                  检查云端
                </button>
                <button type="button" className="ghost-button" onClick={pullCloudData} disabled={syncBusy}>
                  <Download size={16} aria-hidden="true" />
                  拉取云端
                </button>
                <button type="button" className="primary-button" onClick={pushCloudData} disabled={syncBusy}>
                  <Upload size={16} aria-hidden="true" />
                  上传本机
                </button>
              </div>
              <div className="storage-note">
                <strong>云端状态</strong>
                <span>
                  {remoteSnapshot
                    ? remoteSnapshot.exists
                      ? `版本 ${remoteSnapshot.revision} · ${remoteSnapshot.updatedAt ?? '未知时间'}`
                      : '云端还没有数据'
                    : '尚未检查云端'}
                </span>
              </div>
            </section>

            <section className="panel">
              <div className="section-head">
                <div>
                  <h2>导出与备份</h2>
                  <p>数据只保存在本机浏览器，建议定期导出 JSON 备份。</p>
                </div>
              </div>
              <div className="data-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => exportBackup({ resources, schedules, planItems, sessions, settings })}
                >
                  <Download size={16} aria-hidden="true" />
                  导出 JSON 备份
                </button>
                <label className="file-button">
                  <Upload size={16} aria-hidden="true" />
                  导入 JSON 备份
                  <input type="file" accept="application/json" onChange={(event) => importBackupFile(event.target.files?.[0])} />
                </label>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => exportMonthCsv(selectedMonth, resources, planItems, sessions)}
                >
                  <Download size={16} aria-hidden="true" />
                  导出 CSV 月报
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() =>
                    void exportMonthWorkbook(selectedMonth, resources, planItems, sessions).then(() =>
                      showToast('XLSX 月报已导出'),
                    )
                  }
                >
                  <FileSpreadsheet size={16} aria-hidden="true" />
                  导出 XLSX 月报
                </button>
              </div>
              <div className="storage-note">
                <strong>当前保存位置</strong>
                <span>
                  数据保存在当前浏览器的 IndexedDB：english-learning-tracker。两个人在不同电脑或不同浏览器打开时不会自动同频，需要后续接入云端或家用共享服务器。
                </span>
              </div>
            </section>
          </section>
        )}
      </main>

      <aside className="inspector">
        <section className="inspector-block">
          <p className="eyebrow">{selectedMonth} 汇总</p>
          <strong>{formatMinutes(monthlySummary.totalMinutes)}</strong>
          <span>计划 {formatMinutes(monthlySummary.plannedMinutes)} · 完成率 {monthlySummary.completionRate}%</span>
        </section>

        <section className="inspector-block">
          <h2>今日能力匹配</h2>
          <div className="ability-donut-wrap">
            <div className="ability-donut" style={{ '--donut': todayAbilityGradient } as React.CSSProperties}>
              <div className="donut-center">
                <strong>{compactMinutes(todayPlanAbilityTotal)}</strong>
                <span>今日计划</span>
              </div>
            </div>
            <div className="donut-legend">
              {todayAbilityBreakdown.map((item) => {
                const Icon =
                  item.ability === 'reading'
                    ? BookOpen
                    : item.ability === 'listening'
                      ? Headphones
                      : item.ability === 'speaking'
                        ? Mic2
                        : UsersRound
                return (
                  <div key={item.ability} className="donut-legend-row">
                    <Icon size={15} aria-hidden="true" />
                    <i style={{ background: item.color }} />
                    <span>{item.name}</span>
                    <strong>{item.percent}%</strong>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        <section className="inspector-block">
          <h2>调整建议</h2>
          <ul className="advice-list">
            {advice.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </aside>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function AvatarBadge({
  avatar,
  className = '',
  dataUrl = '',
}: {
  avatar: AvatarOption
  className?: string
  dataUrl?: string
}) {
  const Icon = avatar.icon

  return (
    <span
      className={`avatar-badge ${className}`}
      style={
        {
          '--avatar-a': avatar.colors[0],
          '--avatar-b': avatar.colors[1],
        } as React.CSSProperties
      }
    >
      {dataUrl ? <img src={dataUrl} alt="" /> : <Icon size={20} strokeWidth={2.4} aria-hidden="true" />}
    </span>
  )
}

function Metric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="metric">
      <span>{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>
}

export default App
