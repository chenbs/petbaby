import { z } from "zod";

import { assertAdmin } from "@/server/auth/admin";
import { requireUserId } from "@/server/auth/session";
import { getDatabase } from "@/server/db/client";
import { AppError, routeError } from "@/server/errors";
import { objectStorage } from "@/server/storage";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertAdmin(await requireUserId(request));
    const { id } = await context.params;
    const orderId = z.string().uuid().parse(id);
    const rows = await (await getDatabase()).query("SELECT print_pdf_key FROM physical_orders WHERE id=$1", [orderId]);
    if (!rows[0]?.print_pdf_key) throw new AppError("PRINT_PDF_NOT_FOUND", "印刷 PDF 尚未生成", 404);
    const object = await objectStorage.get(String(rows[0].print_pdf_key));
    if (!object) throw new AppError("PRINT_PDF_NOT_FOUND", "印刷 PDF 不存在", 404);
    return new Response(new Uint8Array(object.body), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="physical-order-${orderId}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
