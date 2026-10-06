<template>
  <section class="schedule-section">
    <header class="section-head">
      <h3>校准排程记录</h3>
      <nav class="status-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          type="button"
          :class="['tab', { active: activeTab === tab.value }]"
          @click="activeTab = tab.value"
        >
          {{ tab.label }}（{{ tab.count }}）
        </button>
      </nav>
    </header>

    <table class="data-table">
      <thead>
        <tr>
          <th>批次</th>
          <th>设备编号</th>
          <th>设备类型</th>
          <th>安装位置</th>
          <th>校准周期(天)</th>
          <th>计划时段</th>
          <th>状态/原因</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in visibleRows" :key="row.id">
          <td>{{ row.batchId }}</td>
          <td>{{ row.deviceCode }}</td>
          <td>{{ row.deviceType }}</td>
          <td>{{ row.installLocation || '—' }}</td>
          <td>{{ row.cycleDays }}</td>
          <td>{{ row.startDate }} ~ {{ row.endDate }}</td>
          <td>
            <span :class="['status-badge', row.status]">{{ row.status }}</span>
            <em v-if="row.failReason" class="fail-reason">{{ row.failReason }}</em>
          </td>
          <td class="row-actions">
            <template v-if="row.status === '待补'">
              <button class="link" type="button" @click="openSupplement(row)">补录信息</button>
              <button class="link" type="button" @click="openRetry(row)">改期重试</button>
            </template>
            <button v-else-if="row.status === '失败'" class="link" type="button" @click="openRetry(row)">
              改期重试
            </button>
            <span v-else-if="row.status === '驳回'" class="muted-text">故障设备不可排程</span>
            <span v-else class="muted-text">已进入校准队列</span>
          </td>
        </tr>
        <tr v-if="!visibleRows.length">
          <td colspan="8" class="empty-state">暂无对应状态的排程记录</td>
        </tr>
      </tbody>
    </table>

    <!-- 改期重试 -->
    <div v-if="retryTarget" class="modal-mask" @click.self="retryTarget = null">
      <div class="mini-modal">
        <h4>改期重试 · {{ retryTarget.deviceCode }}</h4>
        <label class="form-line">
          校准周期（天）
          <input type="number" min="1" v-model.number="retryCycle" />
        </label>
        <label class="form-line">
          校准日期
          <input type="date" v-model="retryDate" />
        </label>
        <p v-if="retryMessage" class="error-text">{{ retryMessage }}</p>
        <div class="mini-foot">
          <button class="btn ghost" type="button" @click="retryTarget = null">取消</button>
          <button class="btn primary" type="button" @click="doRetry">提交重试</button>
        </div>
      </div>
    </div>

    <!-- 补录信息 -->
    <div v-if="supplementTarget" class="modal-mask" @click.self="supplementTarget = null">
      <div class="mini-modal">
        <h4>补录档案 · {{ supplementTarget.deviceCode }}</h4>
        <p class="form-tip">补录内容会写回监测设备档案，随后可直接重试该排程。</p>
        <label class="form-line">
          安装位置
          <input type="text" v-model="supplementLocation" placeholder="如：滨河路1号检查井" />
        </label>
        <label class="form-line">
          校准周期（天）
          <input type="number" min="1" v-model.number="supplementCycle" placeholder="如：180" />
        </label>
        <label class="form-line">
          重试校准日期
          <input type="date" v-model="supplementDate" />
        </label>
        <p v-if="supplementMessage" class="error-text">{{ supplementMessage }}</p>
        <div class="mini-foot">
          <button class="btn ghost" type="button" @click="supplementTarget = null">取消</button>
          <button class="btn primary" type="button" @click="doSupplement">补录并重试</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import {
  listAllSchedules,
  retrySchedule,
  supplementDevice,
} from '@/api/calibration-service'
import type { CalibrationSchedule } from '@/data/calibration'

const DEFAULT_FALLBACK_CYCLE = 180

const emit = defineEmits<{ changed: [] }>()

const rows = ref<CalibrationSchedule[]>([])
const activeTab = ref<'全部' | '有效' | '待补' | '失败' | '驳回'>('全部')

function reload() {
  rows.value = listAllSchedules()
}
defineExpose({ reload })

const tabs = computed(() => [
  { value: '全部' as const, label: '全部', count: rows.value.length },
  { value: '有效' as const, label: '有效', count: rows.value.filter((row) => row.status === '有效').length },
  { value: '待补' as const, label: '待补', count: rows.value.filter((row) => row.status === '待补').length },
  { value: '失败' as const, label: '失败', count: rows.value.filter((row) => row.status === '失败').length },
  { value: '驳回' as const, label: '驳回', count: rows.value.filter((row) => row.status === '驳回').length },
])

const visibleRows = computed(() =>
  activeTab.value === '全部' ? rows.value : rows.value.filter((row) => row.status === activeTab.value),
)

// 改期重试弹窗状态
const retryTarget = ref<CalibrationSchedule | null>(null)
const retryCycle = ref(DEFAULT_FALLBACK_CYCLE)
const retryDate = ref('')
const retryMessage = ref('')

function openRetry(row: CalibrationSchedule) {
  retryTarget.value = row
  retryCycle.value = row.cycleDays
  retryDate.value = row.startDate
  retryMessage.value = ''
}

function doRetry() {
  if (!retryTarget.value) {
    return
  }
  const result = retrySchedule(retryTarget.value.id, {
    startDate: retryDate.value,
    cycleDays: Number(retryCycle.value),
  })
  if (!result.ok) {
    retryMessage.value = result.message
    return
  }
  retryTarget.value = null
  reload()
  emit('changed')
}

// 补录弹窗状态
const supplementTarget = ref<CalibrationSchedule | null>(null)
const supplementLocation = ref('')
const supplementCycle = ref<number | null>(null)
const supplementDate = ref('')
const supplementMessage = ref('')

function openSupplement(row: CalibrationSchedule) {
  supplementTarget.value = row
  supplementLocation.value = row.installLocation
  supplementCycle.value = row.cycleDays
  supplementDate.value = row.startDate
  supplementMessage.value = ''
}

function doSupplement() {
  if (!supplementTarget.value) {
    return
  }
  const target = supplementTarget.value
  if (!supplementLocation.value.trim()) {
    supplementMessage.value = '请补录安装位置'
    return
  }
  if (!supplementCycle.value || supplementCycle.value <= 0) {
    supplementMessage.value = '请补录有效的校准周期'
    return
  }
  supplementDevice(target.deviceId, {
    installLocation: supplementLocation.value.trim(),
    cycleDays: Number(supplementCycle.value),
  })
  const result = retrySchedule(target.id, {
    startDate: supplementDate.value,
    cycleDays: Number(supplementCycle.value),
  })
  if (!result.ok) {
    supplementMessage.value = result.message
    return
  }
  supplementTarget.value = null
  reload()
  emit('changed')
}

reload()
</script>

<style scoped>
.schedule-section { margin-top: 18px; }
.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.section-head h3 { margin: 0; font-size: 15px; }
.status-tabs { display: flex; gap: 6px; }
.tab {
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 999px;
  padding: 3px 12px;
  font-size: 12px;
  cursor: pointer;
}
.tab.active { background: var(--brand); color: #fff; border-color: var(--brand); }
.status-badge {
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  background: #eceff3;
}
.status-badge.有效 { background: #e7f6ec; color: #157347; }
.status-badge.待补 { background: #fef3e2; color: #9a6700; }
.status-badge.失败 { background: #fdeaea; color: #b42318; }
.status-badge.驳回 { background: #eceff3; color: #475569; }
.fail-reason { display: block; color: var(--muted); font-size: 12px; font-style: normal; margin-top: 2px; }
.muted-text { color: var(--muted); font-size: 12px; }
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
}
.mini-modal {
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  width: 380px;
}
.mini-modal h4 { margin: 0 0 10px; }
.form-tip { font-size: 12px; color: var(--muted); margin: 0 0 10px; }
.form-line { display: block; font-size: 13px; color: var(--muted); margin-bottom: 10px; }
.form-line input {
  display: block;
  width: 100%;
  margin-top: 4px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: #1f2937;
}
.mini-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
</style>
