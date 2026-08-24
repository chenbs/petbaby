import { NextResponse } from "next/server";

import { routeError } from "@/server/errors";
import { createGeneration, listGenerations } from "@/server/platform-service";
import { requireUserId } from "@/server/auth/session";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { assertGenerationCircuit, clientAddress, enforceRateLimit } from "@/server/risk/controls";

export async function GET(request: Request) {
  try { return NextResponse.json({ data: await listGenerations(await requireUserId(request)) }); }
  catch (error) { return routeError(error); }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const userId = await requireUserId(request);
    await Promise.all([
      enforceRateLimit("generation:user", userId, 6, 60),
      enforceRateLimit("generation:ip", clientAddress(request), 20, 60),
      assertGenerationCircuit(),
    ]);
    const task = await createGeneration(userId, await request.json());
    if (!process.env.DATABASE_URL || process.env.DATABASE_URL === "memory://") {
      const { runNextTask } = await import("@/server/worker/generation-worker");
      await runNextTask();
    }
    return NextResponse.json({ data: task }, { status: 202 });
  } catch (error) {
    return routeError(error);
  }
}
