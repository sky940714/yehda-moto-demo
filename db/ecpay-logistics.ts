import { createHash } from "node:crypto";

export type LogisticsValues = Record<string, string>;

const encode = (value: string) => encodeURIComponent(value)
  .replace(/%20/g, "+")
  .replace(/%2D/gi, "-")
  .replace(/%5F/gi, "_")
  .replace(/%2E/gi, ".")
  .replace(/%21/gi, "!")
  .replace(/%2A/gi, "*")
  .replace(/%28/gi, "(")
  .replace(/%29/gi, ")");

export function logisticsEnvironment() {
  const production = process.env.ECPAY_LOGISTICS_ENV === "production";
  return {
    production,
    mapUrl: production
      ? "https://logistics.ecpay.com.tw/Express/map"
      : "https://logistics-stage.ecpay.com.tw/Express/map",
    createUrl: production
      ? "https://logistics.ecpay.com.tw/Express/Create"
      : "https://logistics-stage.ecpay.com.tw/Express/Create",
  };
}

export function logisticsCredentials() {
  const merchantId = process.env.ECPAY_LOGISTICS_MERCHANT_ID?.trim();
  const hashKey = process.env.ECPAY_LOGISTICS_HASH_KEY?.trim();
  const hashIv = process.env.ECPAY_LOGISTICS_HASH_IV?.trim();
  if (!merchantId || !hashKey || !hashIv) throw new Error("綠界物流介接資料尚未設定。");
  return { merchantId, hashKey, hashIv };
}

export function logisticsCheckMacValue(values: LogisticsValues) {
  const { hashKey, hashIv } = logisticsCredentials();
  const content = Object.entries(values)
    .filter(([key]) => key !== "CheckMacValue")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return createHash("md5")
    .update(encode(`HashKey=${hashKey}&${content}&HashIV=${hashIv}`).toLowerCase())
    .digest("hex")
    .toUpperCase();
}

export function logisticsState(tradeNumber: string) {
  const { hashKey } = logisticsCredentials();
  return createHash("sha256").update(`${tradeNumber}:${hashKey}`).digest("hex").slice(0, 20);
}

export function logisticsSubtype(method: string) {
  if (method === "family") return "FAMI";
  if (method === "seven") return "UNIMART";
  if (method === "hilife") return "HILIFE";
  if (method === "blackcat") return "TCAT";
  if (method === "post") return "POST";
  throw new Error("此配送方式不支援綠界物流。");
}

export function logisticsMethod(subtype: string) {
  if (["FAMI", "FAMIC2C"].includes(subtype)) return "family";
  if (["UNIMART", "UNIMARTC2C"].includes(subtype)) return "seven";
  if (["HILIFE", "HILIFEC2C"].includes(subtype)) return "hilife";
  throw new Error("綠界回傳了不支援的超商類型。");
}

export function taipeiDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}/${part("month")}/${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

export function autoPostForm(action: string, fields: LogisticsValues, title: string) {
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  const inputs = Object.entries(fields).map(([name, value]) => `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`).join("");
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title></head><body><p>正在前往綠界門市地圖…</p><form method="post" action="${escape(action)}">${inputs}<noscript><button>繼續</button></noscript></form><script>document.forms[0].submit()</script></body></html>`;
}

