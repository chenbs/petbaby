/** 运营后台的状态与类目文案。服务端与客户端共用，避免同一个状态在不同页面叫法不一。 */

export type Tone = "neutral" | "good" | "warning" | "critical" | "info";

type StatusLabel = { label: string; tone: Tone };

const statusLabels: Record<string, StatusLabel> = {
  queued: { label: "排队中", tone: "info" },
  processing: { label: "处理中", tone: "info" },
  succeeded: { label: "成功", tone: "good" },
  ready: { label: "已完成", tone: "good" },
  preview_ready: { label: "预览就绪", tone: "good" },
  failed: { label: "失败", tone: "critical" },
  cancelled: { label: "已取消", tone: "neutral" },
  retried: { label: "已重试", tone: "neutral" },
  pending: { label: "待支付", tone: "warning" },
  paid: { label: "已支付", tone: "good" },
  completed: { label: "已完成", tone: "good" },
  closed: { label: "已关闭", tone: "neutral" },
  refunded: { label: "已退款", tone: "neutral" },
  partially_refunded: { label: "部分退款", tone: "warning" },
  producing: { label: "制作中", tone: "info" },
  shipped: { label: "已发货", tone: "info" },
  after_sale: { label: "售后中", tone: "warning" },
  scheduled: { label: "待发送", tone: "info" },
  sent: { label: "已发送", tone: "good" },
  unsubscribed: { label: "已退订", tone: "neutral" },
  partial: { label: "部分完成", tone: "warning" },
  active: { label: "正常", tone: "good" },
  suspended: { label: "已停用", tone: "critical" },
  deleted: { label: "已注销", tone: "neutral" },
  live: { label: "上线", tone: "good" },
  testing: { label: "测试中", tone: "info" },
  idea: { label: "构想", tone: "neutral" },
  archived: { label: "已归档", tone: "neutral" },
  paused: { label: "已停用", tone: "neutral" },
  draft: { label: "草稿", tone: "neutral" },
  generating: { label: "生成中", tone: "info" },
  hidden: { label: "已隐藏", tone: "neutral" },
  restored: { label: "已恢复", tone: "good" },
  private: { label: "私密", tone: "neutral" },
  shared: { label: "公开分享", tone: "info" },
  expired: { label: "已过期", tone: "neutral" },
};

export function statusLabel(status: unknown): StatusLabel {
  const key = String(status ?? "");
  return statusLabels[key] || { label: key || "—", tone: "neutral" };
}

export const ORDER_KIND_LABELS: Record<string, string> = {
  work: "作品单（历史）",
  growth: "增值订单",
  physical: "实体订单",
};

export const GROWTH_KIND_LABELS: Record<string, string> = {
  wallet_topup: "冻干充值",
  art_photo_bundle: "写真套餐",
  health_archive: "健康档案",
  annual_report: "年度报告",
  membership: "会员（已下线）",
};

export const REVENUE_SOURCE_LABELS: Record<string, string> = {
  topup: "冻干充值",
  growth: "其他增值单",
  physical: "实体商品",
  work: "历史作品单",
};

/** 冻干消耗按业务对象归类（wallet_ledger.ref_type） */
export const SPEND_REF_LABELS: Record<string, string> = {
  ai_run: "创意照片",
  art_photo_batch: "写真套餐",
  generation_task: "排版玩法",
  video_render: "短片",
  annual_report: "年度报告",
  health_document: "健康档案",
  work: "作品解锁",
  growth_order: "增值订单",
  other: "其他",
};

export const LEDGER_REASON_LABELS: Record<string, string> = {
  topup: "充值到账",
  newcomer_gift: "见面礼",
  admin_grant: "后台补偿",
  spend: "消耗",
  spend_return: "失败退还",
  expire: "赠送过期",
  topup_refund: "充值退款回收",
};

export const PROVIDER_LABELS: Record<string, string> = {
  development: "模拟支付",
  virtual: "微信虚拟支付",
  wechat: "微信支付",
};

export const TRIAGE_LABELS: Record<string, string> = {
  emergency: "立即就医",
  urgent_24h: "24 小时内就医",
  observe: "居家观察",
  routine: "日常护理",
};

export const SPECIES_LABELS: Record<string, string> = { cat: "猫", dog: "狗", other: "其他" };
export const LIFE_STAGE_LABELS: Record<string, string> = { active: "日常", senior: "老年", memorial: "纪念" };

export const AUDIT_TARGET_LABELS: Record<string, string> = {
  user: "用户",
  wallet: "钱包",
  order: "作品订单",
  growth_order: "增值订单",
  physical_order: "实体订单",
  task: "生成任务",
  work: "作品",
  system: "系统",
  plugin: "玩法",
  experiment: "赛马",
  subscription: "订阅消息",
  annual_report: "年度报告",
  annual_report_template: "报告模板",
  memorial: "纪念空间",
  memorial_catalog: "纪念目录",
  video_catalog: "视频目录",
  video_render: "视频任务",
  home_curation: "麻麻精选",
};

const auditActionLabels: Record<string, string> = {
  user_suspend: "停用用户",
  user_reactivate: "恢复用户",
  wallet_grant_gift: "发放冻干补偿",
  admin_retry_task: "重试排版任务",
  admin_refund_order: "作品单退款",
  admin_close_share: "关闭作品分享",
  admin_set_circuit: "切换生成熔断",
  admin_retry_ai: "重试图片任务",
  admin_cancel_ai: "取消图片任务",
  admin_set_ai_circuit: "切换模型熔断",
  retry_subscription: "重试订阅消息",
  close_subscription: "关闭订阅消息",
  create_report_template: "发布报告模板",
  retry_report: "重试年度报告",
  refund_growth_order: "增值单退款",
  plugin_publish: "发布玩法配置",
  close_share: "关闭纪念分享",
  retry_video: "重试纪念视频",
  catalog_status: "切换目录状态",
  catalog_default: "设为默认版本",
  catalog_rollback: "重新发布目录版本",
  memorial_catalog_publish: "发布纪念目录",
  "home_curation.update": "更新麻麻精选",
  video_catalog_publish: "发布视频目录",
  video_render_retry: "重试视频渲染",
  video_render_cancel: "取消视频渲染",
  set_status: "切换目录状态",
  set_default: "设为默认版本",
  rollback: "重新发布版本",
  physical_status: "实体单流转",
};

export function auditActionLabel(action: unknown) {
  const key = String(action ?? "");
  return auditActionLabels[key] || key || "—";
}
