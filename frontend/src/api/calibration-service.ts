import {
  listRows,
  saveRows,
  listSchedules,
  saveSchedules,
  listSuspendTodos,
  saveSuspendTodos,
} from '@/data/local-store'
import type { CalibrationSchedule, FlowSuspendTodo, ScheduleDraft } from '@/data/calibration'
import type { EntryRow } from '@/data/types'

const MONITOR_KEY = 'monitor_device'
const FLOW_KEY = 'flow_monitor'
const FAULTY_STATUS = '已故障'
const PENDING_CALIBRATION_STATUS = '待校准'
const DEFAULT_CYCLE_DAYS = 180
/** 一次校准默认占用 1 天。 */
const JOB_DURATION_DAYS = 1

function todayText(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function addDays(text: string, days: number): string {
  const date = new Date(`${text}T00:00:00`)
  date.setDate(date.getDate() + days)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function isValidDateText(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00`))
}

/** 「180天」「90 日」「12」都能解析；解析不出来视为缺少校准参数。 */
export function parseCycleDays(value: unknown): number | null {
  const matched = String(value ?? '').match(/\d+/)
  if (!matched) {
    return null
  }
  const days = Number(matched[0])
  return days > 0 ? days : null
}

function fieldMissing(value: unknown): boolean {
  return String(value ?? '').trim() === '' || String(value ?? '').includes('待补')
}

/** 按设备类型、安装位置、最近校准时间生成分组键，同组设备可以一次排进去。 */
export function groupKeyOf(draft: Pick<ScheduleDraft, 'deviceType' | 'installLocation' | 'lastCalibration'>): string {
  const location = draft.installLocation.trim() || '未填写安装位置'
  const last = isValidDateText(draft.lastCalibration) ? draft.lastCalibration : '无校准记录'
  return `${draft.deviceType || '未分类'}｜${location}｜最近校准 ${last}`
}

function deviceToDraft(row: EntryRow): ScheduleDraft {
  const location = String(row['安装位置'] ?? '').trim()
  const param = String(row['监测参数'] ?? '').trim()
  const cycle = parseCycleDays(row['校准周期'])
  const last = String(row['最近校准'] ?? '').trim()
  const missingFields: string[] = []
  if (!location) {
    missingFields.push('安装位置')
  }
  if (cycle === null) {
    missingFields.push('校准周期')
  }
  if (!param) {
    missingFields.push('监测参数')
  }
  const baseDate = isValidDateText(last) && cycle !== null
    ? addDays(last, cycle)
    : todayText()
  const startDate = baseDate < todayText() ? todayText() : baseDate
  return {
    deviceId: Number(row.id),
    deviceCode: String(row['设备编号'] ?? ''),
    deviceType: String(row['设备类型'] ?? ''),
    installLocation: location,
    monitorParam: param,
    cycleDays: cycle ?? DEFAULT_CYCLE_DAYS,
    startDate,
    lastCalibration: isValidDateText(last) ? last : '',
    faulty: String(row.status) === FAULTY_STATUS,
    missingFields,
  }
}

export type DeviceGroup = {
  key: string
  deviceType: string
  installLocation: string
  lastCalibration: string
  drafts: ScheduleDraft[]
}

/** 读取可排程设备并分组，故障设备单列一组且不允许勾选。 */
export function loadDeviceGroups(): { groups: DeviceGroup[]; faulty: ScheduleDraft[] } {
  const drafts = listRows(MONITOR_KEY).map(deviceToDraft)
  const groups: DeviceGroup[] = []
  for (const draft of drafts) {
    if (draft.faulty) {
      continue
    }
    const key = groupKeyOf(draft)
    const existed = groups.find((group) => group.key === key)
    if (existed) {
      existed.drafts.push(draft)
    } else {
      groups.push({
        key,
        deviceType: draft.deviceType,
        installLocation: draft.installLocation || '未填写安装位置',
        lastCalibration: draft.lastCalibration || '无校准记录',
        drafts: [draft],
      })
    }
  }
  return { groups, faulty: drafts.filter((draft) => draft.faulty) }
}

export type ScheduleSubmission = {
  batchId: string
  created: CalibrationSchedule[]
  validCount: number
  pendingCount: number
  failedCount: number
  rejectedCount: number
}

function nextId(rows: { id: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, row.id), 0) + 1
}

function overlap(a: { startDate: string; endDate: string }, b: { startDate: string; endDate: string }): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate
}

/** 设备安装位置与流量监测点位互相能对上、且设备本身是流量计时，挂一条暂停待办。 */
function matchFlowPoint(location: string, deviceType: string): EntryRow | null {
  if (!location || !deviceType.includes('流量')) {
    return null
  }
  const points = listRows(FLOW_KEY)
  return (
    points.find((row) => String(row['监测点位'] ?? '').includes(location)) ??
    points.find((row) => location.includes(String(row['监测点位'] ?? '').slice(0, 6))) ??
    null
  )
}

function setDeviceCalibrationPending(deviceId: number): void {
  const rows = listRows(MONITOR_KEY)
  const index = rows.findIndex((row) => Number(row.id) === deviceId)
  if (index < 0) {
    return
  }
  rows[index] = { ...rows[index], status: PENDING_CALIBRATION_STATUS, pending: false }
  saveRows(MONITOR_KEY, rows)
}

function buildBatchId(existing: CalibrationSchedule[]): string {
  const stamp = todayText().replace(/-/g, '')
  const seq = existing.filter((row) => row.batchId.includes(stamp)).length + 1
  return `CAL-${stamp}-${String(seq).padStart(3, '0')}`
}

/**
 * 批量提交排程：
 * - 缺安装位置/校准参数的，保留为「待补」，不影响其余设备；
 * - 与该设备已有有效排程重叠的，记为「失败」（重复提交只留首个）；
 * - 已故障设备直接驳回，不进正常校准队列；
 * - 有效排程同步把设备置为「待校准」，并在流量监测页生成测点暂停待办。
 */
export function submitSchedules(drafts: ScheduleDraft[]): ScheduleSubmission {
  const schedules = listSchedules()
  const todos = listSuspendTodos()
  const batchId = buildBatchId(schedules)
  const created: CalibrationSchedule[] = []
  // 同一批次里也要防自己互相重叠（正常一台只选一次，这里兜底）。
  const acceptedInBatch: CalibrationSchedule[] = []

  for (const draft of drafts) {
    const endDate = addDays(draft.startDate, JOB_DURATION_DAYS)
    const base = {
      id: nextId([...schedules, ...created]),
      batchId,
      deviceId: draft.deviceId,
      deviceCode: draft.deviceCode,
      deviceType: draft.deviceType,
      installLocation: draft.installLocation,
      monitorParam: draft.monitorParam,
      cycleDays: draft.cycleDays,
      startDate: draft.startDate,
      endDate,
      lastCalibration: draft.lastCalibration,
      missingFields: draft.missingFields,
      failReason: '',
      createdAt: new Date().toISOString(),
    }

    if (draft.faulty) {
      created.push({ ...base, status: '驳回', failReason: '设备已故障，不得进入正常校准队列' })
      continue
    }
    if (draft.missingFields.length > 0) {
      created.push({
        ...base,
        status: '待补',
        failReason: `缺少${draft.missingFields.join('、')}，补录后可重试`,
      })
      continue
    }
    if (!isValidDateText(draft.startDate) || draft.cycleDays <= 0) {
      created.push({ ...base, status: '失败', failReason: '校准日期或周期不合法' })
      continue
    }

    const window = { startDate: draft.startDate, endDate }
    const clashWith = [...schedules.filter((row) => row.status === '有效'), ...acceptedInBatch].find(
      (row) => row.deviceId === draft.deviceId && overlap(row, window),
    )
    if (clashWith) {
      created.push({
        ...base,
        status: '失败',
        failReason: `与已有有效排程 ${clashWith.batchId}（${clashWith.startDate}~${clashWith.endDate}）时段重叠，重复提交仅保留首个排程`,
      })
      continue
    }

    const accepted: CalibrationSchedule = { ...base, status: '有效' }
    created.push(accepted)
    acceptedInBatch.push(accepted)

    setDeviceCalibrationPending(draft.deviceId)
    const point = matchFlowPoint(draft.installLocation, draft.deviceType)
    if (point) {
      todos.push({
        id: nextId(todos),
        scheduleId: accepted.id,
        batchId,
        deviceId: draft.deviceId,
        pointId: Number(point.id),
        pointCode: String(point['监测点编号'] ?? ''),
        pointLocation: String(point['监测点位'] ?? ''),
        planDate: draft.startDate,
        cycleDays: draft.cycleDays,
        status: '待暂停',
        createdAt: new Date().toISOString(),
      })
    }
  }

  saveSchedules([...schedules, ...created])
  saveSuspendTodos(todos)
  return {
    batchId,
    created,
    validCount: created.filter((row) => row.status === '有效').length,
    pendingCount: created.filter((row) => row.status === '待补').length,
    failedCount: created.filter((row) => row.status === '失败').length,
    rejectedCount: created.filter((row) => row.status === '驳回').length,
  }
}

/** 补录设备档案：待补条目重试前先把缺的安装位置/校准周期写回设备记录。 */
export function supplementDevice(deviceId: number, patch: { installLocation?: string; cycleDays?: number }): void {
  const rows = listRows(MONITOR_KEY)
  const index = rows.findIndex((row) => Number(row.id) === deviceId)
  if (index < 0) {
    return
  }
  const updated = { ...rows[index] }
  if (patch.installLocation !== undefined) {
    updated['安装位置'] = patch.installLocation
  }
  if (patch.cycleDays !== undefined) {
    updated['校准周期'] = `${patch.cycleDays}天`
  }
  rows[index] = updated
  saveRows(MONITOR_KEY, rows)
}

export type RetryResult = { ok: boolean; message: string }

/** 失败/待补条目改期或补录后重试，成功则转有效并补发暂停待办。 */
export function retrySchedule(
  scheduleId: number,
  next: { startDate: string; cycleDays?: number },
): RetryResult {
  const schedules = listSchedules()
  const index = schedules.findIndex((row) => row.id === scheduleId)
  if (index < 0) {
    return { ok: false, message: '排程记录不存在' }
  }
  const target = schedules[index]
  if (target.status === '有效') {
    return { ok: false, message: '该排程已是有效状态，无需重试' }
  }

  const device = listRows(MONITOR_KEY).find((row) => Number(row.id) === target.deviceId)
  if (!device) {
    return { ok: false, message: '对应设备档案已删除，无法重试' }
  }
  if (String(device.status) === FAULTY_STATUS) {
    schedules[index] = { ...target, status: '驳回', failReason: '设备已故障，不得进入正常校准队列' }
    saveSchedules(schedules)
    return { ok: false, message: '设备已故障，排程已驳回' }
  }

  const missing: string[] = []
  if (fieldMissing(device['安装位置'])) {
    missing.push('安装位置')
  }
  if (parseCycleDays(device['校准周期']) === null) {
    missing.push('校准周期')
  }
  if (fieldMissing(device['监测参数'])) {
    missing.push('监测参数')
  }
  if (missing.length > 0) {
    schedules[index] = {
      ...target,
      missingFields: missing,
      status: '待补',
      failReason: `缺少${missing.join('、')}，补录后可重试`,
    }
    saveSchedules(schedules)
    return { ok: false, message: `仍缺少${missing.join('、')}，请先补录` }
  }

  const cycleDays = next.cycleDays ?? parseCycleDays(device['校准周期']) ?? target.cycleDays
  if (!isValidDateText(next.startDate) || cycleDays <= 0) {
    return { ok: false, message: '校准日期或周期不合法' }
  }
  const window = { startDate: next.startDate, endDate: addDays(next.startDate, JOB_DURATION_DAYS) }
  const clash = schedules.find(
    (row) =>
      row.id !== target.id &&
      row.status === '有效' &&
      row.deviceId === target.deviceId &&
      overlap(row, window),
  )
  if (clash) {
    schedules[index] = {
      ...target,
      ...window,
      cycleDays,
      status: '失败',
      missingFields: [],
      failReason: `与已有有效排程 ${clash.batchId}（${clash.startDate}~${clash.endDate}）时段重叠`,
    }
    saveSchedules(schedules)
    return { ok: false, message: '改期后仍与已有有效排程时段重叠' }
  }

  const todos = listSuspendTodos()
  schedules[index] = {
    ...target,
    ...window,
    cycleDays,
    installLocation: String(device['安装位置'] ?? ''),
    monitorParam: String(device['监测参数'] ?? ''),
    status: '有效',
    missingFields: [],
    failReason: '',
  }
  saveSchedules(schedules)
  setDeviceCalibrationPending(target.deviceId)

  if (!todos.some((todo) => todo.scheduleId === target.id)) {
    const point = matchFlowPoint(String(device['安装位置'] ?? ''), String(device['设备类型'] ?? ''))
    if (point) {
      todos.push({
        id: nextId(todos),
        scheduleId: target.id,
        batchId: target.batchId,
        deviceId: target.deviceId,
        pointId: Number(point.id),
        pointCode: String(point['监测点编号'] ?? ''),
        pointLocation: String(point['监测点位'] ?? ''),
        planDate: next.startDate,
        cycleDays,
        status: '待暂停',
        createdAt: new Date().toISOString(),
      })
      saveSuspendTodos(todos)
    }
  }
  return { ok: true, message: '排程重试成功，已进入正常校准队列' }
}

export function listAllSchedules(): CalibrationSchedule[] {
  return listSchedules().sort((a, b) => b.id - a.id)
}

/** 向导里实时提示：该设备在指定日期上是否已与有效排程冲突。 */
export function conflictFor(
  deviceId: number,
  startDate: string,
  excludeScheduleId?: number,
): CalibrationSchedule | null {
  if (!isValidDateText(startDate)) {
    return null
  }
  const window = { startDate, endDate: addDays(startDate, JOB_DURATION_DAYS) }
  return (
    listSchedules().find(
      (row) =>
        row.status === '有效' &&
        row.id !== excludeScheduleId &&
        row.deviceId === deviceId &&
        overlap(row, window),
    ) ?? null
  )
}

export function pendingCalibrationDevices(): CalibrationSchedule[] {
  return listSchedules().filter((row) => row.status === '有效')
}

export function listFlowTodos(): FlowSuspendTodo[] {
  return listSuspendTodos().sort((a, b) => b.id - a.id)
}

function setTodoStatus(todoId: number, status: FlowSuspendTodo['status']): void {
  const todos = listSuspendTodos()
  const index = todos.findIndex((todo) => todo.id === todoId)
  if (index < 0) {
    return
  }
  todos[index] = { ...todos[index], status }
  saveSuspendTodos(todos)
}

export function confirmSuspend(todoId: number): void {
  setTodoStatus(todoId, '已暂停')
}

export function confirmResume(todoId: number): void {
  setTodoStatus(todoId, '已恢复')
}
