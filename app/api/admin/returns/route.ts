import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentAdmin } from "../../../../db/auth";
import { listAdminReturns, updateReturnStatus } from "../../../../db/orders";
async function admin(){return currentAdmin((await cookies()).get("yada_admin_session")?.value);}
export async function GET(){if(!await admin())return NextResponse.json({error:"無管理權限。"},{status:403});return NextResponse.json({returns:await listAdminReturns()});}
export async function PATCH(request:Request){if(!await admin())return NextResponse.json({error:"無管理權限。"},{status:403});try{const body=await request.json() as {id?:unknown;status?:unknown;note?:unknown};await updateReturnStatus(Number(body.id),String(body.status),String(body.note||""));return NextResponse.json({ok:true});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"更新失敗。"},{status:400});}}
