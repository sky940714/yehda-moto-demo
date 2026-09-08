import { NextResponse } from "next/server";
import { listCatalogOptions, listProducts } from "../../../db/catalog";

export async function GET() {
  try { const [products,options]=await Promise.all([listProducts(false),listCatalogOptions()]); return NextResponse.json({ products, options }, { headers: { "Cache-Control": "no-store, max-age=0" } }); }
  catch (error) { console.error("Catalog error", error); return NextResponse.json({ error: "商品資料暫時無法讀取。" }, { status: 500 }); }
}
