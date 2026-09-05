import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentAdmin } from "../../../../db/auth";

export async function POST(request:Request){const jar=await cookies();const user=await currentAdmin(jar.get("yada_admin_session")?.value);if(!user)return NextResponse.json({error:"無管理權限。"},{status:403});
  const accountId=process.env.R2_ACCOUNT_ID,bucket=process.env.R2_BUCKET_NAME,accessKeyId=process.env.R2_ACCESS_KEY_ID,secretAccessKey=process.env.R2_SECRET_ACCESS_KEY,publicUrl=process.env.R2_PUBLIC_URL;
  if(!accountId||!bucket||!accessKeyId||!secretAccessKey||!publicUrl)return NextResponse.json({error:"Cloudflare R2 尚未完成設定。"},{status:503});
  const form=await request.formData(),file=form.get("file");if(!(file instanceof File))return NextResponse.json({error:"請選擇圖片。"},{status:400});
  const allowed=new Map([["image/jpeg","jpg"],["image/png","png"],["image/webp","webp"]]);const ext=allowed.get(file.type);if(!ext)return NextResponse.json({error:"只接受 JPG、PNG 或 WebP。"},{status:400});if(file.size>5*1024*1024)return NextResponse.json({error:"圖片不可超過 5MB。"},{status:400});
  const key=`products/${new Date().toISOString().slice(0,10)}/${randomUUID()}.${ext}`;const client=new S3Client({region:"auto",endpoint:`https://${accountId}.r2.cloudflarestorage.com`,credentials:{accessKeyId,secretAccessKey}});await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:new Uint8Array(await file.arrayBuffer()),ContentType:file.type,CacheControl:"public, max-age=31536000, immutable"}));return NextResponse.json({url:`${publicUrl.replace(/\/$/,"")}/${key}`});}
