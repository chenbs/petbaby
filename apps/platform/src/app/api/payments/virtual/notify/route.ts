import { handleVirtualNotification, verifyVirtualEndpoint } from "@/server/payments/virtual-notify";
import { routeError } from "@/server/errors";

export async function GET(request: Request) {
  try { return verifyVirtualEndpoint(request); } catch (error) { return routeError(error); }
}

export async function POST(request: Request) {
  try { return await handleVirtualNotification(request); } catch (error) { return routeError(error); }
}
