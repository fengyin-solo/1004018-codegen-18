<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <!-- 待校准设备：监测设备校准排程提交后汇总到这里 -->
    <section class="panel">
      <header class="panel-head">
        <div>
          <h3>待校准设备</h3>
          <p class="page-desc">来源：监测设备校准排程；已故障设备不进入队列，另有 {{ calibration.failedCount }} 条排程因待补项或时段冲突提交失败。</p>
        </div>
      </header>
      <table class="data-table compact">
        <thead>
          <tr>
            <th>设备编号</th>
            <th>设备类型</th>
            <th>安装位置</th>
            <th>校准周期</th>
            <th>最近校准</th>
            <th>计划校准开始</th>
            <th>设备状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="device in calibration.pendingDevices" :key="String(device.id)">
            <td>{{ device['设备编号'] }}</td>
            <td>{{ device['设备类型'] }}</td>
            <td>{{ device['安装位置'] || '待补录' }}</td>
            <td>{{ device['校准周期'] || '待补录' }}</td>
            <td>{{ device['最近校准'] || '—' }}</td>
            <td>{{ device['校准开始时间'] || '待排程' }}</td>
            <td><span class="tag info">{{ device.status }}</span></td>
          </tr>
          <tr v-if="!calibration.pendingDevices.length">
            <td colspan="7" class="empty-state">暂无待校准设备，去「监测设备」安排校准排程</td>
          </tr>
        </tbody>
      </table>
    </section>

    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import type { CalibrationOverview, OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const calibration = ref<CalibrationOverview>({ pendingDevices: [], activeSchedules: [], failedCount: 0 })

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  calibration.value = payload.calibration
}

onMounted(refresh)
</script>
