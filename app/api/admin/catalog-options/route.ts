import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentAdmin } from "../../../../db/auth";
import { listCatalogOptions, reorderCatalogOptions, saveCatalogOption, type CatalogOptionKind } from "../../../../db/catalog";

async function admin(){const jar=await cookies();return currentAdmin(jar.get("yada_admin_session")?.value);}
export async function GET(){const user=await admin();if(!user)return NextResponse.json({error:"無管理權限。"},{status:403});return NextResponse.json({options:await listCatalogOptions()});}
export async function POST(request:Request){const user=await admin();if(!user)return NextResponse.json({error:"無管理權限。"},{status:403});try{const body=(await request.json()) as {kind?:unknown;name?:unknown},kind=String(body.kind||"") as CatalogOptionKind;if(!["brand","category","vehicle"].includes(kind))return NextResponse.json({error:"選項類型不正確。"},{status:400});return NextResponse.json({name:await saveCatalogOption(kind,String(body.name||""))},{status:201});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"新增失敗。"},{status:400});}}
export async function PATCH(request:Request){const user=await admin();if(!user)return NextResponse.json({error:"無管理權限。"},{status:403});try{const body=(await request.json()) as {kind?:unknown;names?:unknown},kind=String(body.kind||"") as CatalogOptionKind;if(!["brand","category","vehicle"].includes(kind)||!Array.isArray(body.names))return NextResponse.json({error:"排序資料不正確。"},{status:400});await reorderCatalogOptions(kind,body.names.map(String));return NextResponse.json({ok:true});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"排序儲存失敗。"},{status:400});}}
