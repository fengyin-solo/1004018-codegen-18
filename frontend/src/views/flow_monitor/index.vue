<template>
  <section class="page" data-module="flow_monitor">
    <header class="page-head">
      <div>
        <h2>流量监测管理</h2>
        <p class="page-desc">维护流量监测点，围绕监测点编号、监测点位、监测时段、瞬时流量做登记、筛选与状态流转；监测设备校准排程会生成测点暂停待办。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记流量监测点</button>
        <button class="btn" type="button" @click="exportRows">导出流量监测清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <!-- 测点暂停待办：校准排程提交后按安装位置同步生成 -->
    <section v-if="todos.length" class="panel todo-panel">
      <header class="panel-head">
        <div>
          <h3>测点暂停待办</h3>
          <p class="page-desc">校准备件到达后先暂停测点，校准完成再恢复在线；待办与监测设备页的校准排程一一对应。</p>
        </div>
      </header>
      <table class="data-table compact">
        <thead>
          <tr>
            <th>待办编号</th>
            <th>监测点编号</th>
            <th>监测点位</th>
            <th>关联校准设备</th>
            <th>校准时段</th>
            <th>对应排程</th>
            <th>待办状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="todo in todos" :key="String(todo.id)">
            <td>{{ todo.todoNo }}</td>
            <td>{{ todo['监测点编号'] }}</td>
            <td>{{ todo['监测点位'] }}</td>
            <td>{{ todo['关联设备'] }}</td>
            <td>{{ todo['校准开始'] }} ~ {{ todo['校准结束'] }}</td>
            <td>{{ todo.scheduleNo }}</td>
            <td><span class="tag" :class="todoTagClass(String(todo.status))">{{ todo.status }}</span></td>
            <td class="row-actions">
              <button v-if="todo.status === '待暂停'" class="link" type="button" @click="pausePoint(todo)">暂停测点</button>
              <button v-if="['已暂停', '待恢复'].includes(String(todo.status))" class="link" type="button" @click="resumePoint(todo)">恢复在线</button>
              <span v-else class="muted-text">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

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
  listFlowPauseTodos,
  moduleMeta,
  pauseFlowPoint,
  resumeFlowPoint,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, FlowPauseTodoRow } from '@/data/types'

const meta = moduleMeta('flow_monitor')
const columns = ["监测点编号", "监测点位", "监测时段", "瞬时流量", "累计流量", "水位标高", "流速", "数据状态"]
const actions = ["标记异常", "恢复在线", "申请校准"]
const statuses = ["在线", "离线", "数据异常", "已校准"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const todos = ref<FlowPauseTodoRow[]>([])

const stats = computed(() => [
  { label: '在线测点', value: rows.value.filter((row) => String(row.status) === '在线').length },
  { label: '离线测点', value: rows.value.filter((row) => String(row.status) === '离线').length },
  { label: '异常测点', value: rows.value.filter((row) => String(row.status) === '数据异常').length },
  { label: '暂停待办', value: todos.value.filter((todo) => ['待暂停', '已暂停', '待恢复'].includes(String(todo.status))).length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function todoTagClass(status: string): string {
  if (status === '待暂停') {
    return 'danger'
  }
  if (status === '已暂停') {
    return 'warn'
  }
  if (status === '待恢复') {
    return 'warn'
  }
  if (status === '已恢复') {
    return 'success'
  }
  return 'muted'
}

function reloadTodos() {
  todos.value = listFlowPauseTodos()
}

function pausePoint(todo: FlowPauseTodoRow) {
  const result = pauseFlowPoint(Number(todo.id))
  errorMessage.value = result.ok ? '' : result.message
  reloadTodos()
  reload()
}

function resumePoint(todo: FlowPauseTodoRow) {
  const result = resumeFlowPoint(Number(todo.id))
  errorMessage.value = result.ok ? '' : result.message
  reloadTodos()
  reload()
}

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

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '流量监测列表读取失败'
  }
}

onMounted(() => {
  reload()
  reloadTodos()
})
</script>
