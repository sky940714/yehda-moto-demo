import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentUser } from "../../../db/auth";
import { readCustomerStore, saveCustomerStore, type CustomerStore } from "../../../db/customer-store";

const COOKIE = "yada_session";

async function user() {
  const jar = await cookies();
  return currentUser(jar.get(COOKIE)?.value);
}

export async function GET() {
  const member = await user();
  if (!member) return NextResponse.json({ error: "請先登入會員。" }, { status: 401 });
  return NextResponse.json(await readCustomerStore(member.id), { headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function PUT(request: Request) {
  const member = await user();
  if (!member) return NextResponse.json({ error: "請先登入會員。" }, { status: 401 });
  try { return NextResponse.json(await saveCustomerStore(member.id, await request.json() as Partial<CustomerStore>)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "儲存會員資料失敗。" }, { status: 400 }); }
}
