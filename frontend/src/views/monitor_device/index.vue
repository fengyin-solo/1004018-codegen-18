<template>
  <section class="page" data-module="monitor_device">
    <header class="page-head">
      <div>
        <h2>监测设备管理</h2>
        <p class="page-desc">维护监测设备，围绕设备编号、设备类型、安装位置、监测参数做登记、筛选与状态流转，并支持批量校准排程。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openScheduler">安排校准排程</button>
        <button class="btn" type="button" @click="exportRows">导出监测设备清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item">排程失败待处理：{{ failedCount }}</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] === '' || row[column] == null ? '—' : row[column] }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无监测设备数据，可先登记监测设备</td>
        </tr>
      </tbody>
    </table>

    <!-- 校准排程：一次安排多条设备，按设备类型、安装位置、最近校准时间分组，逐台调整周期 -->
    <section v-if="schedulerOpen" class="panel">
      <header class="panel-head">
        <div>
          <h3>校准排程</h3>
          <p class="page-desc">按「设备类型 · 安装位置 · 最近校准月份」分组，勾选设备后逐台调整校准周期与校准起止；已故障设备不进入队列。</p>
        </div>
        <div class="panel-actions">
          <button class="btn ghost" type="button" @click="schedulerOpen = false">收起</button>
        </div>
      </header>

      <div v-if="faultExcluded.length" class="banner warn">
        已故障设备不得进入正常校准队列，已自动排除：
        <span v-for="device in faultExcluded" :key="String(device.id)" class="tag danger">
          {{ device['设备编号'] }}（{{ device['设备状态'] }}）
        </span>
      </div>

      <div v-for="group in groups" :key="group.key" class="group-block">
        <div class="group-head">
          <label class="group-check">
            <input type="checkbox" :checked="groupSelected(group)" :indeterminate.prop="groupIndeterminate(group)" @change="toggleGroup(group, ($event.target as HTMLInputElement).checked)" />
            <strong>{{ group.label }}</strong>
          </label>
          <span class="muted-text">本组 {{ group.devices.length }} 台，已选 {{ groupSelectedCount(group) }} 台</span>
          <button class="link" type="button" @click="applyPeriodToGroup(group)">整组套用周期</button>
        </div>
        <table class="data-table compact">
          <thead>
            <tr>
              <th class="col-check">排入</th>
              <th>设备编号</th>
              <th>监测参数</th>
              <th>校准周期（天）</th>
              <th>计划开始</th>
              <th>校准时长（天）</th>
              <th>计划结束</th>
              <th>待补项 / 提示</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="candidate in group.devices" :key="String(candidate.device.id)">
              <td>
                <input v-model="candidate.draft.selected" type="checkbox" />
              </td>
              <td>{{ candidate.device['设备编号'] }}</td>
              <td>{{ candidate.device['监测参数'] }}</td>
              <td>
                <input
                  v-model.number="candidate.draft.periodDays"
                  class="input-mini"
                  type="number"
                  min="1"
                  :disabled="candidate.missing.length > 0"
                />
              </td>
              <td>
                <input v-model="candidate.draft.plannedStart" class="input-date" type="date" />
              </td>
              <td>
                <input v-model.number="candidate.draft.durationDays" class="input-mini" type="number" min="1" />
              </td>
              <td>{{ plannedEnd(candidate.draft) }}</td>
              <td>
                <span v-if="candidate.missing.length" class="warn-text">待补：{{ candidate.missing.join('、') }}</span>
                <span v-else class="muted-text">建议 {{ candidate.suggestedStart }} 到期校准</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer class="panel-foot">
        <span class="muted-text">已选 {{ selectedDrafts.length }} 台；缺项设备可一并提交，系统会保留排程并标出待补项，之后补录重试。</span>
        <div class="panel-actions">
          <button class="btn" type="button" @click="schedulerOpen = false">取消</button>
          <button class="btn primary" type="button" :disabled="!selectedDrafts.length" @click="submitSchedules">
            提交排程（{{ selectedDrafts.length }} 台）
          </button>
        </div>
      </footer>
    </section>

    <!-- 排程记录：有效排程与失败条目都在这里，失败条目可补录后重试，重复提交只保留首个 -->
    <section class="panel">
      <header class="panel-head">
        <div>
          <h3>校准排程记录</h3>
          <p class="page-desc">同一设备存在重叠时段的排程会被判为失败；有效排程提交后同步到运营概览与流量监测页。</p>
        </div>
        <div class="panel-actions">
          <button class="btn ghost" type="button" @click="reloadSchedules">刷新</button>
        </div>
      </header>
      <table class="data-table compact">
        <thead>
          <tr>
            <th>排程编号</th>
            <th>设备编号</th>
            <th>设备类型</th>
            <th>安装位置</th>
            <th>校准周期</th>
            <th>计划时段</th>
            <th>状态</th>
            <th>失败原因</th>
            <th>提交时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="schedule in schedules" :key="String(schedule.id)" :class="{ 'row-failed': schedule.status === '提交失败' }">
            <td>{{ schedule.scheduleNo }}</td>
            <td>{{ schedule['设备编号'] }}</td>
            <td>{{ schedule['设备类型'] }}</td>
            <td>{{ schedule['安装位置'] || '—' }}</td>
            <td>{{ schedule.status === '提交失败' && Number(schedule['校准周期']) <= 0 ? '待补录' : `${schedule['校准周期']}天` }}</td>
            <td>{{ schedule['计划开始'] }} ~ {{ schedule['计划结束'] }}</td>
            <td><span class="tag" :class="statusTagClass(String(schedule.status))">{{ schedule.status }}</span></td>
            <td class="warn-text">{{ schedule['失败原因'] || '—' }}</td>
            <td>{{ schedule['提交时间'] }}</td>
            <td class="row-actions">
              <button v-if="schedule.status === '待校准'" class="link" type="button" @click="startSchedule(schedule)">开始校准</button>
              <button v-if="schedule.status === '校准中'" class="link" type="button" @click="completeSchedule(schedule)">完成校准</button>
              <button v-if="['待校准', '校准中'].includes(String(schedule.status))" class="link" type="button" @click="cancelSchedule(schedule)">取消</button>
              <button v-if="schedule.status === '提交失败'" class="link" type="button" @click="retrySchedule(schedule)">重试</button>
              <button
                v-if="schedule.status === '提交失败' && String(schedule['失败原因']).includes('补')"
                class="link"
                type="button"
                @click="openSupplement(schedule)"
              >
                补录
              </button>
            </td>
          </tr>
          <tr v-if="!schedules.length">
            <td colspan="10" class="empty-state">还没有校准排程，点击右上角「安排校准排程」批量安排</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 失败条目的待补项补录表单 -->
    <section v-if="supplementTarget" class="panel">
      <header class="panel-head">
        <h3>补录待补项 · {{ supplementTarget['设备编号'] }}（{{ supplementTarget.scheduleNo }}）</h3>
      </header>
      <form class="filter-bar" @submit.prevent="submitSupplement">
        <label class="filter-item">
          <span>安装位置</span>
          <input v-model="supplementForm['安装位置']" placeholder="如：滨江路1号检查井" />
        </label>
        <label class="filter-item">
          <span>校准周期</span>
          <input v-model="supplementForm['校准周期']" placeholder="如：180天 / 6个月" />
        </label>
        <label class="filter-item">
          <span>最近校准</span>
          <input v-model="supplementForm['最近校准']" type="date" />
        </label>
        <button class="btn primary" type="submit">保存并重试该排程</button>
        <button class="btn ghost" type="button" @click="supplementTarget = null">关闭</button>
      </form>
      <p class="muted-text">只需要填写缺失的项；已有的字段留空即保持原值，保存后会自动按补录结果重新校验。</p>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条监测设备记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  calibrationGroups,
  cancelCalibration,
  completeCalibration,
  downloadEntries,
  excludedFaultDevices,
  listCalibrationSchedules,
  listEntries,
  moduleMeta,
  retryCalibrationSchedule,
  runAction as applyAction,
  startCalibration,
  submitCalibrationSchedules,
  supplementDevice,
  type CalibrationDraft,
  type CalibrationGroup,
  type ScheduleSubmitItem,
} from '@/api/local-service'
import type { CalibrationScheduleRow, EntryRow } from '@/data/types'

const meta = moduleMeta('monitor_device')
const columns = ["设备编号", "设备类型", "安装位置", "监测参数", "安装日期", "校准周期", "最近校准", "设备状态"]
const actions = ["确认安装", "申请校准", "上报故障"]
const statuses = ["待安装", "运行中", "待校准", "已故障"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const schedulerOpen = ref(false)
const groups = ref<CalibrationGroup[]>([])
const faultExcluded = ref<EntryRow[]>([])
const schedules = ref<CalibrationScheduleRow[]>([])
const supplementTarget = ref<CalibrationScheduleRow | null>(null)
const supplementForm = ref<Record<string, string>>({ '安装位置': '', '校准周期': '', '最近校准': '' })

const stats = computed(() => [
  { label: '运行中设备', value: rows.value.filter((row) => String(row.status) === '运行中').length },
  { label: '待校准设备', value: rows.value.filter((row) => String(row.status) === '待校准').length },
  { label: '故障设备', value: rows.value.filter((row) => String(row.status) === '已故障').length },
])

const failedCount = computed(() => schedules.value.filter((row) => String(row.status) === '提交失败').length)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const selectedDrafts = computed(() =>
  groups.value.flatMap((group) => group.devices.map((item) => item.draft)).filter((draft) => draft.selected),
)

function plannedEnd(draft: CalibrationDraft): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.plannedStart)) {
    return '—'
  }
  const duration = Math.max(Math.trunc(draft.durationDays) || 1, 1)
  const [year, month, day] = draft.plannedStart.split('-').map(Number)
  const date = new Date(year, month - 1, day + duration - 1)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${mm}-${dd}`
}

function groupSelectedCount(group: CalibrationGroup): number {
  return group.devices.filter((item) => item.draft.selected).length
}

function groupSelected(group: CalibrationGroup): boolean {
  return group.devices.length > 0 && group.devices.every((item) => item.draft.selected)
}

function groupIndeterminate(group: CalibrationGroup): boolean {
  const count = groupSelectedCount(group)
  return count > 0 && count < group.devices.length
}

function toggleGroup(group: CalibrationGroup, checked: boolean) {
  for (const item of group.devices) {
    item.draft.selected = checked
  }
}

function applyPeriodToGroup(group: CalibrationGroup) {
  const first = group.devices.find((item) => item.draft.periodDays !== null)?.draft.periodDays
  if (!first) {
    errorMessage.value = '本组设备缺少校准周期，无法整组套用，请先在排程记录里补录'
    return
  }
  for (const item of group.devices) {
    if (item.draft.periodDays !== null) {
      item.draft.periodDays = first
    }
  }
  errorMessage.value = ''
}

function openScheduler() {
  errorMessage.value = ''
  groups.value = calibrationGroups()
  faultExcluded.value = excludedFaultDevices()
  schedulerOpen.value = true
}

function submitSchedules() {
  const items: ScheduleSubmitItem[] = selectedDrafts.value.map((draft) => ({
    deviceId: draft.deviceId,
    periodDays: draft.periodDays ?? 0,
    durationDays: Math.max(Math.trunc(draft.durationDays) || 1, 1),
    plannedStart: draft.plannedStart,
  }))
  if (!items.length) {
    return
  }
  const result = submitCalibrationSchedules(items)
  errorMessage.value = result.rejected.length > 0 ? result.message : ''
  schedulerOpen.value = false
  reload()
  reloadSchedules()
}

function reloadSchedules() {
  schedules.value = listCalibrationSchedules()
}

function startSchedule(schedule: CalibrationScheduleRow) {
  const result = startCalibration(Number(schedule.id))
  errorMessage.value = result.ok ? '' : result.message
  reload()
  reloadSchedules()
}

function completeSchedule(schedule: CalibrationScheduleRow) {
  const result = completeCalibration(Number(schedule.id))
  errorMessage.value = result.ok ? '' : result.message
  reload()
  reloadSchedules()
}

function cancelSchedule(schedule: CalibrationScheduleRow) {
  const result = cancelCalibration(Number(schedule.id))
  errorMessage.value = result.ok ? '' : result.message
  reload()
  reloadSchedules()
}

function retrySchedule(schedule: CalibrationScheduleRow) {
  const result = retryCalibrationSchedule(Number(schedule.id))
  errorMessage.value = result.ok ? '' : result.message
  reload()
  reloadSchedules()
}

function openSupplement(schedule: CalibrationScheduleRow) {
  supplementTarget.value = schedule
  supplementForm.value = { '安装位置': '', '校准周期': '', '最近校准': '' }
  errorMessage.value = ''
}

function submitSupplement() {
  if (!supplementTarget.value) {
    return
  }
  const deviceId = Number(supplementTarget.value.deviceId)
  const patch = Object.fromEntries(
    Object.entries(supplementForm.value).filter(([, value]) => value.trim() !== ''),
  ) as { 安装位置?: string; 校准周期?: string; 最近校准?: string }
  const saved = supplementDevice(deviceId, patch)
  if (!saved.ok) {
    errorMessage.value = saved.message
    return
  }
  const retried = retryCalibrationSchedule(Number(supplementTarget.value.id))
  errorMessage.value = retried.ok ? '' : retried.message
  supplementTarget.value = null
  reload()
  reloadSchedules()
  if (schedulerOpen.value) {
    openScheduler()
  }
}

function statusTagClass(status: string): string {
  if (status === '提交失败') {
    return 'danger'
  }
  if (status === '已完成') {
    return 'success'
  }
  if (status === '已取消') {
    return 'muted'
  }
  return 'info'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
  if (schedulerOpen.value) {
    openScheduler()
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '监测设备列表读取失败'
  }
}

onMounted(() => {
  reload()
  reloadSchedules()
})
</script>
