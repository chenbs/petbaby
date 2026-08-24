import "server-only";

import { runtimeMode, type RuntimeMode } from "@/server/runtime-mode";

export type ConfigCheck = { key: string; required: boolean; configured: boolean; hint: string };

export function inspectConfiguration(): { environment: string; mode: RuntimeMode; checks: ConfigCheck[]; productionReady: boolean } {
  const mode = runtimeMode();
  const production = mode === "production";
  // staging 测试机与正式生产同样需要真实数据库、独立密钥和 HTTPS 地址；
  // 微信、支付、云存储凭据只有正式生产强制要求。
  const hosted = mode !== "development";
  const checks: ConfigCheck[] = [
    { key: "SESSION_SECRET", required: hosted, configured: Boolean(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32), hint: "至少 32 位随机字符串" },
    { key: "WORKER_SECRET", required: hosted, configured: Boolean(process.env.WORKER_SECRET && process.env.WORKER_SECRET.length >= 32), hint: "至少 32 位随机字符串，用于 internal/* 接口" },
    { key: "DATABASE_URL", required: hosted, configured: Boolean(process.env.DATABASE_URL?.startsWith("postgres")), hint: "PostgreSQL 连接串，禁止 PGlite" },
    { key: "PUBLIC_APP_URL", required: hosted, configured: Boolean(process.env.PUBLIC_APP_URL?.startsWith("https://")), hint: "HTTPS H5 地址" },
    { key: "OBJECT_STORAGE_PROVIDER", required: hosted, configured: Boolean(process.env.OBJECT_STORAGE_PROVIDER), hint: "生产填 s3；staging 可填 local" },
    { key: "ADDRESS_ENCRYPTION_KEY", required: hosted, configured: Boolean(process.env.ADDRESS_ENCRYPTION_KEY), hint: "实体订单地址加密密钥" },
    { key: "ADMIN_USER_IDS", required: production, configured: Boolean(process.env.ADMIN_USER_IDS), hint: "管理员 UUID 白名单，未配置时后台返回 404" },
    { key: "WECHAT_APP_ID", required: production, configured: Boolean(process.env.WECHAT_APP_ID), hint: "微信小程序 AppID" },
    { key: "WECHAT_APP_SECRET", required: production, configured: Boolean(process.env.WECHAT_APP_SECRET), hint: "仅写入密钥管理" },
    { key: "PAYMENT_PROVIDER", required: production, configured: Boolean(process.env.PAYMENT_PROVIDER === "wechat"), hint: "生产固定为 wechat" },
    /*
     * AI 图片凭据。正式生产必需 —— provider 在缺凭据时会以
     * AI_PROVIDER_CONFIG_PENDING(503) 失败而不再回落占位图，
     * 所以漏配的症状是「PL-10 全线失败」。放进 productionReady 才能在
     * /api/health 上提前暴露，而不是等用户下单才发现。
     *
     * lingsuan 与通用 HTTP 二者有其一即可：主备两条通道都能独立承担主位。
     */
    {
      key: "LINGSUAN_IMAGE_API_KEY",
      required: production,
      configured: Boolean((process.env.LINGSUAN_IMAGE_BASE_URL && process.env.LINGSUAN_IMAGE_API_KEY) || (process.env.AI_IMAGE_ENDPOINT && process.env.AI_IMAGE_API_KEY)),
      hint: "AI 图片主通道；或改配 AI_IMAGE_ENDPOINT + AI_IMAGE_API_KEY。生产缺失时 PL-10 直接 503",
    },
  ];
  return { environment: process.env.NODE_ENV || "development", mode, checks, productionReady: checks.every((check) => !check.required || check.configured) };
}
