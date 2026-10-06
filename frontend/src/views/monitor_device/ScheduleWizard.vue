<template>
  <div v-if="open" class="modal-mask" @click.self="close">
    <div class="modal schedule-wizard">
      <header class="modal-head">
        <h3>安排校准排程</h3>
        <button class="link" type="button" @click="close">关闭</button>
      </header>

      <!-- 提交结果 -->
      <div v-if="result" class="result-panel">
        <p class="result-title">批次 {{ result.batchId }} 已提交</p>
        <div class="result-stats">
          <span class="tag valid">有效 {{ result.validCount }}</span>
          <span class="tag pending">待补 {{ result.pendingCount }}</span>
          <span class="tag failed">失败 {{ result.failedCount }}</span>
          <span class="tag rejected">驳回 {{ result.rejectedCount }}</span>
        </div>
        <p class="result-tip">
          有效排程已进入校准队列并同步流量测点暂停待办；待补/失败条目可在下方排程记录中补录或改期重试。
          同一设备重复提交的重叠排程只保留首个有效排程。
        </p>
        <ul class="result-detail">
          <li v-for="row in result.created" :key="row.id">
            <span :class="['status-dot', row.status]"></span>
            {{ row.deviceCode }}（{{ row.deviceType }}）— {{ row.status }}
            <em v-if="row.failReason">{{ row.failReason }}</em>
          </li>
        </ul>
        <div class="modal-foot">
          <button class="btn primary" type="button" @click="finish">完成</button>
        </div>
      </div>

      <!-- 分组选择 -->
      <template v-else>
        <p class="wizard-tip">
          设备已按「设备类型 / 安装位置 / 最近校准时间」分组，可整组勾选，也可逐台调整校准周期与校准日期；
          缺安装位置或校准参数的设备仍可提交，将保留为待补项。
        </p>

        <div class="wizard-body">
          <section v-for="group in groups" :key="group.key" class="group-block">
            <header class="group-head">
              <label class="group-check">
                <input
                  type="checkbox"
                  :checked="isGroupAllChecked(group)"
                  :indeterminate.prop="isGroupIndeterminate(group)"
                  @change="toggleGroup(group, ($event.target as HTMLInputElement).checked)"
                />
                <strong>{{ group.deviceType }}</strong>
              </label>
              <span class="group-meta">{{ group.installLocation }}</span>
              <span class="group-meta">{{ group.lastCalibration }}</span>
              <span class="group-count">{{ group.drafts.length }} 台</span>
            </header>
            <div v-for="draft in group.drafts" :key="draft.deviceId" class="device-row">
              <label class="device-pick">
                <input type="checkbox" v-model="editMap[draft.deviceId].selected" />
                <span>{{ draft.deviceCode }}</span>
              </label>
              <span class="device-param">{{ draft.monitorParam || '监测参数缺失' }}</span>
              <label class="cycle-edit">
                周期
                <input
                  type="number"
                  min="1"
                  v-model.number="editMap[draft.deviceId].cycleDays"
                  @change="recalcStart(draft)"
                />
                天
              </label>
              <label class="date-edit">
                校准日期
                <input type="date" v-model="editMap[draft.deviceId].startDate" />
              </label>
              <span v-if="draft.missingFields.length" class="tag pending">
                待补：{{ draft.missingFields.join('、') }}
              </span>
              <span v-else-if="conflictText(draft)" class="tag failed">{{ conflictText(draft) }}</span>
              <span v-else class="tag ok">可排程</span>
            </div>
          </section>

          <section v-if="faulty.length" class="group-block faulty-block">
            <header class="group-head">
              <strong>已故障设备（不得进入正常校准队列）</strong>
              <span class="group-count">{{ faulty.length }} 台</span>
            </header>
            <div v-for="draft in faulty" :key="draft.deviceId" class="device-row disabled">
              <span>{{ draft.deviceCode }}</span>
              <span class="device-param">{{ draft.deviceType }} · {{ draft.installLocation || '位置缺失' }}</span>
              <span class="tag rejected">已故障，禁止排程</span>
            </div>
          </section>
        </div>

        <footer class="modal-foot">
          <span class="selected-tip">已选 {{ selectedCount }} 台（其中待补 {{ selectedMissing }} 台、冲突 {{ selectedConflict }} 台）</span>
          <span class="footer-actions">
            <button class="btn ghost" type="button" @click="close">取消</button>
            <button class="btn primary" type="button" :disabled="!selectedCount" @click="submit">
              提交排程
            </button>
          </span>
        </footer>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

import {
  conflictFor,
  loadDeviceGroups,
  submitSchedules,
  type DeviceGroup,
  type ScheduleSubmission,
} from '@/api/calibration-service'
import type { ScheduleDraft } from '@/data/calibration'
import { addDaysText, todayText } from '@/views/monitor_device/schedule-utils'

type EditState = { selected: boolean; cycleDays: number; startDate: string }

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; submitted: [] }>()

const groups = ref<DeviceGroup[]>([])
const faulty = ref<ScheduleDraft[]>([])
const editMap = reactive<Record<number, EditState>>({})
const result = ref<ScheduleSubmission | null>(null)

function initGroups() {
  const payload = loadDeviceGroups()
  groups.value = payload.groups
  faulty.value = payload.faulty
  result.value = null
  for (const key of Object.keys(editMap)) {
    delete editMap[Number(key)]
  }
  for (const group of payload.groups) {
    for (const draft of group.drafts) {
      // 已到期（建议日期不晚于 30 天后）的设备默认勾选。
      const dueSoon = draft.startDate <= addDaysText(todayText(), 30)
      editMap[draft.deviceId] = {
        selected: dueSoon,
        cycleDays: draft.cycleDays,
        startDate: draft.startDate,
      }
    }
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      initGroups()
    }
  },
  { immediate: true },
)

function editableDrafts(): { group: DeviceGroup; draft: ScheduleDraft }[] {
  return groups.value.flatMap((group) => group.drafts.map((draft) => ({ group, draft })))
}

function isGroupAllChecked(group: DeviceGroup): boolean {
  return group.drafts.every((draft) => editMap[draft.deviceId]?.selected)
}

function isGroupIndeterminate(group: DeviceGroup): boolean {
  const count = group.drafts.filter((draft) => editMap[draft.deviceId]?.selected).length
  return count > 0 && count < group.drafts.length
}

function toggleGroup(group: DeviceGroup, checked: boolean) {
  for (const draft of group.drafts) {
    editMap[draft.deviceId].selected = checked
  }
}

function recalcStart(draft: ScheduleDraft) {
  const state = editMap[draft.deviceId]
  if (!draft.lastCalibration || !state.cycleDays || state.cycleDays <= 0) {
    return
  }
  const next = addDaysText(draft.lastCalibration, state.cycleDays)
  state.startDate = next < todayText() ? todayText() : next
}

function conflictText(draft: ScheduleDraft): string {
  const state = editMap[draft.deviceId]
  const clash = conflictFor(draft.deviceId, state.startDate)
  return clash ? `与 ${clash.batchId}（${clash.startDate}）重叠` : ''
}

const selectedCount = computed(
  () => editableDrafts().filter(({ draft }) => editMap[draft.deviceId]?.selected).length,
)
const selectedMissing = computed(
  () =>
    editableDrafts().filter(
      ({ draft }) => editMap[draft.deviceId]?.selected && draft.missingFields.length > 0,
    ).length,
)
const selectedConflict = computed(
  () =>
    editableDrafts().filter(({ draft }) => {
      const state = editMap[draft.deviceId]
      return state?.selected && draft.missingFields.length === 0 && conflictFor(draft.deviceId, state.startDate)
    }).length,
)

function submit() {
  const chosen = editableDrafts()
    .filter(({ draft }) => editMap[draft.deviceId]?.selected)
    .map(({ draft }) => {
      const state = editMap[draft.deviceId]
      return { ...draft, cycleDays: Number(state.cycleDays) || draft.cycleDays, startDate: state.startDate }
    })
  result.value = submitSchedules(chosen)
}

function close() {
  emit('close')
}

function finish() {
  emit('submitted')
  emit('close')
}
</script>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal {
  background: #fff;
  border-radius: 10px;
  width: min(960px, 94vw);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  padding: 16px 18px;
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.modal-head h3 { margin: 0; font-size: 16px; }
.wizard-tip { font-size: 12px; color: var(--muted); margin: 8px 0; }
.wizard-body { overflow: auto; border: 1px solid var(--border); border-radius: 8px; }
.group-block { border-bottom: 1px solid var(--border); }
.group-block:last-child { border-bottom: none; }
.group-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: #f1f5fb;
  font-size: 13px;
}
.group-check { display: flex; align-items: center; gap: 6px; }
.group-meta { color: var(--muted); font-size: 12px; }
.group-count { margin-left: auto; color: var(--muted); font-size: 12px; }
.device-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px 8px 30px;
  border-top: 1px dashed #e2e8f0;
  font-size: 13px;
}
.device-pick { display: flex; align-items: center; gap: 6px; min-width: 150px; }
.device-param { color: var(--muted); flex: 1; }
.cycle-edit, .date-edit { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted); }
.cycle-edit input { width: 70px; padding: 4px 6px; border: 1px solid var(--border); border-radius: 4px; }
.date-edit input { padding: 4px 6px; border: 1px solid var(--border); border-radius: 4px; }
.faulty-block .device-row.disabled { color: var(--muted); background: #fafafa; }
.modal-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 12px;
}
.selected-tip { font-size: 12px; color: var(--muted); }
.footer-actions { display: flex; gap: 8px; }
.tag {
  display: inline-block;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  white-space: nowrap;
}
.tag.valid, .tag.ok { background: #e7f6ec; color: #157347; }
.tag.pending { background: #fef3e2; color: #9a6700; }
.tag.failed { background: #fdeaea; color: #b42318; }
.tag.rejected { background: #eceff3; color: #475569; }
.result-panel { overflow: auto; padding-top: 8px; }
.result-title { font-weight: 600; margin: 4px 0; }
.result-stats { display: flex; gap: 8px; margin-bottom: 8px; }
.result-tip { font-size: 12px; color: var(--muted); }
.result-detail { list-style: none; padding: 0; margin: 8px 0; max-height: 40vh; overflow: auto; font-size: 13px; }
.result-detail li { padding: 4px 0; border-bottom: 1px dashed #e2e8f0; }
.result-detail em { color: var(--muted); font-style: normal; margin-left: 8px; }
.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
  background: #94a3b8;
}
.status-dot.有效 { background: #16a34a; }
.status-dot.待补 { background: #d97706; }
.status-dot.失败 { background: #dc2626; }
.status-dot.驳回 { background: #64748b; }
</style>
