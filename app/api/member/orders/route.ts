import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentUser } from "../../../../db/auth";
import { listCustomerOrders } from "../../../../db/orders";

export async function GET() {
  const user=await currentUser((await cookies()).get("yada_session")?.value);
  if(!user)return NextResponse.json({error:"請先登入會員。"},{status:401});
  return NextResponse.json({orders:await listCustomerOrders(user.id)});
}
