import { NextResponse } from "next/server";

import { ART_PHOTO_BUNDLE_PACKAGES } from "@/server/art-photo-bundle-service";
import { AI_RUN_COST, DONGAN_UNIT } from "@/domain/dongan-pricing";
import { routeError } from "@/server/errors";

/*
 * 写真套餐价目（2026-10-08 起按冻干计价）：单张 2 颗、10 张 12 颗、20 张 20 颗。
 * 与扣费同源（domain/dongan-pricing.ts），端上不写死颗数。
 */
export async function GET() {
  try {
    const perScene = (cost: number, count: number) => Math.round((cost / count) * 10) / 10;
    return NextResponse.json({
      data: {
        unit: DONGAN_UNIT,
        single: { cost: AI_RUN_COST.pet, count: 1, label: "单张写真" },
        ten: { cost: ART_PHOTO_BUNDLE_PACKAGES.ten.cost, count: 10, perScene: perScene(ART_PHOTO_BUNDLE_PACKAGES.ten.cost, 10), label: ART_PHOTO_BUNDLE_PACKAGES.ten.label, recommended: true },
        twenty: { cost: ART_PHOTO_BUNDLE_PACKAGES.twenty.cost, count: 20, perScene: perScene(ART_PHOTO_BUNDLE_PACKAGES.twenty.cost, 20), label: ART_PHOTO_BUNDLE_PACKAGES.twenty.label },
      },
    });
  } catch (error) { return routeError(error); }
}
