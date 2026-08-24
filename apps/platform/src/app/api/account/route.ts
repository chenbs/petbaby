import { NextResponse } from "next/server";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { getAccountProfile, updateAccountProfile } from "@/server/account-service";

export async function GET(request: Request) { try { return NextResponse.json({ data: await getAccountProfile(await requireUserId(request)) }); } catch (error) { return routeError(error); } }
export async function PATCH(request: Request) { try { assertTrustedMutation(request); return NextResponse.json({ data: await updateAccountProfile(await requireUserId(request), await request.json()) }); } catch (error) { return routeError(error); } }
