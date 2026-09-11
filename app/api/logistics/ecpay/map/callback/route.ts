import { NextResponse } from "next/server";
import { logisticsCredentials, logisticsMethod, logisticsState } from "../../../../../../db/ecpay-logistics";

const safeJson = (value: unknown) => JSON.stringify(value).replaceAll("<", "\\u003c");

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const value = (name: string, max: number) => String(form.get(name) || "").trim().slice(0, max);
    const merchantId = value("MerchantID", 10);
    const tradeNumber = value("MerchantTradeNo", 20);
    if (merchantId !== logisticsCredentials().merchantId || value("ExtraData", 20) !== logisticsState(tradeNumber)) {
      throw new Error("門市選擇驗證失敗。");
    }
    const shippingMethod = logisticsMethod(value("LogisticsSubType", 20));
    const store = {
      shippingMethod,
      id: value("CVSStoreID", 9),
      name: value("CVSStoreName", 40),
      address: value("CVSAddress", 100),
      phone: value("CVSTelephone", 20),
      brand: shippingMethod === "family" ? "全家便利商店" : shippingMethod === "seven" ? "7-ELEVEN" : "萊爾富",
      outside: value("CVSOutSide", 1) === "1",
    };
    if (!store.id || !store.name || !store.address) throw new Error("綠界沒有回傳完整門市資料。");
    const payload = safeJson(store);
    return new NextResponse(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>門市選擇完成</title></head><body><p>門市選擇完成，正在返回結帳頁…</p><script>sessionStorage.setItem("yada-ecpay-store",${safeJson(payload)});location.replace("/?ecpayStore=1")</script></body></html>`, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "門市選擇失敗。";
    return new NextResponse(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>門市選擇失敗</title></head><body><h1>門市選擇失敗</h1><p>${message.replaceAll("<", "&lt;")}</p><a href="/">返回商店</a></body></html>`, { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}
