import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import { randomBytes } from "node:crypto";

export type CatalogProduct = {
  id: number; name: string; brand: string; cat: string; price: number; color: string;
  fit: string[]; image?: string; sku: string; stock: number; status: "active" | "draft" | "out_of_stock";
  description: string; shippingType: "small" | "home" | "quote";
};


let pool: Pool | null | undefined;
const memory = new Map<number, CatalogProduct>();
let ready: Promise<void> | undefined;

function db() {
  if (pool !== undefined) return pool;
  if (!process.env.MYSQL_HOST) return (pool = null);
  return (pool = mysql.createPool({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE, connectionLimit: 5, charset: "utf8mb4" }));
}

function generatedSku(now=new Date()){const fields=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(now).filter((part)=>part.type!=="literal").map((part)=>[part.type,part.value]));return `YD-${fields.year}${fields.month}${fields.day}-${fields.hour}${fields.minute}${fields.second}-${randomBytes(2).toString("hex").toUpperCase()}`;}

async function ensure() {
  ready ??= (async () => {
    const database = db();
    if (!database) return;
    await database.execute(`CREATE TABLE IF NOT EXISTS products (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, sku VARCHAR(64) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL, brand VARCHAR(100) NOT NULL, category VARCHAR(100) NOT NULL,
      price INT UNSIGNED NOT NULL DEFAULT 0, stock INT UNSIGNED NOT NULL DEFAULT 0,
      status ENUM('active','draft','out_of_stock') NOT NULL DEFAULT 'draft', color VARCHAR(30) NOT NULL DEFAULT 'smoke',
      fitment JSON NOT NULL, image_url TEXT NULL, description TEXT NOT NULL, shipping_type ENUM('small','home','quote') NOT NULL DEFAULT 'small',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX products_status_idx(status), INDEX products_category_idx(category)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await database.execute(`CREATE TABLE IF NOT EXISTS orders (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, order_number VARCHAR(32) NOT NULL UNIQUE,
      user_id CHAR(36) NULL, customer_name VARCHAR(100) NOT NULL, customer_email VARCHAR(254) NOT NULL,
      customer_phone VARCHAR(20) NOT NULL, total INT UNSIGNED NOT NULL DEFAULT 0,
      status ENUM('pending','confirmed','preparing','shipped','completed','cancelled') NOT NULL DEFAULT 'pending',
      shipping_method VARCHAR(100) NOT NULL, shipping_address TEXT NOT NULL, note TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX orders_status_idx(status), INDEX orders_user_idx(user_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await database.execute(`CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, admin_user_id CHAR(36) NOT NULL,
      action VARCHAR(80) NOT NULL, entity_type VARCHAR(50) NOT NULL, entity_id VARCHAR(100) NULL,
      details JSON NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX audit_admin_idx(admin_user_id), INDEX audit_created_idx(created_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  })();
  await ready;
}

const fromRow = (r: RowDataPacket): CatalogProduct => ({ id:Number(r.id), sku:r.sku, name:r.name, brand:r.brand, cat:r.category, price:Number(r.price), stock:Number(r.stock), status:r.status, color:r.color, fit:typeof r.fitment === "string" ? JSON.parse(r.fitment) : r.fitment, image:r.image_url || undefined, description:r.description, shippingType:r.shipping_type });

export async function listProducts(admin = false) { await ensure(); const database=db(); if(!database) return [...memory.values()].filter(p=>admin||p.status==="active"); const [rows]=await database.query<RowDataPacket[]>(`SELECT * FROM products ${admin?"":"WHERE status='active'"} ORDER BY id`); return rows.map(fromRow); }
export async function saveProduct(input: Partial<CatalogProduct>, adminUserId: string) { await ensure(); const database=db(); const id=Number(input.id||0); const product:CatalogProduct={id,sku:String(input.sku||"").trim()||generatedSku(),name:String(input.name||"").trim(),brand:String(input.brand||"").trim(),cat:String(input.cat||"").trim(),price:Math.max(0,Number(input.price||0)),stock:Math.max(0,Number(input.stock||0)),status:input.status||"draft",color:String(input.color||"smoke"),fit:Array.isArray(input.fit)?input.fit.map(String):[],image:input.image?String(input.image):undefined,description:String(input.description||""),shippingType:input.shippingType||"small"};
  if(!product.name||!product.brand||!product.cat) throw new Error("商品名稱、品牌和分類為必填。");
  if(!database){const next=id||Math.max(0,...memory.keys())+1;product.id=next;memory.set(next,product);return product;}
  let savedId=id;
  if(id){await database.execute("UPDATE products SET sku=?,name=?,brand=?,category=?,price=?,stock=?,status=?,color=?,fitment=?,image_url=?,description=?,shipping_type=? WHERE id=?",[product.sku,product.name,product.brand,product.cat,product.price,product.stock,product.status,product.color,JSON.stringify(product.fit),product.image||null,product.description,product.shippingType,id]);}
  else {const [result]=await database.execute<ResultSetHeader>("INSERT INTO products(sku,name,brand,category,price,stock,status,color,fitment,image_url,description,shipping_type) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",[product.sku,product.name,product.brand,product.cat,product.price,product.stock,product.status,product.color,JSON.stringify(product.fit),product.image||null,product.description,product.shippingType]);savedId=result.insertId;}
  await database.execute("INSERT INTO admin_audit_logs(admin_user_id,action,entity_type,entity_id,details) VALUES(?,'save','product',?,?)",[adminUserId,String(savedId),JSON.stringify({name:product.name,status:product.status})]); product.id=savedId; return product;
}
export async function deleteProduct(id:number,adminUserId:string){await ensure();const database=db();if(!database){memory.delete(id);return;}await database.execute("DELETE FROM products WHERE id=?",[id]);await database.execute("INSERT INTO admin_audit_logs(admin_user_id,action,entity_type,entity_id) VALUES(?,'delete','product',?)",[adminUserId,String(id)]);}
export async function bulkUpdateProductStatus(ids:number[],status:CatalogProduct["status"],adminUserId:string){await ensure();const unique=[...new Set(ids)].filter(Number.isInteger);if(!unique.length)return 0;const database=db();if(!database){let changed=0;for(const id of unique){const product=memory.get(id);if(product){product.status=status;changed++;}}return changed;}const placeholders=unique.map(()=>"?").join(",");const[result]=await database.execute<ResultSetHeader>(`UPDATE products SET status=? WHERE id IN (${placeholders})`,[status,...unique]);await database.execute("INSERT INTO admin_audit_logs(admin_user_id,action,entity_type,details) VALUES(?,'bulk_status','product',?)",[adminUserId,JSON.stringify({ids:unique,status})]);return result.affectedRows;}
export async function deleteProducts(ids:number[],adminUserId:string){await ensure();const unique=[...new Set(ids)].filter(Number.isInteger);if(!unique.length)return 0;const database=db();if(!database){let changed=0;for(const id of unique)if(memory.delete(id))changed++;return changed;}const placeholders=unique.map(()=>"?").join(",");const[result]=await database.execute<ResultSetHeader>(`DELETE FROM products WHERE id IN (${placeholders})`,unique);await database.execute("INSERT INTO admin_audit_logs(admin_user_id,action,entity_type,details) VALUES(?,'bulk_delete','product',?)",[adminUserId,JSON.stringify({ids:unique})]);return result.affectedRows;}
export async function adminOverview(){await ensure();const database=db();if(!database)return{products:memory.size,orders:0,pendingOrders:0,revenue:0};const [rows]=await database.query<(RowDataPacket&{products:number;orders:number;pendingOrders:number;revenue:number})[]>("SELECT (SELECT COUNT(*) FROM products) products,(SELECT COUNT(*) FROM orders) orders,(SELECT COUNT(*) FROM orders WHERE status IN ('pending','confirmed','preparing')) pendingOrders,(SELECT COALESCE(SUM(total),0) FROM orders WHERE status<>'cancelled') revenue");return rows[0];}
