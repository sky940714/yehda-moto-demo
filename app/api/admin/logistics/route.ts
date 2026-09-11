import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentAdmin } from "../../../../db/auth";
import { createEcpayLogisticsOrder } from "../../../../db/orders";
export async function POST(request:Request){const user=await currentAdmin((await cookies()).get("yada_admin_session")?.value);if(!user)return NextResponse.json({error:"無管理權限。"},{status:403});try{const body=await request.json() as {orderId?:unknown};return NextResponse.json(await createEcpayLogisticsOrder(Number(body.orderId)));}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"建立物流單失敗。"},{status:400});}}

