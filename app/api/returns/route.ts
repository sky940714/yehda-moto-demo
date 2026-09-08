import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentUser } from "../../../db/auth";
import { createReturnRequest } from "../../../db/orders";
export async function POST(request:Request){try{const user=await currentUser((await cookies()).get("yada_session")?.value);if(!user)return NextResponse.json({error:"請先登入會員。"},{status:401});const body=await request.json() as {orderNumber?:string;reason?:string};await createReturnRequest(user.id,String(body.orderNumber||""),String(body.reason||""));return NextResponse.json({ok:true},{status:201});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"建立退貨申請失敗。"},{status:400});}}
