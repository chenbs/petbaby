import { NextResponse } from "next/server"; import { routeError } from "@/server/errors"; import { listPhysicalSkus } from "@/server/growth-service";
export async function GET(){try{return NextResponse.json({data:await listPhysicalSkus()});}catch(error){return routeError(error);}}
