import { NextResponse } from "next/server";
import { applyEcpayLogisticsCallback } from "../../../../../db/orders";
export async function POST(request:Request){try{const form=await request.formData();const values=Object.fromEntries(Array.from(form.entries()).map(([key,value])=>[key,String(value)]));await applyEcpayLogisticsCallback(values);return new NextResponse("1|OK",{headers:{"Content-Type":"text/plain; charset=utf-8"}});}catch{return new NextResponse("0|Error",{status:400,headers:{"Content-Type":"text/plain; charset=utf-8"}});}}
