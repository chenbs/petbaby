import { NextResponse } from "next/server";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { deleteAccount } from "@/server/account-service";
export async function POST(request: Request) { try { assertTrustedMutation(request); return NextResponse.json({ data: await deleteAccount(await requireUserId(request)) }); } catch (error) { return routeError(error); } }
