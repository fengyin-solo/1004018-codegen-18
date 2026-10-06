import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  CalibrationOverview,
  CalibrationScheduleRow,
  EntryRow,
  FlowPauseTodoRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 校准排程、测点暂停待办与业务模块共用同一份 localStorage，只是不进模块元数据。
const SCHEDULE_KEY = 'calibration_schedule'
const FLOW_TODO_KEY = 'flow_pause_todo'
const ACTIVE_SCHEDULE_STATUSES = ['待校准', '校准中']
const DEVICE_FAULT_STATUS = '已故障'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

/* ------------------------- 监测设备校准排程 ------------------------- */

export type CalibrationDraft = {
  deviceId: number
  periodDays: number | null
  durationDays: number
  plannedStart: string
  selected: boolean
}

export type CalibrationCandidate = {
  device: EntryRow
  missing: string[]
  isFault: boolean
  suggestedStart: string
  draft: CalibrationDraft
}

export type CalibrationGroup = {
  key: string
  label: string
  devices: CalibrationCandidate[]
}

export type ScheduleSubmitItem = {
  deviceId: number
  periodDays: number
  durationDays: number
  plannedStart: string
}

export type ScheduleSubmitResult = {
  accepted: CalibrationScheduleRow[]
  rejected: CalibrationScheduleRow[]
  todos: FlowPauseTodoRow[]
  message: string
}

function scheduleRows(): CalibrationScheduleRow[] {
  return listRows(SCHEDULE_KEY) as CalibrationScheduleRow[]
}

function flowTodoRows(): FlowPauseTodoRow[] {
  return listRows(FLOW_TODO_KEY) as FlowPauseTodoRow[]
}

function nextId(rows: { id: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function nowText(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function parseDate(value: string): Date | null {
  const text = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null
  }
  const [year, month, day] = text.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return date
}

function formatDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function addDays(value: string, days: number): string {
  const base = parseDate(value)
  if (!base) {
    return ''
  }
  return formatDate(new Date(base.getFullYear(), base.getMonth(), base.getDate() + days))
}

/** 校准周期支持「180天 / 12月 / 6个月」，解析不出就按没有参数处理。 */
export function parsePeriodDays(raw: string): number | null {
  const text = String(raw ?? '').trim()
  const matched = text.match(/^(\d+)\s*(天|日|个月?|月)$/)
  if (!matched) {
    return null
  }
  const amount = Number(matched[1])
  if (!Number.isFinite(amount) || amount <= 0) {
    return null
  }
  return matched[2] === '天' || matched[2] === '日' ? amount : amount * 30
}

function missingFieldsOf(device: EntryRow): string[] {
  const missing: string[] = []
  if (String(device['安装位置'] ?? '').trim() === '') {
    missing.push('安装位置')
  }
  if (String(device['校准周期'] ?? '').trim() === '' || parsePeriodDays(String(device['校准周期'])) === null) {
    missing.push('校准周期')
  }
  if (parseDate(String(device['最近校准'] ?? '')) === null) {
    missing.push('最近校准')
  }
  return missing
}

/** 排程候选：已故障设备直接剔除不进队列；缺安装位置/校准参数的设备保留并标出待补项。 */
export function calibrationCandidates(): CalibrationCandidate[] {
  const devices = listRows('monitor_device')
  return devices
    .filter((device) => String(device.status) !== DEVICE_FAULT_STATUS)
    .map((device) => {
      const missing = missingFieldsOf(device)
      const periodDays = parsePeriodDays(String(device['校准周期'] ?? ''))
      const last = String(device['最近校准'] ?? '')
      const suggestedStart = missing.length === 0 && periodDays !== null
        ? addDays(last, periodDays)
        : formatDate(new Date())
      return {
        device,
        missing,
        isFault: false,
        suggestedStart,
        draft: {
          deviceId: Number(device.id),
          periodDays,
          durationDays: 1,
          plannedStart: suggestedStart,
          selected: false,
        },
      }
    })
}

export function excludedFaultDevices(): EntryRow[] {
  return listRows('monitor_device').filter((device) => String(device.status) === DEVICE_FAULT_STATUS)
}

/** 按设备类型、安装位置、最近校准时间分组（最近校准精确到月，同一批校准的设备聚在一起）。 */
export function calibrationGroups(): CalibrationGroup[] {
  const buckets = new Map<string, CalibrationGroup>()
  for (const candidate of calibrationCandidates()) {
    const device = candidate.device
    const last = String(device['最近校准'] ?? '').trim()
    const recentKey = parseDate(last) ? last.slice(0, 7) : 'unknown'
    const recentLabel = recentKey === 'unknown' ? '最近校准缺失' : `${recentKey} 校准`
    const location = String(device['安装位置'] ?? '').trim() || '安装位置待补'
    const key = `${String(device['设备类型'] ?? '未分类')}|${location}|${recentKey}`
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        label: `${device['设备类型'] || '未分类'} · ${location} · ${recentLabel}`,
        devices: [],
      })
    }
    buckets.get(key)!.devices.push(candidate)
  }
  return [...buckets.values()].sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
}

function isActive(row: { status: string }): boolean {
  return ACTIVE_SCHEDULE_STATUSES.includes(String(row.status))
}

/** 同一设备不能排入重叠时段：只与仍有效的排程（待校准/校准中）比较。 */
function overlapIn(
  rows: CalibrationScheduleRow[],
  deviceId: number,
  start: string,
  end: string,
): CalibrationScheduleRow | null {
  for (const row of rows) {
    if (!isActive(row) || Number(row.deviceId) !== deviceId) {
      continue
    }
    if (start <= String(row['计划结束']) && end >= String(row['计划开始'])) {
      return row
    }
  }
  return null
}

/** 重复提交只保留首个有效排程：同设备、同时段、同周期已存在即视为重复。 */
function duplicateIn(
  rows: CalibrationScheduleRow[],
  item: ScheduleSubmitItem,
  end: string,
): CalibrationScheduleRow | null {
  return (
    rows.find(
      (row) =>
        isActive(row) &&
        Number(row.deviceId) === item.deviceId &&
        String(row['计划开始']) === item.plannedStart &&
        String(row['计划结束']) === end &&
        Number(row['校准周期']) === item.periodDays,
    ) ?? null
  )
}

function failedSchedules(deviceId?: number): CalibrationScheduleRow[] {
  return scheduleRows().filter(
    (row) => String(row.status) === '提交失败' && (deviceId === undefined || Number(row.deviceId) === deviceId),
  )
}

function makeScheduleRow(
  device: EntryRow,
  item: ScheduleSubmitItem,
  status: string,
  reason: string,
  id: number,
): CalibrationScheduleRow {
  const safeDuration = Math.max(Math.trunc(item.durationDays) || 1, 1)
  return {
    id,
    status,
    pending: status !== '已完成' && status !== '已取消',
    abnormal: status === '提交失败',
    scheduleNo: `CAL-${String(id).padStart(4, '0')}`,
    deviceId: Number(device.id),
    设备编号: String(device['设备编号'] ?? ''),
    设备类型: String(device['设备类型'] ?? ''),
    安装位置: String(device['安装位置'] ?? ''),
    校准周期: String(item.periodDays),
    最近校准: String(device['最近校准'] ?? ''),
    计划开始: item.plannedStart,
    计划结束: addDays(item.plannedStart, safeDuration - 1),
    失败原因: reason,
    提交时间: nowText(),
  }
}

/** 为有效排程在流量监测页生成对应测点的暂停待办；在线测点才生成，重复提交不重复生成。 */
function syncFlowTodo(
  schedule: CalibrationScheduleRow,
  existing: FlowPauseTodoRow[],
  idSeed: number,
): { todo: FlowPauseTodoRow | null; id: number } {
  const location = String(schedule['安装位置'] ?? '').trim()
  if (!location) {
    return { todo: null, id: idSeed }
  }
  const points = listRows('flow_monitor').filter(
    (point) => String(point['监测点位'] ?? '').trim() === location,
  )
  const pointNos = new Set(points.map((point) => String(point['监测点编号'])))
  const duplicated = existing.some(
    (todo) =>
      ['待暂停', '已暂停', '待恢复'].includes(String(todo.status)) &&
      (String(todo.scheduleNo) === schedule.scheduleNo || pointNos.has(String(todo['监测点编号']))),
  )
  if (duplicated) {
    return { todo: null, id: idSeed }
  }
  const point = points.find((entry) => String(entry.status) === '在线')
  if (!point) {
    return { todo: null, id: idSeed }
  }
  const todo: FlowPauseTodoRow = {
    id: idSeed,
    status: '待暂停',
    pending: true,
    abnormal: false,
    todoNo: `PAU-${String(idSeed).padStart(4, '0')}`,
    scheduleNo: schedule.scheduleNo,
    deviceId: Number(schedule.deviceId),
    监测点编号: String(point['监测点编号'] ?? ''),
    监测点位: location,
    关联设备: String(schedule['设备编号'] ?? ''),
    校准开始: String(schedule['计划开始']),
    校准结束: String(schedule['计划结束']),
    生成时间: nowText(),
  }
  return { todo, id: idSeed + 1 }
}

function markDevicePending(deviceIds: number[]): void {
  const rows = listRows('monitor_device')
  const ids = new Set(deviceIds)
  let changed = false
  const next = rows.map((row) => {
    if (!ids.has(Number(row.id)) || String(row.status) === DEVICE_FAULT_STATUS) {
      return row
    }
    changed = true
    return { ...row, status: '待校准', pending: true }
  })
  if (changed) {
    saveRows('monitor_device', next)
  }
}

type EvaluateResult = {
  accepted: CalibrationScheduleRow[]
  rejected: CalibrationScheduleRow[]
  nextRows: CalibrationScheduleRow[]
  todos: FlowPauseTodoRow[]
  createdTodos: FlowPauseTodoRow[]
}

/** 纯校验：逐条判定，不写存储。excludeScheduleId 用于重试时先在视图里摘掉旧的失败条目。 */
function evaluateSchedules(
  items: ScheduleSubmitItem[],
  excludeScheduleId?: number,
): EvaluateResult {
  const devices = listRows('monitor_device')
  const nextRows = scheduleRows().filter((row) => Number(row.id) !== excludeScheduleId)
  // ID 仍按全表（含被摘除条目）递增，避免重试后重用旧编号。
  let nextScheduleId = nextId(scheduleRows())
  const todos = [...flowTodoRows()]
  let nextTodoId = nextId(todos)

  const accepted: CalibrationScheduleRow[] = []
  const rejected: CalibrationScheduleRow[] = []

  for (const item of items) {
    const device = devices.find((row) => Number(row.id) === Number(item.deviceId))
    if (!device) {
      const fallback: EntryRow = {
        id: item.deviceId,
        status: '记录缺失',
        pending: false,
        abnormal: true,
        设备编号: '—',
      }
      rejected.push(makeScheduleRow(fallback, item, '提交失败', '设备记录不存在', nextScheduleId++))
      continue
    }
    if (String(device.status) === DEVICE_FAULT_STATUS) {
      rejected.push(makeScheduleRow(device, item, '提交失败', '设备已故障，不得进入正常校准队列', nextScheduleId++))
      continue
    }
    if (!String(device['安装位置'] ?? '').trim()) {
      rejected.push(makeScheduleRow(device, item, '提交失败', '缺少安装位置，待补录后重试', nextScheduleId++))
      continue
    }
    if (parseDate(item.plannedStart) === null) {
      rejected.push(makeScheduleRow(device, item, '提交失败', '计划开始日期无效（应为 YYYY-MM-DD）', nextScheduleId++))
      continue
    }
    if (!Number.isFinite(item.periodDays) || item.periodDays <= 0) {
      rejected.push(makeScheduleRow(device, item, '提交失败', '校准周期无效，需补录校准周期', nextScheduleId++))
      continue
    }
    const safeDuration = Math.max(Math.trunc(item.durationDays) || 1, 1)
    const end = addDays(item.plannedStart, safeDuration - 1)
    const duplicate = duplicateIn(nextRows, item, end)
    if (duplicate) {
      rejected.push(
        makeScheduleRow(device, item, '提交失败', `与首个有效排程 ${duplicate.scheduleNo} 重复，仅保留首个`, nextScheduleId++),
      )
      continue
    }
    const overlap = overlapIn(nextRows, Number(device.id), item.plannedStart, end)
    if (overlap) {
      rejected.push(
        makeScheduleRow(device, item, '提交失败', `与排程 ${overlap.scheduleNo}（${overlap['计划开始']}~${overlap['计划结束']}）时段重叠`, nextScheduleId++),
      )
      continue
    }
    const row = makeScheduleRow(device, item, '待校准', '', nextScheduleId++)
    nextRows.push(row)
    accepted.push(row)
    const synced = syncFlowTodo(row, todos, nextTodoId)
    nextTodoId = synced.id
    if (synced.todo) {
      todos.push(synced.todo)
    }
  }

  return { accepted, rejected, nextRows, todos, createdTodos: todos.filter((todo) => accepted.some((row) => row.scheduleNo === todo.scheduleNo)) }
}

function resultMessage(accepted: CalibrationScheduleRow[], rejected: CalibrationScheduleRow[]): string {
  return rejected.length === 0
    ? `已提交 ${accepted.length} 条有效排程`
    : `有效 ${accepted.length} 条，失败 ${rejected.length} 条，失败条目可补录或重试`
}

/** 一次提交多条设备排程：逐条校验，有效落库，失败（缺项/重叠/重复/故障）保留成可重试条目。 */
export function submitCalibrationSchedules(items: ScheduleSubmitItem[]): ScheduleSubmitResult {
  const evaluated = evaluateSchedules(items)
  evaluated.nextRows.push(...evaluated.rejected)
  saveRows(SCHEDULE_KEY, evaluated.nextRows)
  if (evaluated.accepted.length > 0) {
    saveRows(FLOW_TODO_KEY, evaluated.todos)
    markDevicePending(evaluated.accepted.map((row) => Number(row.deviceId)))
  }
  return {
    accepted: evaluated.accepted,
    rejected: evaluated.rejected,
    todos: evaluated.createdTodos,
    message: resultMessage(evaluated.accepted, evaluated.rejected),
  }
}

export function listCalibrationSchedules(): CalibrationScheduleRow[] {
  return scheduleRows().sort((a, b) => Number(b.id) - Number(a.id))
}

/** 给失败条目补录缺失的设备信息（安装位置/校准周期/最近校准），写回设备档案。 */
export function supplementDevice(
  deviceId: number,
  patch: { 安装位置?: string; 校准周期?: string; 最近校准?: string },
): ActionResult {
  const rows = listRows('monitor_device')
  const index = rows.findIndex((row) => Number(row.id) === deviceId)
  if (index < 0) {
    return { ok: false, message: '没有找到对应设备' }
  }
  const updated: EntryRow = { ...rows[index] }
  if (patch.安装位置 !== undefined) {
    updated['安装位置'] = patch.安装位置.trim()
  }
  if (patch.校准周期 !== undefined) {
    const days = parsePeriodDays(patch.校准周期)
    if (days === null) {
      return { ok: false, message: '校准周期格式无效，示例：180天 / 6个月' }
    }
    updated['校准周期'] = patch.校准周期.trim()
  }
  if (patch.最近校准 !== undefined) {
    if (parseDate(patch.最近校准) === null) {
      return { ok: false, message: '最近校准日期格式无效，应为 YYYY-MM-DD' }
    }
    updated['最近校准'] = patch.最近校准.trim()
  }
  const stillMissing = missingFieldsOf(updated)
  if (stillMissing.length > 0) {
    return { ok: false, message: `仍缺少：${stillMissing.join('、')}` }
  }
  const next = [...rows]
  next[index] = updated
  saveRows('monitor_device', next)
  return { ok: true, message: '待补项已补齐' }
}

/** 失败条目重试：按补录后的设备档案重新取周期等参数，干跑校验通过才替换旧条目，失败则原样保留。 */
export function retryCalibrationSchedule(scheduleId: number): ActionResult {
  const rows = scheduleRows()
  const target = rows.find((row) => Number(row.id) === scheduleId)
  if (!target) {
    return { ok: false, message: '没有找到该排程记录' }
  }
  if (String(target.status) !== '提交失败') {
    return { ok: false, message: '只有提交失败的条目可以重试' }
  }
  const startDate = parseDate(String(target['计划开始']))
  const endDate = parseDate(String(target['计划结束']))
  if (startDate === null || endDate === null) {
    return { ok: false, message: '排程记录的计划时段已损坏，请重新提交' }
  }
  const device = listRows('monitor_device').find((row) => Number(row.id) === Number(target.deviceId))
  if (!device) {
    return { ok: false, message: '设备记录不存在' }
  }
  // 周期以补录后的设备档案为准，计划开始沿用失败条目（用户可在重新提交时另行调整）。
  const periodDays = parsePeriodDays(String(device['校准周期'] ?? '')) ?? 0
  const durationDays = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1
  const evaluated = evaluateSchedules(
    [{ deviceId: Number(target.deviceId), periodDays, durationDays, plannedStart: String(target['计划开始']) }],
    scheduleId,
  )
  if (evaluated.accepted.length === 0) {
    return { ok: false, message: evaluated.rejected[0]?.['失败原因'] || '重试失败' }
  }
  saveRows(SCHEDULE_KEY, evaluated.nextRows)
  saveRows(FLOW_TODO_KEY, evaluated.todos)
  markDevicePending([Number(target.deviceId)])
  return { ok: true, message: `重试成功，已生成排程 ${evaluated.accepted[0].scheduleNo}` }
}

function updateScheduleStatus(
  scheduleId: number,
  from: string[],
  to: string,
  actionLabel: string,
  options: { deviceStatus?: string; todoStatus?: string } = {},
): ActionResult {
  const rows = scheduleRows()
  const index = rows.findIndex((row) => Number(row.id) === scheduleId)
  if (index < 0) {
    return { ok: false, message: '没有找到该排程记录' }
  }
  const target = rows[index]
  if (!from.includes(String(target.status))) {
    return { ok: false, message: `当前状态「${target.status}」不能${actionLabel}` }
  }
  const updated: CalibrationScheduleRow = {
    ...target,
    status: to,
    pending: to !== '已完成' && to !== '已取消',
    abnormal: false,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(SCHEDULE_KEY, next)

  if (options.deviceStatus) {
    const deviceRows = listRows('monitor_device')
    const deviceIndex = deviceRows.findIndex((row) => Number(row.id) === target.deviceId)
    if (deviceIndex >= 0) {
      const device = deviceRows[deviceIndex]
      const patched: EntryRow = { ...device, status: options.deviceStatus, pending: options.deviceStatus === '待校准' }
      const deviceNext = [...deviceRows]
      deviceNext[deviceIndex] = patched
      saveRows('monitor_device', deviceNext)
    }
  }
  if (options.todoStatus) {
    const todoList = flowTodoRows()
    const todoNext = todoList.map((todo) =>
      String(todo.scheduleNo) === target.scheduleNo && todo.pending
        ? {
            ...todo,
            status: options.todoStatus as string,
            pending: options.todoStatus === '待暂停',
            abnormal: false,
          }
        : todo,
    )
    saveRows(FLOW_TODO_KEY, todoNext)
  }
  return { ok: true, message: `排程 ${target.scheduleNo} 已${actionLabel}` }
}

export function startCalibration(scheduleId: number): ActionResult {
  return updateScheduleStatus(scheduleId, ['待校准'], '校准中', '开始校准', {
    deviceStatus: '待校准',
  })
}

export function completeCalibration(scheduleId: number): ActionResult {
  const target = scheduleRows().find((row) => Number(row.id) === scheduleId)
  if (!target) {
    return { ok: false, message: '没有找到该排程记录' }
  }
  // 完成校准：回写最近校准时间，设备回到运行中；仍挂着的测点待办标记为可恢复。
  const deviceRows = listRows('monitor_device')
  const deviceIndex = deviceRows.findIndex((row) => Number(row.id) === target.deviceId)
  if (deviceIndex >= 0) {
    const device = deviceRows[deviceIndex]
    const patched: EntryRow = {
      ...device,
      最近校准: String(target['计划开始']),
      status: '运行中',
      pending: true,
      abnormal: false,
    }
    const deviceNext = [...deviceRows]
    deviceNext[deviceIndex] = patched
    saveRows('monitor_device', deviceNext)
  }
  const todoList = flowTodoRows()
  const todoNext = todoList.map((todo) =>
    String(todo.scheduleNo) === target.scheduleNo && String(todo.status) === '已暂停'
      ? { ...todo, status: '待恢复', pending: true, abnormal: false }
      : todo,
  )
  saveRows(FLOW_TODO_KEY, todoNext)
  return updateScheduleStatus(scheduleId, ACTIVE_SCHEDULE_STATUSES, '已完成', '完成校准')
}

export function cancelCalibration(scheduleId: number): ActionResult {
  return updateScheduleStatus(scheduleId, ACTIVE_SCHEDULE_STATUSES, '已取消', '取消排程', {
    todoStatus: '随排程取消',
  })
}

/* --------------------- 流量测点暂停待办（由排程生成） --------------------- */

export function listFlowPauseTodos(): FlowPauseTodoRow[] {
  const activeSchedulesByNo = new Set(
    scheduleRows()
      .filter((row) => ACTIVE_SCHEDULE_STATUSES.includes(String(row.status)))
      .map((row) => row.scheduleNo),
  )
  // 排程已结束或取消后，待办不再占用队列：已暂停/待恢复的保留记录供恢复，其他直接不显示。
  return flowTodoRows()
    .filter((todo) => {
      const alive = activeSchedulesByNo.has(String(todo.scheduleNo))
      if (alive) {
        return true
      }
      return ['已暂停', '待恢复'].includes(String(todo.status))
    })
    .sort((a, b) => Number(b.id) - Number(a.id))
}

function setFlowPointStatus(pointId: number, status: string, abnormal: boolean): void {
  const rows = listRows('flow_monitor')
  const next = rows.map((row) =>
    Number(row.id) === pointId ? { ...row, status, pending: true, abnormal } : row,
  )
  saveRows('flow_monitor', next)
}

export function pauseFlowPoint(todoId: number): ActionResult {
  const todos = flowTodoRows()
  const index = todos.findIndex((todo) => Number(todo.id) === todoId)
  if (index < 0) {
    return { ok: false, message: '没有找到该暂停待办' }
  }
  const todo = todos[index]
  if (String(todo.status) !== '待暂停') {
    return { ok: false, message: `待办当前为「${todo.status}」，无需暂停` }
  }
  const points = listRows('flow_monitor')
  const point = points.find((row) => String(row['监测点编号']) === String(todo['监测点编号']))
  if (!point) {
    return { ok: false, message: '对应流量测点不存在' }
  }
  setFlowPointStatus(Number(point.id), '离线', true)
  const next = [...todos]
  next[index] = { ...todo, status: '已暂停', pending: true, abnormal: false }
  saveRows(FLOW_TODO_KEY, next)
  return { ok: true, message: `测点 ${todo['监测点编号']} 已按校准排程暂停` }
}

export function resumeFlowPoint(todoId: number): ActionResult {
  const todos = flowTodoRows()
  const index = todos.findIndex((todo) => Number(todo.id) === todoId)
  if (index < 0) {
    return { ok: false, message: '没有找到该暂停待办' }
  }
  const todo = todos[index]
  if (!['已暂停', '待恢复'].includes(String(todo.status))) {
    return { ok: false, message: `待办当前为「${todo.status}」，不能恢复` }
  }
  const points = listRows('flow_monitor')
  const point = points.find((row) => String(row['监测点编号']) === String(todo['监测点编号']))
  if (!point) {
    return { ok: false, message: '对应流量测点不存在' }
  }
  setFlowPointStatus(Number(point.id), '在线', false)
  const next = [...todos]
  next[index] = { ...todo, status: '已恢复', pending: false, abnormal: false }
  saveRows(FLOW_TODO_KEY, next)
  return { ok: true, message: `测点 ${todo['监测点编号']} 已恢复在线` }
}

export function loadCalibrationOverview(): CalibrationOverview {
  const active = scheduleRows().filter((row) => ACTIVE_SCHEDULE_STATUSES.includes(String(row.status)))
  const deviceRows = listRows('monitor_device')
  const earliestByDevice = new Map<number, CalibrationScheduleRow>()
  for (const row of active) {
    const current = earliestByDevice.get(Number(row.deviceId))
    if (!current || String(row['计划开始']) < String(current['计划开始'])) {
      earliestByDevice.set(Number(row.deviceId), row)
    }
  }
  // 待校准设备：档案里状态为待校准，或存在未完成有效排程的设备；已故障的不进队列。
  const pendingDevices = deviceRows
    .filter((device) => String(device.status) !== DEVICE_FAULT_STATUS)
    .filter((device) => String(device.status) === '待校准' || earliestByDevice.has(Number(device.id)))
    .map((device) => ({
      ...device,
      校准开始时间: earliestByDevice.get(Number(device.id))?.['计划开始'] ?? '',
    }))
  return {
    pendingDevices,
    activeSchedules: active,
    failedCount: failedSchedules().length,
  }
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const calibration = loadCalibrationOverview()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
    { label: '待校准设备', value: calibration.pendingDevices.length },
  ]
  return { cards, modules, calibration }
}
