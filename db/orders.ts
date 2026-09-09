import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import { randomBytes } from "node:crypto";
import { listProducts, type CatalogProduct } from "./catalog";
import { readCustomerStore } from "./customer-store";

export type CheckoutInput = {
  shippingMethod: "blackcat" | "post" | "family" | "seven" | "hilife" | "pickup";
  paymentMethod: "ecpay_card" | "ecpay_atm" | "ecpay_cvs" | "cod";
  customerName: string; customerEmail: string; customerPhone: string; address?: string; note?: string;
  store?: { id: string; name: string; address: string; brand: string };
  pointsUsed?: number;
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
      "ADD COLUMN shipping_carrier VARCHAR(40) NULL",
      "ADD COLUMN tracking_number VARCHAR(100) NULL",
      "ADD COLUMN shipped_at DATETIME NULL",
      "ADD COLUMN completed_at DATETIME NULL",
      "ADD COLUMN cancelled_at DATETIME NULL",
      "ADD COLUMN stock_released_at DATETIME NULL",
      "ADD COLUMN payment_expires_at DATETIME NULL",
      "ADD COLUMN points_used INT UNSIGNED NOT NULL DEFAULT 0",
      "ADD COLUMN points_earned INT UNSIGNED NOT NULL DEFAULT 0",
      "ADD COLUMN loyalty_issued_at DATETIME NULL",
      "ADD COLUMN cancellation_requested_at DATETIME NULL",
      "ADD COLUMN cancellation_reason VARCHAR(500) NULL",
    ];
    for (const change of alterations) { try { await database.execute(`ALTER TABLE orders ${change}`); } catch (error) { if (!(error instanceof Error) || !/Duplicate column/i.test(error.message)) throw error; } }
    await database.execute(`CREATE TABLE IF NOT EXISTS return_requests (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, order_id BIGINT UNSIGNED NOT NULL,
      reason VARCHAR(500) NOT NULL, status ENUM('requested','approved','received','refunded','rejected','cancelled') NOT NULL DEFAULT 'requested',
      resolution_note TEXT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX returns_status_idx(status), INDEX returns_order_idx(order_id), CONSTRAINT returns_order_fk FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    const returnAlterations = [
      "ADD COLUMN refund_method ENUM('ecpay_card','manual_transfer') NULL",
      "ADD COLUMN refund_amount INT UNSIGNED NULL",
      "ADD COLUMN refund_reference VARCHAR(100) NULL",
      "ADD COLUMN inventory_restored_at DATETIME NULL",
    ];
    for (const change of returnAlterations) { try { await database.execute(`ALTER TABLE return_requests ${change}`); } catch (error) { if (!(error instanceof Error) || !/Duplicate column/i.test(error.message)) throw error; } }
    await database.execute(`CREATE TABLE IF NOT EXISTS store_settings (
      setting_key VARCHAR(100) PRIMARY KEY, setting_value TEXT NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await database.execute(`CREATE TABLE IF NOT EXISTS loyalty_transactions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id CHAR(36) NOT NULL,
      points_delta INT NOT NULL, balance_reason VARCHAR(40) NOT NULL, reference_key VARCHAR(120) NOT NULL UNIQUE,
      order_id BIGINT UNSIGNED NULL, note VARCHAR(500) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX loyalty_user_created_idx(user_id,created_at), INDEX loyalty_order_idx(order_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  })();
  await prepared;
}

function shipping(input: CheckoutInput, products: CatalogProduct[]) {
  const type = input.shippingMethod, online = input.paymentMethod !== "cod";
  const cvs = ["family", "seven", "hilife"].includes(type);
  if (cvs && products.some((product) => product.shippingType !== "small")) throw new Error("購物車含有不支援超商取貨的商品，請改選宅配。");
  if (input.paymentMethod === "cod" && !cvs) throw new Error("貨到付款僅限超商取貨訂單。");
  const shippingName = type === "blackcat" ? "黑貓宅急便" : type === "post" ? "中華郵政" : type === "family" ? "全家便利商店" : type === "seven" ? "7-ELEVEN" : type === "hilife" ? "萊爾富" : "燁達門市自取";
  const fee = type === "blackcat" ? 130 : type === "post" ? 80 : type === "hilife" ? 55 : ["family", "seven"].includes(type) ? 65 : 0;
  const paymentName = input.paymentMethod === "cod" ? "貨到付款" : input.paymentMethod === "ecpay_card" ? "綠界信用卡" : input.paymentMethod === "ecpay_atm" ? "綠界 ATM 虛擬帳號" : "綠界超商代碼";
  return { label: `${shippingName}｜${paymentName}`, fee, payment: input.paymentMethod, paymentStatus: online ? "pending" : "cod" };
}

async function expireUnpaidOrders(){
  const database=db();if(!database)return;const connection=await database.getConnection();
  try{await connection.beginTransaction();const [orders]=await connection.query<(RowDataPacket&{id:number;order_number:string;user_id:string;points_used:number})[]>("SELECT id,order_number,user_id,points_used FROM orders WHERE status NOT IN ('cancelled','completed') AND payment_status IN ('pending','unpaid') AND payment_expires_at IS NOT NULL AND payment_expires_at<NOW() AND stock_released_at IS NULL FOR UPDATE");for(const order of orders){const [items]=await connection.query<(RowDataPacket&{product_id:number;variant_id:number|null;quantity:number})[]>("SELECT product_id,variant_id,quantity FROM order_items WHERE order_id=?",[order.id]);for(const item of items){if(item.variant_id)await connection.execute("UPDATE product_variants SET stock=stock+? WHERE id=?",[item.quantity,item.variant_id]);await connection.execute("UPDATE products SET stock=stock+? WHERE id=?",[item.quantity,item.product_id]);}if(order.points_used)await connection.execute("INSERT IGNORE INTO loyalty_transactions(user_id,points_delta,balance_reason,reference_key,order_id,note) VALUES(?,?,'redeem_reversed',?,?,?)",[order.user_id,order.points_used,`redeem-reversed:${order.order_number}`,order.id,`訂單 ${order.order_number} 逾期取消，退回折抵點數`]);await connection.execute("UPDATE orders SET status='cancelled',cancelled_at=NOW(),stock_released_at=NOW() WHERE id=?",[order.id]);}await connection.commit();}catch(error){await connection.rollback();throw error;}finally{connection.release();}
}

async function issueEligiblePoints(){
  const database=db();if(!database)return;const [orders]=await database.query<(RowDataPacket&{id:number;user_id:string;order_number:string;points_earned:number})[]>("SELECT id,user_id,order_number,points_earned FROM orders WHERE status='completed' AND completed_at<=DATE_SUB(NOW(),INTERVAL 7 DAY) AND loyalty_issued_at IS NULL AND points_earned>0 AND payment_status IN ('paid','cod')");
  for(const order of orders){const connection=await database.getConnection();try{await connection.beginTransaction();const [locked]=await connection.query<(RowDataPacket&{loyalty_issued_at:Date|null})[]>("SELECT loyalty_issued_at FROM orders WHERE id=? FOR UPDATE",[order.id]);if(!locked[0]?.loyalty_issued_at){await connection.execute("INSERT IGNORE INTO loyalty_transactions(user_id,points_delta,balance_reason,reference_key,order_id,note) VALUES(?,?,'earn',?,?,?)",[order.user_id,order.points_earned,`earn:${order.order_number}`,order.id,`訂單 ${order.order_number} 完成回饋`]);await connection.execute("UPDATE orders SET loyalty_issued_at=NOW() WHERE id=?",[order.id]);}await connection.commit();}catch(error){await connection.rollback();throw error;}finally{connection.release();}}
}

export async function createOrder(userId: string, input: CheckoutInput) {
  await ensure();
  await expireUnpaidOrders();
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
  const merchandise = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const requestedPoints=Math.max(0,Math.trunc(Number(input.pointsUsed||0))), maxPoints=Math.floor(merchandise*0.2), pointsUsed=Math.min(requestedPoints,maxPoints);
  const total = merchandise - pointsUsed + method.fee, pointsEarned=Math.floor((merchandise-pointsUsed)/100);
  const database = db(); const number = orderNumber();
  if (!database) return { orderNumber: number, total, paymentMethod: method.payment, paymentStatus: method.paymentStatus };
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    for (const item of items) {
      if (item.variant?.id) {
        const [variantResult] = await connection.execute<ResultSetHeader>("UPDATE product_variants SET stock=stock-? WHERE id=? AND stock>=?", [item.quantity, item.variant.id, item.quantity]);
        if (!variantResult.affectedRows) throw new Error(`${item.product.name} 的規格庫存剛好售完，請重新結帳。`);
      }
      const [productResult] = await connection.execute<ResultSetHeader>("UPDATE products SET stock=stock-? WHERE id=? AND stock>=?", [item.quantity, item.product.id, item.quantity]);
      if (!productResult.affectedRows) throw new Error(`${item.product.name} 庫存不足，請重新結帳。`);
    }
    const expiresAt = method.payment === "ecpay_card" ? new Date(Date.now() + 30 * 60_000) : method.payment === "cod" ? null : new Date(Date.now() + 3 * 86400_000);
    if(pointsUsed){const [balanceRows]=await connection.query<(RowDataPacket&{balance:number})[]>("SELECT COALESCE(SUM(points_delta),0) AS balance FROM loyalty_transactions WHERE user_id=? FOR UPDATE",[userId]);if(Number(balanceRows[0]?.balance||0)<pointsUsed)throw new Error("可用點數不足，請重新確認。");}
    const [result] = await connection.execute<ResultSetHeader>("INSERT INTO orders(order_number,user_id,customer_name,customer_email,customer_phone,total,status,shipping_method,shipping_address,note,payment_method,payment_status,store_id,store_name,store_address,payment_expires_at,points_used,points_earned) VALUES(?,?,?,?,?,?, 'pending',?,?,?,?,?,?,?,?,?,?,?)", [number, userId, customerName, customerEmail, customerPhone, total, method.label, address, text(input.note, 1000) || null, method.payment, method.paymentStatus, input.store ? text(input.store.id, 40) : null, input.store ? text(input.store.name, 150) : null, input.store ? text(input.store.address, 255) : null, expiresAt,pointsUsed,pointsEarned]);
    for (const item of items) await connection.execute("INSERT INTO order_items(order_id,product_id,variant_id,product_name,sku,option_values,unit_price,quantity,image_url) VALUES(?,?,?,?,?,?,?,?,?)", [result.insertId, item.product.id, item.variant?.id || null, item.product.name, item.variant?.sku || item.product.sku, JSON.stringify(item.options), item.price, item.quantity, item.variant?.image || item.product.image || null]);
    if(pointsUsed)await connection.execute("INSERT INTO loyalty_transactions(user_id,points_delta,balance_reason,reference_key,order_id,note) VALUES(?,?,'redeem',?,?,?)",[userId,-pointsUsed,`redeem:${number}`,result.insertId,`訂單 ${number} 點數折抵`]);
    await connection.commit();
    return { orderNumber: number, total, paymentMethod: method.payment, paymentStatus: method.paymentStatus, pointsUsed, pointsEarned };
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

export type AdminOrder = { id:number; number:string; customerName:string; customerPhone:string; total:number; status:string; paymentMethod:string; paymentStatus:string; shippingMethod:string; shippingCarrier:string|null; trackingNumber:string|null; cancellationReason:string|null; createdAt:string };
export type AdminReturn = { id:number; orderNumber:string; customerName:string; reason:string; status:string; createdAt:string; resolutionNote:string | null; refundMethod:string|null; refundAmount:number|null; refundReference:string|null };
export type CustomerOrderItem={name:string;sku:string;options:Record<string,string>;price:number;quantity:number;image:string|null};
export type CustomerOrder = { number:string; total:number; status:string; paymentMethod:string; paymentStatus:string; shippingMethod:string; shippingCarrier:string|null; trackingNumber:string|null; createdAt:string; returnStatus:string | null; returnNote:string | null; pointsUsed:number; pointsEarned:number; items:CustomerOrderItem[] };
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
  const [orders]=await database.query<(RowDataPacket&{id:number;status:string;completed_at:Date|null})[]>("SELECT id,status,completed_at FROM orders WHERE order_number=? AND user_id=? LIMIT 1",[text(orderNumber,32),userId]); const order=orders[0];
  if(!order) throw new Error("找不到此訂單。"); if(!["shipped","completed"].includes(order.status)) throw new Error("此訂單目前尚未符合申請退貨的條件。");
  if(order.completed_at&&Date.now()-new Date(order.completed_at).getTime()>7*86400_000)throw new Error("此訂單已超過收貨後 7 日的退貨申請期限。");
  const [existing]=await database.query<RowDataPacket[]>("SELECT id FROM return_requests WHERE order_id=? AND status NOT IN ('rejected','cancelled') LIMIT 1",[order.id]); if(existing.length) throw new Error("此訂單已有進行中的退貨申請。");
  await database.execute("INSERT INTO return_requests(order_id,reason) VALUES(?,?)",[order.id,why]);
}

export async function requestOrderCancellation(userId:string,orderNumber:string,reason:string){
  await ensure();const database=db();if(!database)throw new Error("資料庫尚未連線。");const why=text(reason,500);if(!why)throw new Error("請填寫取消原因。");const [rows]=await database.query<(RowDataPacket&{id:number;status:string})[]>("SELECT id,status FROM orders WHERE user_id=? AND order_number=? LIMIT 1",[userId,text(orderNumber,32)]);const order=rows[0];if(!order)throw new Error("找不到訂單。");if(!['pending','confirmed','preparing'].includes(order.status))throw new Error("此訂單已進入出貨流程，請改由客服協助處理。");await database.execute("UPDATE orders SET cancellation_requested_at=NOW(),cancellation_reason=? WHERE id=?",[why,order.id]);
}

export async function listCustomerOrders(userId:string): Promise<CustomerOrder[]> {
  await ensure(); await expireUnpaidOrders();await issueEligiblePoints(); const database=db(); if(!database)return[];
  const [rows]=await database.query<(RowDataPacket&{id:number;order_number:string;total:number;status:string;payment_method:string;payment_status:string;shipping_method:string;shipping_carrier:string|null;tracking_number:string|null;created_at:Date;return_status:string|null;resolution_note:string|null;points_used:number;points_earned:number})[]>("SELECT o.id,o.order_number,o.total,o.status,o.payment_method,o.payment_status,o.shipping_method,o.shipping_carrier,o.tracking_number,o.created_at,r.status AS return_status,r.resolution_note,o.points_used,o.points_earned FROM orders o LEFT JOIN return_requests r ON r.order_id=o.id WHERE o.user_id=? ORDER BY o.created_at DESC,o.id DESC",[userId]);
  if(!rows.length)return[];const ids=rows.map(row=>row.id),marks=ids.map(()=>"?").join(",");const [itemRows]=await database.query<(RowDataPacket&{order_id:number;product_name:string;sku:string;option_values:string;unit_price:number;quantity:number;image_url:string|null})[]>(`SELECT order_id,product_name,sku,option_values,unit_price,quantity,image_url FROM order_items WHERE order_id IN (${marks}) ORDER BY id`,ids);const itemsByOrder=new Map<number,CustomerOrderItem[]>();for(const item of itemRows){const current=itemsByOrder.get(Number(item.order_id))||[];let options:Record<string,string>={};try{options=JSON.parse(item.option_values||"{}");}catch{}current.push({name:item.product_name,sku:item.sku,options,price:Number(item.unit_price),quantity:Number(item.quantity),image:item.image_url});itemsByOrder.set(Number(item.order_id),current);}
  return rows.map(row=>({number:row.order_number,total:Number(row.total),status:row.status,paymentMethod:row.payment_method,paymentStatus:row.payment_status,shippingMethod:row.shipping_method,shippingCarrier:row.shipping_carrier,trackingNumber:row.tracking_number,createdAt:new Date(row.created_at).toISOString(),returnStatus:row.return_status,returnNote:row.resolution_note,pointsUsed:Number(row.points_used||0),pointsEarned:Number(row.points_earned||0),items:itemsByOrder.get(Number(row.id))||[]}));
}

export async function listAdminOrders(): Promise<AdminOrder[]> {
  await ensure(); await expireUnpaidOrders(); const database=db(); if (!database) return [];
  const [rows] = await database.query<(RowDataPacket & { id:number; order_number:string; customer_name:string; customer_phone:string; total:number; status:string; payment_method:string; payment_status:string; shipping_method:string; shipping_carrier:string|null; tracking_number:string|null;cancellation_reason:string|null; created_at:Date })[]>("SELECT id,order_number,customer_name,customer_phone,total,status,payment_method,payment_status,shipping_method,shipping_carrier,tracking_number,cancellation_reason,created_at FROM orders ORDER BY created_at DESC,id DESC");
  return rows.map((row)=>({id:Number(row.id),number:row.order_number,customerName:row.customer_name,customerPhone:row.customer_phone,total:Number(row.total),status:row.status,paymentMethod:row.payment_method,paymentStatus:row.payment_status,shippingMethod:row.shipping_method,shippingCarrier:row.shipping_carrier,trackingNumber:row.tracking_number,cancellationReason:row.cancellation_reason,createdAt:new Date(row.created_at).toISOString()}));
}

export async function updateOrderStatus(id:number,status:string,shippingCarrier?:string,trackingNumber?:string) {
  await ensure();
  const allowed=new Set(["pending","confirmed","preparing","shipped","completed","cancelled"]); if(!allowed.has(status))throw new Error("訂單狀態不正確。");
  const database=db();if(!database)return;
  const orderId=Math.trunc(id); const connection=await database.getConnection();
  try {
    await connection.beginTransaction();
    const [rows]=await connection.query<(RowDataPacket&{status:string;stock_released_at:Date|null;user_id:string;order_number:string;points_used:number})[]>("SELECT status,stock_released_at,user_id,order_number,points_used FROM orders WHERE id=? FOR UPDATE",[orderId]);
    const order=rows[0]; if(!order)throw new Error("找不到訂單。");
    const carrier=text(shippingCarrier,40)||null, tracking=text(trackingNumber,100)||null;
    if(status==="shipped"&&!carrier)throw new Error("請選擇物流公司。");
    if(status==="shipped"&&carrier!=="綠界超商物流"&&!tracking)throw new Error("請填寫物流單號。");
    if(status==="cancelled"&&!order.stock_released_at){
      const [items]=await connection.query<(RowDataPacket&{product_id:number;variant_id:number|null;quantity:number})[]>("SELECT product_id,variant_id,quantity FROM order_items WHERE order_id=?",[orderId]);
      for(const item of items){
        if(item.variant_id)await connection.execute("UPDATE product_variants SET stock=stock+? WHERE id=?",[item.quantity,item.variant_id]);
        await connection.execute("UPDATE products SET stock=stock+? WHERE id=?",[item.quantity,item.product_id]);
      }
      if(order.points_used)await connection.execute("INSERT IGNORE INTO loyalty_transactions(user_id,points_delta,balance_reason,reference_key,order_id,note) VALUES(?,?,'redeem_reversed',?,?,?)",[order.user_id,order.points_used,`redeem-reversed:${order.order_number}`,orderId,`訂單 ${order.order_number} 已取消，退回折抵點數`]);
    }
    await connection.execute("UPDATE orders SET status=?,shipping_carrier=COALESCE(?,shipping_carrier),tracking_number=COALESCE(?,tracking_number),shipped_at=CASE WHEN ?='shipped' THEN COALESCE(shipped_at,NOW()) ELSE shipped_at END,completed_at=CASE WHEN ?='completed' THEN COALESCE(completed_at,NOW()) ELSE completed_at END,cancelled_at=CASE WHEN ?='cancelled' THEN COALESCE(cancelled_at,NOW()) ELSE cancelled_at END,stock_released_at=CASE WHEN ?='cancelled' THEN COALESCE(stock_released_at,NOW()) ELSE stock_released_at END WHERE id=?",[status,carrier,tracking,status,status,status,status,orderId]);
    await connection.commit();
  } catch(error){await connection.rollback();throw error;} finally{connection.release();}
}

export async function listAdminReturns(): Promise<AdminReturn[]> {
  await ensure(); const database=db(); if(!database)return[];
  const [rows]=await database.query<(RowDataPacket&{id:number;order_number:string;customer_name:string;reason:string;status:string;created_at:Date;resolution_note:string|null;refund_method:string|null;refund_amount:number|null;refund_reference:string|null})[]>("SELECT r.id,o.order_number,o.customer_name,r.reason,r.status,r.created_at,r.resolution_note,r.refund_method,r.refund_amount,r.refund_reference FROM return_requests r JOIN orders o ON o.id=r.order_id ORDER BY r.created_at DESC,r.id DESC");
  return rows.map((row)=>({id:Number(row.id),orderNumber:row.order_number,customerName:row.customer_name,reason:row.reason,status:row.status,createdAt:new Date(row.created_at).toISOString(),resolutionNote:row.resolution_note,refundMethod:row.refund_method,refundAmount:row.refund_amount===null?null:Number(row.refund_amount),refundReference:row.refund_reference}));
}

export async function updateReturnStatus(id:number,status:string,note:string,refundMethod?:string,refundAmount?:number,refundReference?:string) {
  await ensure();const allowed=new Set(["requested","approved","received","refunded","rejected","cancelled"]);if(!allowed.has(status))throw new Error("退貨狀態不正確。");const database=db();if(!database)return;
  const returnId=Math.trunc(id),connection=await database.getConnection();
  try{
    await connection.beginTransaction();
    const [rows]=await connection.query<(RowDataPacket&{order_id:number;status:string;inventory_restored_at:Date|null;payment_method:string;total:number;user_id:string;order_number:string;points_used:number;points_earned:number;loyalty_issued_at:Date|null})[]>("SELECT r.order_id,r.status,r.inventory_restored_at,o.payment_method,o.total,o.user_id,o.order_number,o.points_used,o.points_earned,o.loyalty_issued_at FROM return_requests r JOIN orders o ON o.id=r.order_id WHERE r.id=? FOR UPDATE",[returnId]);
    const request=rows[0];if(!request)throw new Error("找不到退貨申請。");
    if(status==="refunded"&&request.status!=="received")throw new Error("請先確認已收到退貨商品，再記錄退款。");
    const method=refundMethod==="ecpay_card"?"ecpay_card":refundMethod==="manual_transfer"?"manual_transfer":null;
    const amount=Number(refundAmount||0);
    if(status==="refunded"&&(!method||amount!==Number(request.total)))throw new Error("本店不支援部分退款；請填寫完整退款金額與方式。");
    if(status==="refunded"&&request.payment_method==="ecpay_card"&&method!=="ecpay_card")throw new Error("信用卡訂單請選擇綠界信用卡退刷。");
    if(status==="refunded"&&request.payment_method!=="ecpay_card"&&method!=="manual_transfer")throw new Error("非信用卡訂單請選擇手動匯款退款。");
    if(status==="received"&&!request.inventory_restored_at){
      const [items]=await connection.query<(RowDataPacket&{product_id:number;variant_id:number|null;quantity:number})[]>("SELECT product_id,variant_id,quantity FROM order_items WHERE order_id=?",[request.order_id]);
      for(const item of items){if(item.variant_id)await connection.execute("UPDATE product_variants SET stock=stock+? WHERE id=?",[item.quantity,item.variant_id]);await connection.execute("UPDATE products SET stock=stock+? WHERE id=?",[item.quantity,item.product_id]);}
      await connection.execute("UPDATE orders SET stock_released_at=COALESCE(stock_released_at,NOW()) WHERE id=?",[request.order_id]);
      if(request.loyalty_issued_at&&request.points_earned)await connection.execute("INSERT IGNORE INTO loyalty_transactions(user_id,points_delta,balance_reason,reference_key,order_id,note) VALUES(?,?,'earn_reversed',?,?,?)",[request.user_id,-request.points_earned,`earn-reversed:${request.order_number}`,request.order_id,`訂單 ${request.order_number} 退貨，扣回回饋點數`]);
    }
    if(status==="refunded"&&request.points_used)await connection.execute("INSERT IGNORE INTO loyalty_transactions(user_id,points_delta,balance_reason,reference_key,order_id,note) VALUES(?,?,'redeem_reversed',?,?,?)",[request.user_id,request.points_used,`redeem-reversed:${request.order_number}`,request.order_id,`訂單 ${request.order_number} 退款，退回折抵點數`]);
    await connection.execute("UPDATE return_requests SET status=?,resolution_note=?,refund_method=COALESCE(?,refund_method),refund_amount=COALESCE(?,refund_amount),refund_reference=COALESCE(?,refund_reference),inventory_restored_at=CASE WHEN ?='received' THEN COALESCE(inventory_restored_at,NOW()) ELSE inventory_restored_at END WHERE id=?",[status,text(note,2000)||null,method,status==="refunded"?amount:null,text(refundReference,100)||null,status,returnId]);
    await connection.commit();
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}

export type StoreSettings = { returnAddress:string; returnRecipient:string; returnPhone:string; notificationEmail:string };
export async function readStoreSettings():Promise<StoreSettings>{
  await ensure();const database=db();const defaults={returnAddress:process.env.STORE_RETURN_ADDRESS||"",returnRecipient:process.env.STORE_RETURN_RECIPIENT||"",returnPhone:process.env.STORE_RETURN_PHONE||"",notificationEmail:process.env.STORE_NOTIFICATION_EMAIL||""};if(!database)return defaults;
  const [rows]=await database.query<(RowDataPacket&{setting_key:string;setting_value:string})[]>("SELECT setting_key,setting_value FROM store_settings WHERE setting_key IN ('return_address','return_recipient','return_phone','notification_email')");
  const values=new Map(rows.map(row=>[row.setting_key,row.setting_value]));return {returnAddress:values.get("return_address")||defaults.returnAddress,returnRecipient:values.get("return_recipient")||defaults.returnRecipient,returnPhone:values.get("return_phone")||defaults.returnPhone,notificationEmail:values.get("notification_email")||defaults.notificationEmail};
}
export async function saveStoreSettings(input:StoreSettings){
  await ensure();const database=db();if(!database)return;const values:[[string,string],[string,string],[string,string],[string,string]]=[["return_address",text(input.returnAddress,500)],["return_recipient",text(input.returnRecipient,100)],["return_phone",text(input.returnPhone,20)],["notification_email",text(input.notificationEmail,254)]];
  for(const [key,value] of values)await database.execute("INSERT INTO store_settings(setting_key,setting_value) VALUES(?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)",[key,value]);
}

export type LoyaltyTransaction={id:number;pointsDelta:number;reason:string;note:string|null;createdAt:string};
export async function getMemberLoyalty(userId:string){
  await ensure();await issueEligiblePoints();const database=db();if(!database)return {balance:0,transactions:[] as LoyaltyTransaction[]};
  const [rows]=await database.query<(RowDataPacket&{id:number;points_delta:number;balance_reason:string;note:string|null;created_at:Date})[]>("SELECT id,points_delta,balance_reason,note,created_at FROM loyalty_transactions WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100",[userId]);
  const balance=rows.reduce((sum,row)=>sum+Number(row.points_delta),0);return {balance,transactions:rows.map(row=>({id:Number(row.id),pointsDelta:Number(row.points_delta),reason:row.balance_reason,note:row.note,createdAt:new Date(row.created_at).toISOString()}))};
}

export type AdminMember={id:string;name:string;email:string;phone:string|null;createdAt:string;points:number;orders:number;spent:number};
export async function listAdminMembers():Promise<AdminMember[]>{
  await ensure();await issueEligiblePoints();const database=db();if(!database)return[];
  const [rows]=await database.query<(RowDataPacket&{id:string;name:string;email:string;phone:string|null;created_at:Date;points:number;orders:number;spent:number})[]>("SELECT u.id,u.name,u.email,u.phone,u.created_at,COALESCE(p.points,0) AS points,COALESCE(o.orders,0) AS orders,COALESCE(o.spent,0) AS spent FROM users u LEFT JOIN (SELECT user_id,SUM(points_delta) AS points FROM loyalty_transactions GROUP BY user_id) p ON p.user_id=u.id LEFT JOIN (SELECT user_id,COUNT(*) AS orders,SUM(CASE WHEN status NOT IN ('cancelled') THEN total ELSE 0 END) AS spent FROM orders GROUP BY user_id) o ON o.user_id=u.id WHERE u.role='customer' ORDER BY u.created_at DESC");
  return rows.map(row=>({id:row.id,name:row.name,email:row.email,phone:row.phone,createdAt:new Date(row.created_at).toISOString(),points:Number(row.points),orders:Number(row.orders),spent:Number(row.spent)}));
}
export async function adjustMemberPoints(userId:string,points:number,note:string){
  await ensure();const database=db();if(!database)return;const delta=Math.trunc(Number(points));const reason=text(note,500);if(!delta||!reason)throw new Error("請填寫非零的點數調整與原因。");
  const [existing]=await database.query<RowDataPacket[]>("SELECT id FROM users WHERE id=? AND role='customer' LIMIT 1",[userId]);if(!existing.length)throw new Error("找不到會員。");
  if(delta<0){const loyalty=await getMemberLoyalty(userId);if(loyalty.balance+delta<0)throw new Error("扣除後點數不可小於 0。");}
  await database.execute("INSERT INTO loyalty_transactions(user_id,points_delta,balance_reason,reference_key,note) VALUES(?,?,'admin_adjust',?,?,?)",[userId,delta,`admin:${userId}:${Date.now()}`,reason]);
}
