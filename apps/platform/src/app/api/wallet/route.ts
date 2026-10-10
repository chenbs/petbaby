import { NextResponse } from "next/server";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { getNewcomerGiftOffer, getWallet } from "@/server/wallet/service";
import { ANNUAL_REPORT_COST, HEALTH_DOCUMENT_COST, MEMORIAL_FILM_COST } from "@/domain/dongan-pricing";

/** 冻干余额、赠送所得最近到期、首充资格，以及见面礼是否还能领（首页建档卡用，颗数不在端上写死）。 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId(request);
    const wallet = await getWallet(userId);
    const newcomerGift = await getNewcomerGiftOffer(userId);
    return NextResponse.json({ data: { ...wallet, newcomerGift, costs: { annualReport: ANNUAL_REPORT_COST, healthDocument: HEALTH_DOCUMENT_COST, memorialFilm: MEMORIAL_FILM_COST } } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return routeError(error); }
}
