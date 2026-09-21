import { z } from "zod";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { paymentStatus, prepareOrderPayment, refundOrderPayment } from "./service";
import type { OrderKind } from "./types";

type Context = { params: Promise<{ id: string }> };

export function preparePaymentRoute(kind: OrderKind) {
  return async (request: Request, context: Context) => {
    try {
      assertTrustedMutation(request);
      const userId = await requireUserId(request);
      const id = z.string().uuid().parse((await context.params).id);
      const client = request.headers.get("X-Petbaby-Client") === "miniprogram" ? "miniprogram" : "web";
      return Response.json({ data: await prepareOrderPayment(userId, kind, id, client) });
    } catch (error) { return routeError(error); }
  };
}

export function paymentStatusRoute(kind: OrderKind) {
  return async (request: Request, context: Context) => {
    try {
      const userId = await requireUserId(request);
      const id = z.string().uuid().parse((await context.params).id);
      return Response.json({ data: await paymentStatus(userId, kind, id) });
    } catch (error) { return routeError(error); }
  };
}

export function refundPaymentRoute(kind: OrderKind) {
  return async (request: Request, context: Context) => {
    try {
      assertTrustedMutation(request);
      const userId = await requireUserId(request);
      const id = z.string().uuid().parse((await context.params).id);
      const input = z.object({ reason: z.enum(["generation_failed", "dissatisfied", "requested"]).default("requested") }).parse(await request.json());
      return Response.json({ data: await refundOrderPayment(userId, kind, id, input.reason) });
    } catch (error) { return routeError(error); }
  };
}
