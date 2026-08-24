import { LoginClient } from "@/components/login-client";
import { passwordAuthEnabled } from "@/server/auth/password";
import { getOptionalUserId } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const userId = await getOptionalUserId();
  return <main className="screen">
    <div className="page-heading"><span className="eyebrow">SIGN IN</span><h1>登录宠物造物局</h1><p>使用账号密码登录或注册；微信小程序内会自动完成登录。</p></div>
    <LoginClient
      authenticated={Boolean(userId)}
      inviteRequired={Boolean(process.env.PASSWORD_AUTH_INVITE_CODE?.trim())}
      passwordAuthEnabled={passwordAuthEnabled()}
    />
  </main>;
}
