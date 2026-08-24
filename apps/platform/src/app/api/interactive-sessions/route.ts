import { NextResponse } from "next/server";
import { assertTrustedMutation } from "@/server/auth/request-guard"; import { requireUserId } from "@/server/auth/session"; import { routeError } from "@/server/errors"; import { createInteractiveSession } from "@/server/growth-service";
export async function POST(request: Request){try{assertTrustedMutation(request);return NextResponse.json({data:await createInteractiveSession(await requireUserId(request),await request.json())},{status:201});}catch(error){return routeError(error);}}
