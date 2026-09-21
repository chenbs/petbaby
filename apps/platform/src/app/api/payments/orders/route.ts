import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { listPaymentOrders } from "@/server/payments/service";

export async function GET(request: Request) {
  try { return Response.json({ data: await listPaymentOrders(await requireUserId(request)) }); }
  catch (error) { return routeError(error); }
}
