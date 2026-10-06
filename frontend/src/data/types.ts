/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
  calibration: CalibrationOverview
}

/** 校准排程记录：有效排程与提交失败（含待补项）条目都落在这张表里，失败条目保留下来供重试。 */
export type CalibrationScheduleRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  scheduleNo: string
  deviceId: number
  设备编号: string
  设备类型: string
  安装位置: string
  校准周期: string
  最近校准: string
  计划开始: string
  计划结束: string
  失败原因: string
  提交时间: string
  [field: string]: string | number | boolean
}

/** 校准排程同步到流量监测页的测点暂停待办。 */
export type FlowPauseTodoRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  todoNo: string
  scheduleNo: string
  deviceId: number
  监测点编号: string
  监测点位: string
  关联设备: string
  校准开始: string
  校准结束: string
  生成时间: string
  [field: string]: string | number | boolean
}

export type CalibrationOverview = {
  pendingDevices: EntryRow[]
  activeSchedules: CalibrationScheduleRow[]
  failedCount: number
}
