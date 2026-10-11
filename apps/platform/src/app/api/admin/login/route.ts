import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAdminAudit } from "@/server/admin/audit";
import { loginAdmin } from "@/server/admin/auth";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { setSession } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { clientAddress, enforceRateLimit } from "@/server/risk/controls";

const inputSchema = z.object({ accountName: z.string().trim().min(3).max(32), password: z.string().min(1).max(72) });

/** 运营后台登录。唯一不要求已是管理员的 /api/admin 接口；只写 Cookie，不在响应里返回 token。 */
export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const input = inputSchema.parse(await request.json());
    await Promise.all([
      enforceRateLimit("admin:login:ip", clientAddress(request), 20, 600),
      enforceRateLimit("admin:login:account", input.accountName.toLowerCase(), 8, 600),
    ]);
    const { userId } = await loginAdmin(input);
    await setSession(userId);
    await recordAdminAudit({ actorId: userId, action: "admin_login", targetType: "user", targetId: userId, reason: "后台登录", metadata: { ip: clientAddress(request) }, userId });
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return routeError(error);
  }
}
