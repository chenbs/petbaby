import { NextResponse } from "next/server";

import { ART_PHOTO_BUNDLE_PACKAGES } from "@/server/art-photo-bundle-service";
import { getRuntimePlugin } from "@/plugins/runtime";
import { routeError } from "@/server/errors";

/*
 * 写真套餐价目（2026-09）：小程序原先把 ¥9.9 / ¥19.9 写死在 WXML 里，改价要发版。
 * 这里与下单同源（ART_PHOTO_BUNDLE_PACKAGES），单张价取 pl-10 manifest。
 * 同时给出每套单价，页面据此展示「≈ ¥0.99 / 套」，让价格阶梯一眼可比。
 */
export async function GET() {
  try {
    const single = await getRuntimePlugin("pl-10");
    const round = (value: number) => Math.round(value * 100) / 100;
    return NextResponse.json({
      data: {
        single: single ? { amount: single.pricing.unlockPrice, count: 1, label: "单张写真" } : undefined,
        ten: { amount: ART_PHOTO_BUNDLE_PACKAGES.ten.amount, count: ART_PHOTO_BUNDLE_PACKAGES.ten.count, perScene: round(ART_PHOTO_BUNDLE_PACKAGES.ten.amount / ART_PHOTO_BUNDLE_PACKAGES.ten.count), label: "精选 10 套", recommended: true },
        all: { amount: ART_PHOTO_BUNDLE_PACKAGES.all.amount, count: ART_PHOTO_BUNDLE_PACKAGES.all.count, perScene: round(ART_PHOTO_BUNDLE_PACKAGES.all.amount / ART_PHOTO_BUNDLE_PACKAGES.all.count), label: `全部 ${ART_PHOTO_BUNDLE_PACKAGES.all.count} 套` },
      },
    });
  } catch (error) { return routeError(error); }
}
