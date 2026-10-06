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

    <div class="overview-split">
      <div class="overview-block">
        <h3 class="block-title">待校准设备</h3>
        <div class="calibration-summary">
          <span class="legend-item">有效排程：{{ calibration.valid }}</span>
          <span class="legend-item">待补项：{{ calibration.pendingSupplement }}</span>
          <span class="legend-item">失败待重试：{{ calibration.failed }}</span>
        </div>
        <table class="data-table">
          <thead>
            <tr><th>设备编号</th><th>设备类型</th><th>安装位置</th><th>计划校准日期</th><th>排程批次</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in calibration.upcoming" :key="`${item.batchId}-${item.deviceId}`">
              <td>{{ item.deviceCode }}</td>
              <td>{{ item.deviceType }}</td>
              <td>{{ item.installLocation || '—' }}</td>
              <td>{{ item.startDate }}</td>
              <td>{{ item.batchId }}</td>
            </tr>
            <tr v-if="!calibration.upcoming.length">
              <td colspan="5" class="empty-state">暂无待校准设备，可到「监测设备」页安排校准排程</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="overview-block">
        <h3 class="block-title">业务模块汇总</h3>
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
      </div>
    </div>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const calibration = ref<OverviewResult['calibration']>({
  valid: 0,
  pendingSupplement: 0,
  failed: 0,
  upcoming: [],
})

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  calibration.value = payload.calibration
}

onMounted(refresh)
</script>

<style scoped>
.overview-split {
  display: grid;
  grid-template-columns: minmax(420px, 5fr) minmax(360px, 4fr);
  gap: 16px;
  align-items: start;
}
.overview-block {
  background: transparent;
}
.block-title {
  margin: 4px 0 8px;
  font-size: 15px;
}
.calibration-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.calibration-summary .legend-item {
  background: #eef2f7;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  color: var(--muted);
}
@media (max-width: 1100px) {
  .overview-split { grid-template-columns: 1fr; }
}
</style>
