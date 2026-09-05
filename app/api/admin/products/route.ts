import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentAdmin } from "../../../../db/auth";
import { bulkUpdateProductStatus, deleteProduct, deleteProducts, listProducts, saveProduct } from "../../../../db/catalog";

async function admin() { const jar=await cookies(); return currentAdmin(jar.get("yada_admin_session")?.value); }
export async function GET(){const user=await admin();if(!user)return NextResponse.json({error:"無管理權限。"},{status:403});return NextResponse.json({products:await listProducts(true)});}
export async function POST(request:Request){const user=await admin();if(!user)return NextResponse.json({error:"無管理權限。"},{status:403});try{return NextResponse.json({product:await saveProduct(await request.json(),user.id)});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"儲存失敗。"},{status:400});}}
export async function PATCH(request:Request){const user=await admin();if(!user)return NextResponse.json({error:"無管理權限。"},{status:403});const body=await request.json(),ids=normalizeIds(body.ids),status=String(body.status||"");if(!["active","draft","out_of_stock"].includes(status)||!ids.length)return NextResponse.json({error:"批次更新內容不正確。"},{status:400});return NextResponse.json({ok:true,updated:await bulkUpdateProductStatus(ids,status as "active"|"draft"|"out_of_stock",user.id)});}
export async function DELETE(request:Request){const user=await admin();if(!user)return NextResponse.json({error:"無管理權限。"},{status:403});let ids:number[]=[];try{ids=normalizeIds((await request.json()).ids);}catch{const id=Number(new URL(request.url).searchParams.get("id"));if(id)ids=[id];}if(!ids.length)return NextResponse.json({error:"缺少商品編號。"},{status:400});if(ids.length===1){await deleteProduct(ids[0],user.id);return NextResponse.json({ok:true,deleted:1});}return NextResponse.json({ok:true,deleted:await deleteProducts(ids,user.id)});}
function normalizeIds(value:unknown){return Array.isArray(value)?[...new Set(value.map(Number).filter((id)=>Number.isInteger(id)&&id>0))].slice(0,200):[];}
