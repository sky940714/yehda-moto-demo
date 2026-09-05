import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentAdmin } from "../../../../db/auth";
import { adminOverview } from "../../../../db/catalog";
export async function GET(){const jar=await cookies();const user=await currentAdmin(jar.get("yada_admin_session")?.value);if(!user)return NextResponse.json({error:"無管理權限。"},{status:403});return NextResponse.json({user:{name:user.name,role:user.role},overview:await adminOverview()});}
