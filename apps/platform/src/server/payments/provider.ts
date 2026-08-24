import "server-only";

import { createSign, randomBytes } from "node:crypto";
import type { Order } from "@/domain/models";
import { AppError } from "@/server/errors";
import { getDatabase } from "@/server/db/client";
import { isStaging } from "@/server/runtime-mode";

export interface PaymentProvider { create(order:Order):Promise<{providerOrderId:string;clientParams:Record<string,string>}>; refund(order:Order,amount:number,reason:string):Promise<{providerRefundId:string}>; }
class DevelopmentPaymentProvider implements PaymentProvider { async create(order:Order){return{providerOrderId:`dev-${order.id}`,clientParams:{mode:"development"}};}async refund(order:Order){return{providerRefundId:`dev-refund-${order.id}`};} }

function required(name:string){const value=process.env[name];if(!value)throw new AppError("PAYMENT_CONFIG_PENDING",`${name} 尚未配置`,503);return value.replaceAll("\\n","\n");}
function authorization(method:string,path:string,body:string){const mchid=required("WECHAT_MCH_ID");const serial=required("WECHAT_CERT_SERIAL");const privateKey=required("WECHAT_MCH_PRIVATE_KEY");const timestamp=Math.floor(Date.now()/1000).toString();const nonce=randomBytes(16).toString("hex");const signer=createSign("RSA-SHA256");signer.update(`${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`);const signature=signer.sign(privateKey,"base64");return{header:`WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${serial}",signature="${signature}"`,timestamp,nonce};}
async function wechatRequest<T>(method:string,path:string,payload:unknown){const body=JSON.stringify(payload);const signed=authorization(method,path,body);const response=await fetch(`https://api.mch.weixin.qq.com${path}`,{method,headers:{Authorization:signed.header,"Content-Type":"application/json","Accept":"application/json","User-Agent":"petbaby/1.0"},body});const result=await response.json().catch(()=>({})) as T&{message?:string};if(!response.ok)throw new AppError("WECHAT_PAY_FAILED",result.message||`微信支付请求失败 ${response.status}`,502);return result;}

export class WechatPaymentProvider implements PaymentProvider {
  async create(order:Order){const database=await getDatabase();const users=await database.query("SELECT wechat_openid FROM users WHERE id=$1",[order.userId]);const openid=users[0]?.wechat_openid;if(!openid)throw new AppError("WECHAT_OPENID_REQUIRED","当前账户缺少微信 OpenID",422);const appid=required("WECHAT_APP_ID");const path="/v3/pay/transactions/jsapi";const result=await wechatRequest<{prepay_id:string}>("POST",path,{appid,mchid:required("WECHAT_MCH_ID"),description:`PETBABY ${order.pluginId}`,out_trade_no:order.id.replaceAll("-","").slice(0,32),notify_url:required("WECHAT_PAY_NOTIFY_URL"),amount:{total:Math.round(order.amount*100),currency:"CNY"},payer:{openid}});const packageValue=`prepay_id=${result.prepay_id}`;const timestamp=Math.floor(Date.now()/1000).toString();const nonce=randomBytes(16).toString("hex");const signer=createSign("RSA-SHA256");signer.update(`${appid}\n${timestamp}\n${nonce}\n${packageValue}\n`);const paySign=signer.sign(required("WECHAT_MCH_PRIVATE_KEY"),"base64");return{providerOrderId:result.prepay_id,clientParams:{timeStamp:timestamp,nonceStr:nonce,package:packageValue,signType:"RSA",paySign}};}
  async refund(order:Order,amount:number,reason:string){const result=await wechatRequest<{refund_id:string}>("POST","/v3/refund/domestic/refunds",{out_trade_no:order.id.replaceAll("-","").slice(0,32),out_refund_no:`${order.id.replaceAll("-","").slice(0,24)}${Date.now().toString().slice(-8)}`,reason,notify_url:required("WECHAT_REFUND_NOTIFY_URL"),amount:{refund:Math.round(amount*100),total:Math.round(order.amount*100),currency:"CNY"}});return{providerRefundId:result.refund_id};}
}

// 模拟支付只允许开发环境与显式声明的 staging 测试机；正式生产始终使用微信支付适配器。
export function selectPaymentProvider():PaymentProvider{
  if(process.env.PAYMENT_PROVIDER==="wechat")return new WechatPaymentProvider();
  if(process.env.NODE_ENV!=="production")return new DevelopmentPaymentProvider();
  if(isStaging()&&process.env.PAYMENT_PROVIDER==="development")return new DevelopmentPaymentProvider();
  return new WechatPaymentProvider();
}
export const paymentProvider:PaymentProvider=selectPaymentProvider();
