import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const clientId=process.env.GOOGLE_CLIENT_ID;
  if(!clientId)return NextResponse.json({error:"Google 登入尚未設定。"},{status:503});
  const state=randomBytes(24).toString("base64url"), jar=await cookies();
  jar.set("yada_oauth_state",state,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/",maxAge:600});
  const origin=new URL(request.url).origin;
  const query=new URLSearchParams({client_id:clientId,redirect_uri:`${origin}/api/auth/callback/google`,response_type:"code",scope:"openid email profile",state,prompt:"select_account"});
  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${query}`);
}
