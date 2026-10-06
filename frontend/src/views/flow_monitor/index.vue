<template>
  <section class="page" data-module="flow_monitor">
    <header class="page-head">
      <div>
        <h2>流量监测管理</h2>
        <p class="page-desc">维护流量监测点，围绕监测点编号、监测点位、监测时段、瞬时流量做登记、筛选与状态流转；校准排程提交后在此生成测点暂停待办。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记流量监测点</button>
        <button class="btn" type="button" @click="exportRows">导出流量监测清单</button>
      </div>
    </header>

    <section class="todo-section">
      <header class="section-head">
        <h3>测点暂停待办</h3>
        <span class="section-tip">来自监测设备校准排程：校准期间暂停该测点采集，完成后恢复。</span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>待办编号</th>
            <th>来源批次</th>
            <th>监测点编号</th>
            <th>监测点位</th>
            <th>计划校准日期</th>
            <th>校准周期(天)</th>
            <th>待办状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="todo in todos" :key="todo.id">
            <td>T-{{ String(todo.id).padStart(4, '0') }}</td>
            <td>{{ todo.batchId }}</td>
            <td>{{ todo.pointCode }}</td>
            <td>{{ todo.pointLocation }}</td>
            <td>{{ todo.planDate }}</td>
            <td>{{ todo.cycleDays }}</td>
            <td><span :class="['todo-badge', todo.status]">{{ todo.status }}</span></td>
            <td class="row-actions">
              <button
                v-if="todo.status === '待暂停'"
                class="link"
                type="button"
                @click="suspendPoint(todo.id)"
              >
                确认暂停
              </button>
              <button
                v-else-if="todo.status === '已暂停'"
                class="link"
                type="button"
                @click="resumePoint(todo.id)"
              >
                确认恢复
              </button>
              <span v-else class="muted-text">已完成</span>
            </td>
          </tr>
          <tr v-if="!todos.length">
            <td colspan="8" class="empty-state">暂无暂停待办，在「监测设备」页提交有效校准排程后自动生成</td>
          </tr>
        </tbody>
      </table>
    </section>

    <div class="stat-row inner">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
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
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无流量监测数据，可先登记流量监测点</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条流量监测记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  confirmResume,
  confirmSuspend,
  listFlowTodos,
} from '@/api/calibration-service'
import type { FlowSuspendTodo } from '@/data/calibration'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('flow_monitor')
const columns = ["监测点编号", "监测点位", "监测时段", "瞬时流量", "累计流量", "水位标高", "流速", "数据状态"]
const actions = ["标记异常", "恢复在线", "申请校准"]
const statuses = ["在线", "离线", "数据异常", "已校准"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const todos = ref<FlowSuspendTodo[]>([])

function reloadTodos() {
  todos.value = listFlowTodos()
}

const stats = computed(() => {
  const online = rows.value.filter((row) => String(row.status) === '在线').length
  const offline = rows.value.filter((row) => String(row.status) === '离线').length
  const abnormal = rows.value.filter((row) => String(row.status) === '数据异常').length
  const waitingSuspend = todos.value.filter((todo) => todo.status === '待暂停').length
  return [
    { label: '在线测点', value: online },
    { label: '离线测点', value: offline },
    { label: '异常测点', value: abnormal },
    { label: '待暂停待办', value: waitingSuspend },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '流量监测点登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function suspendPoint(todoId: number) {
  confirmSuspend(todoId)
  reloadTodos()
}

function resumePoint(todoId: number) {
  confirmResume(todoId)
  reloadTodos()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    reloadTodos()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '流量监测列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.todo-section { margin: 8px 0 16px; }
.section-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 8px; }
.section-head h3 { margin: 0; font-size: 15px; }
.section-tip { font-size: 12px; color: var(--muted); }
.stat-row.inner { margin-top: 16px; }
.todo-badge {
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  background: #eceff3;
}
.todo-badge.待暂停 { background: #fef3e2; color: #9a6700; }
.todo-badge.已暂停 { background: #fdeaea; color: #b42318; }
.todo-badge.已恢复 { background: #e7f6ec; color: #157347; }
.muted-text { color: var(--muted); font-size: 12px; }
</style>
