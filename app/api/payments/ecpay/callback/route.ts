import { NextResponse } from "next/server";
import { applyEcpayCallback } from "../../../../../db/orders";
import { checkMacValue } from "../../../../../db/ecpay";
export async function POST(request:Request){try{const form=await request.formData();const values=Object.fromEntries(Array.from(form.entries()).map(([key,value])=>[key,String(value)]));if(values.CheckMacValue!==checkMacValue(values))return new NextResponse("0|CheckMacValue Error",{status:400});await applyEcpayCallback(values);return new NextResponse("1|OK",{headers:{"Content-Type":"text/plain; charset=utf-8"}});}catch{return new NextResponse("0|Error",{status:400});}}
