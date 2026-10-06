/** 校准排程：一次提交可以安排多台设备，单台设备一条排程记录。 */
export type CalibrationSchedule = {
  id: number
  batchId: string
  deviceId: number
  deviceCode: string
  deviceType: string
  installLocation: string
  monitorParam: string
  /** 逐台调整后的校准周期（天）。 */
  cycleDays: number
  /** 校准计划开始日期。 */
  startDate: string
  /** 校准计划结束日期，与开始日期共同构成占用时段，同一设备不允许重叠。 */
  endDate: string
  /** 最近一次校准日期，用于分组与排序。 */
  lastCalibration: string
  /**
   * 有效：参数齐全且无冲突，进入正常校准队列；
   * 待补：设备缺少安装位置或校准参数，排程保留但不能下发，补录后可重试；
   * 失败：时段与该设备已有有效排程重叠（含重复提交），可改期重试；
   * 驳回：设备已故障，不允许进入正常校准队列。
   */
  status: '有效' | '待补' | '失败' | '驳回'
  /** 待补项字段名，状态为「待补」时使用。 */
  missingFields: string[]
  failReason: string
  createdAt: string
}

/** 流量测点暂停待办：有效排程下发后，在对应流量监测点生成。 */
export type FlowSuspendTodo = {
  id: number
  scheduleId: number
  batchId: string
  deviceId: number
  pointId: number
  pointCode: string
  pointLocation: string
  planDate: string
  cycleDays: number
  status: '待暂停' | '已暂停' | '已恢复'
  createdAt: string
}

/** 排程向导里逐台编辑的草稿。 */
export type ScheduleDraft = {
  deviceId: number
  deviceCode: string
  deviceType: string
  installLocation: string
  monitorParam: string
  cycleDays: number
  startDate: string
  lastCalibration: string
  faulty: boolean
  missingFields: string[]
}
