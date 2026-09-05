import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { adminPasswordLogin, logoutAdmin } from "../../../../db/auth";

const attempts = new Map<string,{count:number;resetAt:number}>();
const windowMs = 15 * 60 * 1000;

function clientKey(forwarded:string|null){return (forwarded?.split(",")[0]||"local").trim();}

export async function POST(request:Request){
  const h=await headers(),key=clientKey(h.get("x-forwarded-for")),now=Date.now(),entry=attempts.get(key);
  if(entry&&entry.resetAt>now&&entry.count>=5)return NextResponse.json({error:"登入嘗試次數過多，請 15 分鐘後再試。"},{status:429});
  try{
    const body=await request.json(),result=await adminPasswordLogin(String(body.email||""),String(body.password||""));
    attempts.delete(key);
    const response=NextResponse.json({ok:true,user:{name:result.user.name,role:result.user.role}});
    response.cookies.set("yada_admin_session",result.session,{httpOnly:true,sameSite:"strict",secure:process.env.NODE_ENV==="production",path:"/",maxAge:8*60*60});
    return response;
  }catch(error){
    const current=entry&&entry.resetAt>now?entry:{count:0,resetAt:now+windowMs};current.count++;attempts.set(key,current);
    return NextResponse.json({error:error instanceof Error?error.message:"帳號或密碼不正確。"},{status:401});
  }
}

export async function DELETE(){const jar=await cookies(),raw=jar.get("yada_admin_session")?.value;await logoutAdmin(raw);const response=NextResponse.json({ok:true});response.cookies.set("yada_admin_session","",{httpOnly:true,sameSite:"strict",secure:process.env.NODE_ENV==="production",path:"/",maxAge:0});return response;}
