import { NextResponse } from "next/server";
import { listFunTests } from "@/server/fun-test-service";

export function GET() {
  return NextResponse.json({ data: listFunTests() });
}
