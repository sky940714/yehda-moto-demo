import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { oauthLogin } from "../../../../../db/auth";

export async function GET(request:Request){
  const url=new URL(request.url),code=url.searchParams.get("code"),state=url.searchParams.get("state"),jar=await cookies(),saved=jar.get("yada_oauth_state")?.value;
  jar.delete("yada_oauth_state");
  if(!code||!state||!saved||state!==saved)return NextResponse.redirect(`${url.origin}/?authError=invalid_state`);
  try{
    const tokenResponse=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:process.env.GOOGLE_CLIENT_ID||"",client_secret:process.env.GOOGLE_CLIENT_SECRET||"",redirect_uri:`${url.origin}/api/auth/callback/google`,grant_type:"authorization_code"})});
    if(!tokenResponse.ok)throw new Error(`Google token exchange failed: ${tokenResponse.status}`);
    const token=await tokenResponse.json() as {access_token:string};
    const profileResponse=await fetch("https://openidconnect.googleapis.com/v1/userinfo",{headers:{Authorization:`Bearer ${token.access_token}`}});
    if(!profileResponse.ok)throw new Error("Google profile request failed");
    const profile=await profileResponse.json() as {sub:string;email:string;email_verified?:boolean;name?:string};
    if(!profile.email||profile.email_verified===false)throw new Error("Google Email 未驗證");
    const result=await oauthLogin("google",profile.sub,profile.email,profile.name||"會員");
    jar.set("yada_session",result.session,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/",maxAge:30*86400});
    return NextResponse.redirect(`${url.origin}/?auth=${result.user.phone?"complete":"phone"}`);
  }catch(error){console.error("Google OAuth error",error);return NextResponse.redirect(`${url.origin}/?authError=google`);}
}
