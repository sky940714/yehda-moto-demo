import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentUser } from "../../../db/auth";
import { createOrder, type CheckoutInput } from "../../../db/orders";

export async function POST(request: Request) {
  try {
    const user = await currentUser((await cookies()).get("yada_session")?.value);
    if (!user) return NextResponse.json({ error: "請先登入會員再結帳。" }, { status: 401 });
    const result = await createOrder(user.id, await request.json() as CheckoutInput);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "建立訂單失敗。" }, { status: 400 });
  }
}
