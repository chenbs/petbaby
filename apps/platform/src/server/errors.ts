import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly retryAfterSeconds?: number,
    /** 端上需要的结构化信息，原样随错误下发（例如余额不足时的需要 / 现有 / 差额颗数） */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function routeError(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: error.issues[0]?.message ?? "输入内容不完整",
        },
      },
      { status: 422 },
    );
  }

  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}), ...(error.details ? { details: error.details } : {}) } },
      { status: error.status, ...(error.retryAfterSeconds ? { headers: { "Retry-After": String(error.retryAfterSeconds) } } : {}) },
    );
  }

  console.error(error);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "服务暂时不可用，请稍后再试" } },
    { status: 500 },
  );
}
