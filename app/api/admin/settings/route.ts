import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentAdmin } from "../../../../db/auth";
import { readStoreSettings, saveStoreSettings } from "../../../../db/orders";

async function admin(){return currentAdmin((await cookies()).get("yada_admin_session")?.value);}

export async function GET(){
  if(!await admin())return NextResponse.json({error:"無管理權限。"},{status:403});
  return NextResponse.json({settings:await readStoreSettings()});
}

export async function PUT(request:Request){
  if(!await admin())return NextResponse.json({error:"無管理權限。"},{status:403});
  try{
    const body=await request.json() as {returnAddress?:unknown;returnRecipient?:unknown;returnPhone?:unknown;notificationEmail?:unknown};
    await saveStoreSettings({returnAddress:String(body.returnAddress||""),returnRecipient:String(body.returnRecipient||""),returnPhone:String(body.returnPhone||""),notificationEmail:String(body.notificationEmail||"")});
    return NextResponse.json({ok:true});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"儲存設定失敗。"},{status:400});}
}
