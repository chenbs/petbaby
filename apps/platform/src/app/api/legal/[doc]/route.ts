import { NextResponse } from "next/server";

import { getLegalDocument } from "@/domain/legal";
import { AppError, routeError } from "@/server/errors";

/*
 * 隐私政策 / 用户协议 / 退款规则（公开、只读）。小程序 pages/legal 用它渲染，
 * 与 Web 的 /legal/* 共用 domain/legal.ts，端上不写正文。
 */
export async function GET(_request: Request, context: { params: Promise<{ doc: string }> }) {
  try {
    const { doc } = await context.params;
    const document = getLegalDocument(doc);
    if (!document) throw new AppError("LEGAL_NOT_FOUND", "文档不存在", 404);
    return NextResponse.json({ data: document }, { headers: { "cache-control": "public, max-age=300" } });
  } catch (error) {
    return routeError(error);
  }
}
