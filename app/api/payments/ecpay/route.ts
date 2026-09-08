import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentUser } from "../../../../db/auth";
import { paymentForm } from "../../../../db/ecpay";
import { getEcpayOrder } from "../../../../db/orders";
export async function POST(request:Request){try{const user=await currentUser((await cookies()).get("yada_session")?.value);if(!user)return NextResponse.json({error:"請先登入會員。"},{status:401});const {orderNumber}=await request.json() as {orderNumber?:string};return NextResponse.json(paymentForm(await getEcpayOrder(user.id,String(orderNumber||""))));}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"無法建立綠界付款。"},{status:400});}}
