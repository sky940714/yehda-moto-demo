import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentUser } from "../../../../../db/auth";
import { autoPostForm, logisticsCredentials, logisticsEnvironment, logisticsState, logisticsSubtype } from "../../../../../db/ecpay-logistics";

export async function GET(request: Request) {
  const user = await currentUser((await cookies()).get("yada_session")?.value);
  const requestUrl = new URL(request.url);
  const publicOrigin = process.env.APP_URL?.replace(/\/$/, "") || requestUrl.origin;
  if (!user) return NextResponse.redirect(new URL("/?auth=login&returnTo=checkout", publicOrigin));
  try {
    const url = requestUrl;
    const shippingMethod = url.searchParams.get("shippingMethod") || "";
    const subtype = logisticsSubtype(shippingMethod);
    if (!["FAMI", "UNIMART", "HILIFE"].includes(subtype)) throw new Error("請選擇超商取貨方式。");
    const tradeNumber = `M${Date.now().toString(36).toUpperCase()}${crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`.slice(0, 20);
    const { merchantId } = logisticsCredentials();
    const base = publicOrigin;
    const fields = {
      MerchantID: merchantId,
      MerchantTradeNo: tradeNumber,
      LogisticsType: "CVS",
      LogisticsSubType: subtype,
      IsCollection: "N",
      ServerReplyURL: `${base}/api/logistics/ecpay/map/callback`,
      ExtraData: logisticsState(tradeNumber),
      Device: "0",
    };
    return new NextResponse(autoPostForm(logisticsEnvironment().mapUrl, fields, "選擇超商門市"), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "無法開啟綠界門市地圖。" }, { status: 503 });
  }
}
