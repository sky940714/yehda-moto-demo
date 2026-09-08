import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentAdmin } from "../../../../db/auth";
import { adjustMemberPoints, listAdminMembers } from "../../../../db/orders";

async function admin(){return currentAdmin((await cookies()).get("yada_admin_session")?.value);}
export async function GET(){if(!await admin())return NextResponse.json({error:"無管理權限。"},{status:403});return NextResponse.json({members:await listAdminMembers()});}
export async function PATCH(request:Request){
  if(!await admin())return NextResponse.json({error:"無管理權限。"},{status:403});
  try{const body=await request.json() as {userId?:unknown;points?:unknown;reason?:unknown};await adjustMemberPoints(String(body.userId||""),Number(body.points||0),String(body.reason||""));return NextResponse.json({ok:true});}
  catch(error){return NextResponse.json({error:error instanceof Error?error.message:"點數調整失敗。"},{status:400});}
}
