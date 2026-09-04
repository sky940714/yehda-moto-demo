import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentUser, loginUser, logout, logoutAll, registerUser, requestReset, resetPassword, savePhone, verifyEmail } from "../../../db/auth";

const COOKIE = "yada_session";
const jsonError = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
const link = (request: Request, action: string, token: string) => `${new URL(request.url).origin}/?auth=${action}&token=${encodeURIComponent(token)}`;

export async function GET() {
  const jar = await cookies();
  return NextResponse.json({ user: await currentUser(jar.get(COOKIE)?.value) });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return jsonError("請求格式錯誤。"); }
  const action = String(body.action || ""), jar = await cookies();
  try {
    if (action === "register") {
      const result = await registerUser(String(body.name||""), String(body.email||""), String(body.phone||""), String(body.password||""));
      const verificationUrl = link(request, "verify", result.token);
      console.info(`[DEV EMAIL] Verify ${result.user.email}: ${verificationUrl}`);
      return NextResponse.json({ message: "註冊成功，請完成 Email 驗證。", verificationUrl: process.env.NODE_ENV === "production" ? undefined : verificationUrl }, { status: 201 });
    }
    if (action === "verify") return (await verifyEmail(String(body.token||""))) ? NextResponse.json({ message: "Email 驗證成功，現在可以登入。" }) : jsonError("驗證連結無效或已過期。");
    if (action === "login") {
      const { user, session } = await loginUser(String(body.identifier||""), String(body.password||""));
      jar.set(COOKIE, session, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: body.remember ? 30*86400 : 86400 });
      return NextResponse.json({ user });
    }
    if (action === "forgot") {
      const token = await requestReset(String(body.email||""));
      const resetUrl = token ? link(request, "reset", token) : undefined;
      if (resetUrl) console.info(`[DEV EMAIL] Reset link: ${resetUrl}`);
      return NextResponse.json({ message: "若此 Email 已註冊，我們會寄出重設連結。", resetUrl: process.env.NODE_ENV === "production" ? undefined : resetUrl });
    }
    if (action === "reset") { await resetPassword(String(body.token||""), String(body.password||"")); return NextResponse.json({ message: "密碼已更新，請重新登入。" }); }
    if (action === "logout") { await logout(jar.get(COOKIE)?.value); jar.delete(COOKIE); return NextResponse.json({ ok: true }); }
    if (action === "logoutAll") { const user=await currentUser(jar.get(COOKIE)?.value); if(!user)return jsonError("尚未登入。",401); await logoutAll(user.id); jar.delete(COOKIE); return NextResponse.json({ ok:true }); }
    if (action === "phone") { const user=await currentUser(jar.get(COOKIE)?.value); if(!user)return jsonError("登入已失效，請重新登入。",401); return NextResponse.json({user:await savePhone(user.id,String(body.phone||""))}); }
    return jsonError("不支援的操作。");
  } catch (error) { console.error("Auth error", error); return jsonError(error instanceof Error ? error.message : "系統暫時無法處理。", 400); }
}
