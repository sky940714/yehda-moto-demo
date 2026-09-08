import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import { randomBytes } from "node:crypto";
import { listProducts, type CatalogProduct } from "./catalog";
import { readCustomerStore } from "./customer-store";

export type CheckoutInput = {
  shippingMethod: "blackcat" | "post" | "family" | "seven" | "hilife" | "pickup";
  paymentMethod: "ecpay_card" | "ecpay_atm" | "ecpay_cvs" | "cod";
  customerName: string; customerEmail: string; customerPhone: string; address?: string; note?: string;
  store?: { id: string; name: string; address: string; brand: string };
};

let pool: Pool | null | undefined;
let prepared: Promise<void> | undefined;
function db() {
  if (pool !== undefined) return pool;
  if (!process.env.MYSQL_HOST) return (pool = null);
  return (pool = mysql.createPool({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE, connectionLimit: 5, charset: "utf8mb4" }));
}

function text(value: unknown, max: number) { return String(value || "").trim().slice(0, max); }
function orderNumber() { const now = new Date(); const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(now).replaceAll("-", ""); return `YD${date}${randomBytes(3).toString("hex").toUpperCase()}`; }

async function ensure() {
  prepared ??= (async () => {
    const database = db(); if (!database) return;
    await listProducts(true);
    await database.execute(`CREATE TABLE IF NOT EXISTS order_items (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, order_id BIGINT UNSIGNED NOT NULL,
      product_id BIGINT UNSIGNED NOT NULL, variant_id BIGINT UNSIGNED NULL, product_name VARCHAR(255) NOT NULL,
      sku VARCHAR(100) NOT NULL, option_values JSON NOT NULL, unit_price INT UNSIGNED NOT NULL, quantity SMALLINT UNSIGNED NOT NULL,
      image_url TEXT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX order_items_order_idx(order_id), CONSTRAINT order_items_order_fk FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    const alterations = [
      "ADD COLUMN payment_method VARCHAR(40) NOT NULL DEFAULT 'pending'",
      "ADD COLUMN payment_status ENUM('unpaid','pending','paid','failed','cod') NOT NULL DEFAULT 'unpaid'",
      "ADD COLUMN payment_reference VARCHAR(100) NULL",
      "ADD COLUMN store_id VARCHAR(40) NULL",
      "ADD COLUMN store_name VARCHAR(150) NULL",
      "ADD COLUMN store_address VARCHAR(255) NULL",
    ];
    for (const change of alterations) { try { await database.execute(`ALTER TABLE orders ${change}`); } catch (error) { if (!(error instanceof Error) || !/Duplicate column/i.test(error.message)) throw error; } }
    await database.execute(`CREATE TABLE IF NOT EXISTS return_requests (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, order_id BIGINT UNSIGNED NOT NULL,
      reason VARCHAR(500) NOT NULL, status ENUM('requested','approved','received','refunded','rejected','cancelled') NOT NULL DEFAULT 'requested',
      resolution_note TEXT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX returns_status_idx(status), INDEX returns_order_idx(order_id), CONSTRAINT returns_order_fk FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  })();
  await prepared;
}

function shipping(input: CheckoutInput, products: CatalogProduct[]) {
  const type = input.shippingMethod, online = input.paymentMethod !== "cod";
  const cvs = ["family", "seven", "hilife"].includes(type);
  if (cvs && products.some((product) => product.shippingType !== "small")) throw new Error("購物車含有不支援超商取貨的商品，請改選宅配。");
  const shippingName = type === "blackcat" ? "黑貓宅急便" : type === "post" ? "中華郵政" : type === "family" ? "全家便利商店" : type === "seven" ? "7-ELEVEN" : type === "hilife" ? "萊爾富" : "燁達門市自取";
  const fee = type === "blackcat" ? 130 : type === "post" ? 80 : type === "hilife" ? 55 : ["family", "seven"].includes(type) ? 65 : 0;
  const paymentName = input.paymentMethod === "cod" ? "貨到付款" : input.paymentMethod === "ecpay_card" ? "綠界信用卡" : input.paymentMethod === "ecpay_atm" ? "綠界 ATM 虛擬帳號" : "綠界超商代碼";
  return { label: `${shippingName}｜${paymentName}`, fee, payment: input.paymentMethod, paymentStatus: online ? "pending" : "cod" };
}

export async function createOrder(userId: string, input: CheckoutInput) {
  await ensure();
  const customerName = text(input.customerName, 100), customerEmail = text(input.customerEmail, 254), customerPhone = text(input.customerPhone, 20);
  if (!customerName || !/^\S+@\S+\.\S+$/.test(customerEmail) || !/^09\d{8}$/.test(customerPhone.replace(/[-\s]/g, ""))) throw new Error("請填寫正確的姓名、Email 與手機號碼。");
  const store = await readCustomerStore(userId); if (!store.cart.length) throw new Error("購物車目前沒有商品。");
  const catalog = await listProducts(true), byId = new Map(catalog.map((product) => [product.id, product]));
  const items = store.cart.map((line) => {
    const product = byId.get(line.productId); if (!product || product.status !== "active") throw new Error("購物車中有已下架商品，請重新確認。");
    const variant = line.variantId ? product.variants.find((value) => value.id === line.variantId && value.isActive) : undefined;
    if (line.variantId && !variant) throw new Error(`${product.name} 的規格已變更，請重新選擇。`);
    const stock = variant ? variant.stock : product.stock; if (stock < line.quantity) throw new Error(`${product.name} 庫存不足。`);
    return { product, variant, quantity: line.quantity, price: variant ? variant.price : product.price, options: line.options };
  });
  const method = shipping(input, items.map((item) => item.product));
  const cvs = ["family", "seven", "hilife"].includes(input.shippingMethod);
  if (cvs && (!input.store || !text(input.store.id, 40) || !text(input.store.name, 150))) throw new Error("請先選擇超商取貨門市。");
  const address = cvs ? `${input.store!.brand}｜${input.store!.name}｜${input.store!.address}` : text(input.address, 500);
  if (!cvs && !address) throw new Error("請填寫完整收件地址。");
  const merchandise = items.reduce((sum, item) => sum + item.price * item.quantity, 0), total = merchandise + method.fee;
  const database = db(); const number = orderNumber();
  if (!database) return { orderNumber: number, total, paymentMethod: method.payment, paymentStatus: method.paymentStatus };
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute<ResultSetHeader>("INSERT INTO orders(order_number,user_id,customer_name,customer_email,customer_phone,total,status,shipping_method,shipping_address,note,payment_method,payment_status,store_id,store_name,store_address) VALUES(?,?,?,?,?,?, 'pending',?,?,?,?,?,?,?,?)", [number, userId, customerName, customerEmail, customerPhone, total, method.label, address, text(input.note, 1000) || null, method.payment, method.paymentStatus, input.store ? text(input.store.id, 40) : null, input.store ? text(input.store.name, 150) : null, input.store ? text(input.store.address, 255) : null]);
    for (const item of items) await connection.execute("INSERT INTO order_items(order_id,product_id,variant_id,product_name,sku,option_values,unit_price,quantity,image_url) VALUES(?,?,?,?,?,?,?,?,?)", [result.insertId, item.product.id, item.variant?.id || null, item.product.name, item.variant?.sku || item.product.sku, JSON.stringify(item.options), item.price, item.quantity, item.variant?.image || item.product.image || null]);
    await connection.commit();
    return { orderNumber: number, total, paymentMethod: method.payment, paymentStatus: method.paymentStatus };
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

export type AdminOrder = { id:number; number:string; customerName:string; customerPhone:string; total:number; status:string; paymentMethod:string; paymentStatus:string; shippingMethod:string; createdAt:string };
export type AdminReturn = { id:number; orderNumber:string; customerName:string; reason:string; status:string; createdAt:string; resolutionNote:string | null };
export type CustomerOrder = { number:string; total:number; status:string; paymentMethod:string; paymentStatus:string; shippingMethod:string; createdAt:string; returnStatus:string | null };
export type EcpayOrder = { number:string; total:number; paymentMethod:string; customerName:string; itemName:string };

export async function getEcpayOrder(userId: string, orderNumber: string): Promise<EcpayOrder> {
  await ensure(); const database=db(); if(!database) throw new Error("資料庫尚未連線。");
  const [rows]=await database.query<(RowDataPacket&{id:number;order_number:string;total:number;payment_method:string;customer_name:string})[]>("SELECT id,order_number,total,payment_method,customer_name FROM orders WHERE order_number=? AND user_id=? LIMIT 1",[text(orderNumber,32),userId]);
  const order=rows[0]; if(!order) throw new Error("找不到此訂單。"); if(order.payment_method==="cod") throw new Error("貨到付款訂單不需要綠界付款。");
  const [items]=await database.query<(RowDataPacket&{product_name:string;quantity:number})[]>("SELECT product_name,quantity FROM order_items WHERE order_id=? ORDER BY id",[order.id]);
  return { number:order.order_number,total:Number(order.total),paymentMethod:order.payment_method,customerName:order.customer_name,itemName:items.map(item=>`${item.product_name} x${item.quantity}`).join("#").slice(0,200)||"燁達機車精品" };
}

export async function applyEcpayCallback(values: Record<string,string>) {
  await ensure(); const database=db(); if(!database) throw new Error("資料庫尚未連線。");
  const number=text(values.MerchantTradeNo,32); if(!number) throw new Error("缺少訂單編號。");
  const paid=values.RtnCode==="1"; const reference=text(values.TradeNo,100)||null;
  await database.execute("UPDATE orders SET payment_status=?,payment_reference=?,status=CASE WHEN ?='paid' AND status='pending' THEN 'confirmed' ELSE status END WHERE order_number=?",[paid?"paid":"failed",reference,paid?"paid":"failed",number]);
}

export async function createReturnRequest(userId:string, orderNumber:string, reason:string) {
  await ensure(); const database=db(); if(!database) throw new Error("資料庫尚未連線。"); const why=text(reason,500); if(!why) throw new Error("請填寫退貨原因。");
  const [orders]=await database.query<(RowDataPacket&{id:number;status:string})[]>("SELECT id,status FROM orders WHERE order_number=? AND user_id=? LIMIT 1",[text(orderNumber,32),userId]); const order=orders[0];
  if(!order) throw new Error("找不到此訂單。"); if(!["shipped","completed"].includes(order.status)) throw new Error("此訂單目前尚未符合申請退貨的條件。");
  const [existing]=await database.query<RowDataPacket[]>("SELECT id FROM return_requests WHERE order_id=? AND status NOT IN ('rejected','cancelled') LIMIT 1",[order.id]); if(existing.length) throw new Error("此訂單已有進行中的退貨申請。");
  await database.execute("INSERT INTO return_requests(order_id,reason) VALUES(?,?)",[order.id,why]);
}

export async function listCustomerOrders(userId:string): Promise<CustomerOrder[]> {
  await ensure(); const database=db(); if(!database)return[];
  const [rows]=await database.query<(RowDataPacket&{order_number:string;total:number;status:string;payment_method:string;payment_status:string;shipping_method:string;created_at:Date;return_status:string|null})[]>("SELECT o.order_number,o.total,o.status,o.payment_method,o.payment_status,o.shipping_method,o.created_at,r.status AS return_status FROM orders o LEFT JOIN return_requests r ON r.order_id=o.id WHERE o.user_id=? ORDER BY o.created_at DESC,o.id DESC",[userId]);
  return rows.map(row=>({number:row.order_number,total:Number(row.total),status:row.status,paymentMethod:row.payment_method,paymentStatus:row.payment_status,shippingMethod:row.shipping_method,createdAt:new Date(row.created_at).toISOString(),returnStatus:row.return_status}));
}

export async function listAdminOrders(): Promise<AdminOrder[]> {
  await ensure(); const database=db(); if (!database) return [];
  const [rows] = await database.query<(RowDataPacket & { id:number; order_number:string; customer_name:string; customer_phone:string; total:number; status:string; payment_method:string; payment_status:string; shipping_method:string; created_at:Date })[]>("SELECT id,order_number,customer_name,customer_phone,total,status,payment_method,payment_status,shipping_method,created_at FROM orders ORDER BY created_at DESC,id DESC");
  return rows.map((row)=>({id:Number(row.id),number:row.order_number,customerName:row.customer_name,customerPhone:row.customer_phone,total:Number(row.total),status:row.status,paymentMethod:row.payment_method,paymentStatus:row.payment_status,shippingMethod:row.shipping_method,createdAt:new Date(row.created_at).toISOString()}));
}

export async function updateOrderStatus(id:number,status:string) {
  await ensure(); const allowed=new Set(["pending","confirmed","preparing","shipped","completed","cancelled"]); if(!allowed.has(status))throw new Error("訂單狀態不正確。"); const database=db();if(!database)return;await database.execute("UPDATE orders SET status=? WHERE id=?",[status,Math.trunc(id)]);
}

export async function listAdminReturns(): Promise<AdminReturn[]> {
  await ensure(); const database=db(); if(!database)return[];
  const [rows]=await database.query<(RowDataPacket&{id:number;order_number:string;customer_name:string;reason:string;status:string;created_at:Date;resolution_note:string|null})[]>("SELECT r.id,o.order_number,o.customer_name,r.reason,r.status,r.created_at,r.resolution_note FROM return_requests r JOIN orders o ON o.id=r.order_id ORDER BY r.created_at DESC,r.id DESC");
  return rows.map((row)=>({id:Number(row.id),orderNumber:row.order_number,customerName:row.customer_name,reason:row.reason,status:row.status,createdAt:new Date(row.created_at).toISOString(),resolutionNote:row.resolution_note}));
}

export async function updateReturnStatus(id:number,status:string,note:string) {
  await ensure();const allowed=new Set(["requested","approved","received","refunded","rejected","cancelled"]);if(!allowed.has(status))throw new Error("退貨狀態不正確。");const database=db();if(!database)return;await database.execute("UPDATE return_requests SET status=?,resolution_note=? WHERE id=?",[status,text(note,2000)||null,Math.trunc(id)]);
}
