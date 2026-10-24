/*
 * 新用户渠道归因（2026-10-12，不投流期的增长口径）。
 *
 * 小程序冷启动时拿到的场景值（App.onLaunch 的 options.scene）按来源归成几类，
 * 再叠加运营投放标记 src（写在小程序路径、公众号文章卡片、视频号链接、线下小程序码里，例如 xhs-1012-human）。
 * 只在新建账号那一次写入；原始场景值另存一列，归类表以后改了也能回溯。
 *
 * 场景值清单见微信文档「场景值列表」。只收录这里用得上的，未收录的一律记 other。
 */
export const ACQUISITION_CHANNELS = ["invite", "share", "moments", "qrcode", "search", "channels", "official_account", "link", "mini_program", "subscribe_message", "direct", "ad", "other"] as const;
export type AcquisitionChannel = (typeof ACQUISITION_CHANNELS)[number];

export const ACQUISITION_CHANNEL_LABELS: Record<AcquisitionChannel, string> = {
  invite: "好友邀请",
  share: "聊天分享卡片",
  moments: "朋友圈",
  qrcode: "扫码",
  search: "微信搜索",
  channels: "视频号",
  official_account: "公众号",
  link: "外部链接",
  mini_program: "其他小程序",
  subscribe_message: "订阅消息",
  direct: "最近使用 / 我的小程序",
  ad: "广告",
  other: "其他",
};

const SCENE_GROUPS: Array<[AcquisitionChannel, number[]]> = [
  // 单聊 / 群聊里的小程序卡片、带 shareTicket 的卡片、App 分享卡片
  ["share", [1007, 1008, 1036, 1044, 1096]],
  // 朋友圈单页模式
  ["moments", [1154, 1155]],
  // 二维码与小程序码：扫一扫、长按识别、相册选取
  ["qrcode", [1011, 1012, 1013, 1047, 1048, 1049]],
  // 微信首页搜索、发现栏搜索、搜一搜、下拉搜索
  ["search", [1005, 1006, 1027, 1042, 1053, 1106]],
  // 视频号主页、直播间、视频号链接、活动、服务菜单、商品
  ["channels", [1175, 1176, 1177, 1184, 1191, 1193, 1195, 1197, 1198]],
  // 公众号菜单、文章、模板消息、会话卡片、文字链、服务预览、服务号会话、H5 开放标签
  ["official_account", [1020, 1035, 1043, 1058, 1074, 1082, 1091, 1102, 1157, 1167]],
  // URL Scheme / URL Link（短信、浏览器、其他 App 拉起）
  ["link", [1065, 1194]],
  ["mini_program", [1037, 1038]],
  ["subscribe_message", [1014, 1107]],
  // 最近使用、我的小程序、桌面图标
  ["direct", [1001, 1023, 1089, 1103, 1104, 1256]],
  // 朋友圈广告、公众号文章广告、小程序广告组件
  ["ad", [1045, 1046, 1067, 1068, 1084]],
];

const SCENE_TO_CHANNEL = new Map<number, AcquisitionChannel>(SCENE_GROUPS.flatMap(([channel, scenes]) => scenes.map((scene) => [scene, channel] as const)));

/** 场景值 → 渠道。没有场景值（Web/H5 或旧版小程序）记 other。 */
export function channelForScene(scene: number | undefined | null): AcquisitionChannel {
  if (!scene || !Number.isInteger(scene)) return "other";
  return SCENE_TO_CHANNEL.get(scene) || "other";
}

/** 运营投放标记：字母数字开头，只含字母数字、下划线、短横线，最长 40；统一小写。不合规的丢弃而不是报错。 */
export function normalizeSource(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,39}$/.test(trimmed) ? trimmed : undefined;
}

export function acquisitionChannelLabel(channel: unknown) {
  return ACQUISITION_CHANNEL_LABELS[channel as AcquisitionChannel] || "未记录";
}
