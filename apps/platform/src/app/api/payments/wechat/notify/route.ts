import { NextResponse } from "next/server";import { handleWechatNotification } from "@/server/payments/wechat-notify";
export async function POST(request:Request){try{await handleWechatNotification(request);return NextResponse.json({code:"SUCCESS",message:"成功"});}catch(error){return NextResponse.json({code:"FAIL",message:error instanceof Error?error.message:"失败"},{status:400});}}
