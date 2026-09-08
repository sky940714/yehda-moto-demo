import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import { randomBytes } from "node:crypto";

export type ProductSpecification = { name: string; values: string[] };
export type ProductVariant = { id?: number; sku: string; options: Record<string,string>; price: number; stock: number; image?: string; isActive: boolean };
export type CatalogOptionKind = "brand" | "category" | "vehicle";
export type CatalogOptions = { brands: string[]; categories: string[]; vehicles: string[] };

export type CatalogProduct = {
  id: number; name: string; brand: string; cat: string; price: number; color: string;
  fit: string[]; image?: string; images: string[]; sku: string; stock: number;
  status: "active" | "draft" | "out_of_stock"; description: string;
  shippingType: "small" | "home" | "quote"; specifications: ProductSpecification[]; variants: ProductVariant[];
};

let pool: Pool | null | undefined;
const memory = new Map<number, CatalogProduct>();
const memoryOptions: Record<CatalogOptionKind, Set<string>> = { brand: new Set(), category: new Set(), vehicle: new Set() };
let ready: Promise<void> | undefined;

function db() {
  if (pool !== undefined) return pool;
  if (!process.env.MYSQL_HOST) return (pool = null);
  return (pool = mysql.createPool({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE, connectionLimit: 5, charset: "utf8mb4" }));
}

function generatedSku(now=new Date()){const fields=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(now).filter((part)=>part.type!=="literal").map((part)=>[part.type,part.value]));return `YD-${fields.year}${fields.month}${fields.day}-${fields.hour}${fields.minute}${fields.second}-${randomBytes(2).toString("hex").toUpperCase()}`;}

const cleanList = (value: unknown, limit = 50) => Array.isArray(value) ? [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))].slice(0, limit) : [];
const cleanSpecifications = (value: unknown): ProductSpecification[] => Array.isArray(value) ? value.map((item) => {
  const row = item as { name?: unknown; values?: unknown };
  return { name: String(row?.name || "").trim(), values: cleanList(row?.values, 30) };
}).filter((item) => item.name && item.values.length).slice(0, 20) : [];
const cleanVariants = (value: unknown, specifications:ProductSpecification[]):ProductVariant[] => {
  if(!Array.isArray(value)||!specifications.length)return [];
  const allowed=new Map(specifications.map((group)=>[group.name,new Set(group.values)]));
  const seen=new Set<string>(),result:ProductVariant[]=[];
  for(const item of value){
    const row=item as Partial<ProductVariant>,options=Object.fromEntries(Object.entries(row.options||{}).map(([key,val])=>[String(key).trim(),String(val).trim()]));
    const valid=specifications.every((group)=>allowed.get(group.name)?.has(options[group.name]));
    const key=specifications.map((group)=>`${group.name}:${options[group.name]||""}`).join("|");
    if(!valid||seen.has(key))continue;seen.add(key);
    result.push({id:Number(row.id)||undefined,sku:String(row.sku||"").trim(),options,price:Math.max(0,Number(row.price||0)),stock:Math.max(0,Number(row.stock||0)),image:String(row.image||"").trim()||undefined,isActive:row.isActive!==false});
    if(result.length>=300)break;
  }
  return result;
};

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
    await database.execute(`CREATE TABLE IF NOT EXISTS catalog_options (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      kind ENUM('brand','category','vehicle') NOT NULL, name VARCHAR(150) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY catalog_options_kind_name_unique(kind,name), INDEX catalog_options_kind_sort_idx(kind,is_active,sort_order)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await database.execute(`CREATE TABLE IF NOT EXISTS product_images (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, product_id BIGINT UNSIGNED NOT NULL,
      image_url TEXT NOT NULL, sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX product_images_product_sort_idx(product_id,sort_order),
      CONSTRAINT product_images_product_fk FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await database.execute(`CREATE TABLE IF NOT EXISTS product_specifications (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, product_id BIGINT UNSIGNED NOT NULL,
      spec_name VARCHAR(100) NOT NULL, spec_value VARCHAR(150) NOT NULL,
      group_sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0, value_sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
      INDEX product_specs_product_sort_idx(product_id,group_sort_order,value_sort_order),
      CONSTRAINT product_specs_product_fk FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await database.execute(`CREATE TABLE IF NOT EXISTS product_variants (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, product_id BIGINT UNSIGNED NOT NULL,
      sku VARCHAR(100) NOT NULL, option_values JSON NOT NULL, price INT UNSIGNED NOT NULL DEFAULT 0,
      stock INT UNSIGNED NOT NULL DEFAULT 0, image_url TEXT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY product_variants_product_sku_unique(product_id,sku), INDEX product_variants_product_sort_idx(product_id,is_active,sort_order),
      CONSTRAINT product_variants_product_fk FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
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
    await database.execute("INSERT IGNORE INTO catalog_options(kind,name) SELECT 'brand',brand FROM products WHERE brand<>''");
    await database.execute("INSERT IGNORE INTO catalog_options(kind,name) SELECT 'category',category FROM products WHERE category<>''");
    await database.execute("INSERT INTO product_images(product_id,image_url,sort_order) SELECT p.id,p.image_url,0 FROM products p WHERE p.image_url IS NOT NULL AND p.image_url<>'' AND NOT EXISTS(SELECT 1 FROM product_images pi WHERE pi.product_id=p.id)");
    const [fitRows] = await database.query<RowDataPacket[]>("SELECT fitment FROM products");
    const vehicles = new Set<string>();
    for (const row of fitRows) for (const value of cleanList(typeof row.fitment === "string" ? JSON.parse(row.fitment) : row.fitment)) vehicles.add(value);
    for (const vehicle of vehicles) await database.execute("INSERT IGNORE INTO catalog_options(kind,name) VALUES('vehicle',?)",[vehicle]);
  })();
  await ready;
}

const fromRow = (r: RowDataPacket): CatalogProduct => ({ id:Number(r.id), sku:r.sku, name:r.name, brand:r.brand, cat:r.category, price:Number(r.price), stock:Number(r.stock), status:r.status, color:r.color, fit:cleanList(typeof r.fitment === "string" ? JSON.parse(r.fitment) : r.fitment), image:r.image_url || undefined, images:r.image_url ? [r.image_url] : [], description:r.description, shippingType:r.shipping_type, specifications:[], variants:[] });

export async function listProducts(admin = false) {
  await ensure(); const database=db();
  if(!database) return [...memory.values()].filter(p=>admin||p.status==="active");
  const [rows]=await database.query<RowDataPacket[]>(`SELECT * FROM products ${admin?"":"WHERE status='active'"} ORDER BY id`);
  if (!rows.length) return [];
  const ids=rows.map((row)=>Number(row.id)), placeholders=ids.map(()=>"?").join(",");
  const [imageRows,specRows,variantRows]=await Promise.all([
    database.query<RowDataPacket[]>(`SELECT product_id,image_url,sort_order FROM product_images WHERE product_id IN (${placeholders}) ORDER BY product_id,sort_order,id`,ids).then(([result])=>result),
    database.query<RowDataPacket[]>(`SELECT product_id,spec_name,spec_value,group_sort_order,value_sort_order FROM product_specifications WHERE product_id IN (${placeholders}) ORDER BY product_id,group_sort_order,value_sort_order,id`,ids).then(([result])=>result),
    database.query<RowDataPacket[]>(`SELECT id,product_id,sku,option_values,price,stock,image_url,is_active FROM product_variants WHERE product_id IN (${placeholders}) ORDER BY product_id,sort_order,id`,ids).then(([result])=>result),
  ]);
  const images=new Map<number,string[]>(), specs=new Map<number,ProductSpecification[]>(),variants=new Map<number,ProductVariant[]>();
  for(const row of imageRows){const id=Number(row.product_id),list=images.get(id)||[];list.push(String(row.image_url));images.set(id,list);}
  for(const row of specRows){const id=Number(row.product_id),list=specs.get(id)||[],order=Number(row.group_sort_order);let group=list[order];if(!group){group={name:String(row.spec_name),values:[]};list[order]=group;}group.values.push(String(row.spec_value));specs.set(id,list);}
  for(const row of variantRows){const id=Number(row.product_id),list=variants.get(id)||[];list.push({id:Number(row.id),sku:String(row.sku),options:typeof row.option_values==="string"?JSON.parse(row.option_values):row.option_values,price:Number(row.price),stock:Number(row.stock),image:row.image_url||undefined,isActive:Boolean(row.is_active)});variants.set(id,list);}
  return rows.map((row)=>{const product=fromRow(row),orderedImages=images.get(product.id)||product.images;return{...product,images:orderedImages,image:orderedImages[0],specifications:(specs.get(product.id)||[]).filter(Boolean),variants:variants.get(product.id)||[]};});
}

export async function listCatalogOptions():Promise<CatalogOptions>{
  await ensure();const database=db();
  if(!database)return{brands:[...memoryOptions.brand],categories:[...memoryOptions.category],vehicles:[...memoryOptions.vehicle]};
  const [rows]=await database.query<RowDataPacket[]>("SELECT kind,name FROM catalog_options WHERE is_active=TRUE ORDER BY sort_order,name");
  const result:CatalogOptions={brands:[],categories:[],vehicles:[]};
  for(const row of rows){const key=row.kind==="brand"?"brands":row.kind==="category"?"categories":"vehicles";result[key].push(String(row.name));}
  return result;
}

export async function saveCatalogOption(kind:CatalogOptionKind,name:string){
  await ensure();const cleanName=String(name||"").trim();if(!cleanName)throw new Error("名稱不可空白。");if(cleanName.length>150)throw new Error("名稱不可超過 150 個字。");
  const database=db();if(!database){memoryOptions[kind].add(cleanName);return cleanName;}
  await database.execute("INSERT INTO catalog_options(kind,name,is_active) VALUES(?,?,TRUE) ON DUPLICATE KEY UPDATE is_active=TRUE",[kind,cleanName]);return cleanName;
}

export async function reorderCatalogOptions(kind: CatalogOptionKind, names: string[]) {
  await ensure(); const ordered = [...new Set(names.map((name) => String(name).trim()).filter(Boolean))];
  const database = db();
  if (!database) { const values = ordered.filter((name) => memoryOptions[kind].has(name)); memoryOptions[kind] = new Set([...values, ...[...memoryOptions[kind]].filter((name) => !values.includes(name))]); return; }
  const connection = await database.getConnection();
  try { await connection.beginTransaction(); for (let index = 0; index < ordered.length; index++) await connection.execute("UPDATE catalog_options SET sort_order=? WHERE kind=? AND name=?", [index, kind, ordered[index]]); await connection.commit(); }
  catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

export async function saveProduct(input: Partial<CatalogProduct>, adminUserId: string) {
  await ensure(); const database=db(); const id=Number(input.id||0), fit=cleanList(input.fit), images=cleanList(input.images?.length?input.images:(input.image?[input.image]:[]),8), specifications=cleanSpecifications(input.specifications),variants=cleanVariants(input.variants,specifications);
  const allowedStatus=new Set(["active","draft","out_of_stock"]),allowedShipping=new Set(["small","home","quote"]);
  const status=allowedStatus.has(String(input.status))?input.status as CatalogProduct["status"]:"draft",shippingType=allowedShipping.has(String(input.shippingType))?input.shippingType as CatalogProduct["shippingType"]:"small";
  const product:CatalogProduct={id,sku:String(input.sku||"").trim()||generatedSku(),name:String(input.name||"").trim(),brand:String(input.brand||"").trim(),cat:String(input.cat||"").trim(),price:Math.max(0,Number(input.price||0)),stock:Math.max(0,Number(input.stock||0)),status,color:String(input.color||"smoke"),fit,image:images[0],images,description:String(input.description||""),shippingType,specifications,variants};
  if(!product.name||!product.brand||!product.cat) throw new Error("商品名稱、品牌和分類為必填。");
  const activeVariants=variants.filter((variant)=>variant.isActive);if(activeVariants.length){const priced=activeVariants.map((variant)=>variant.price).filter((price)=>price>0);if(priced.length)product.price=Math.min(...priced);product.stock=activeVariants.reduce((sum,variant)=>sum+variant.stock,0);}
  if(!database){const next=id||Math.max(0,...memory.keys())+1;product.id=next;memory.set(next,product);memoryOptions.brand.add(product.brand);memoryOptions.category.add(product.cat);fit.forEach((value)=>memoryOptions.vehicle.add(value));return product;}
  const connection=await database.getConnection();let savedId=id;
  try{
    await connection.beginTransaction();
    if(id){await connection.execute("UPDATE products SET sku=?,name=?,brand=?,category=?,price=?,stock=?,status=?,color=?,fitment=?,image_url=?,description=?,shipping_type=? WHERE id=?",[product.sku,product.name,product.brand,product.cat,product.price,product.stock,product.status,product.color,JSON.stringify(product.fit),product.image||null,product.description,product.shippingType,id]);}
    else {const [result]=await connection.execute<ResultSetHeader>("INSERT INTO products(sku,name,brand,category,price,stock,status,color,fitment,image_url,description,shipping_type) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",[product.sku,product.name,product.brand,product.cat,product.price,product.stock,product.status,product.color,JSON.stringify(product.fit),product.image||null,product.description,product.shippingType]);savedId=result.insertId;}
    await connection.execute("DELETE FROM product_images WHERE product_id=?",[savedId]);
    for(let index=0;index<images.length;index++)await connection.execute("INSERT INTO product_images(product_id,image_url,sort_order) VALUES(?,?,?)",[savedId,images[index],index]);
    await connection.execute("DELETE FROM product_specifications WHERE product_id=?",[savedId]);
    for(let groupIndex=0;groupIndex<specifications.length;groupIndex++)for(let valueIndex=0;valueIndex<specifications[groupIndex].values.length;valueIndex++)await connection.execute("INSERT INTO product_specifications(product_id,spec_name,spec_value,group_sort_order,value_sort_order) VALUES(?,?,?,?,?)",[savedId,specifications[groupIndex].name,specifications[groupIndex].values[valueIndex],groupIndex,valueIndex]);
    await connection.execute("DELETE FROM product_variants WHERE product_id=?",[savedId]);
    for(let index=0;index<variants.length;index++){const variant=variants[index];await connection.execute("INSERT INTO product_variants(product_id,sku,option_values,price,stock,image_url,is_active,sort_order) VALUES(?,?,?,?,?,?,?,?)",[savedId,variant.sku||`${product.sku}-${index+1}`,JSON.stringify(variant.options),variant.price,variant.stock,variant.image||null,variant.isActive,index]);}
    for(const [kind,value] of [["brand",product.brand],["category",product.cat],...fit.map((value)=>["vehicle",value])] as [CatalogOptionKind,string][])await connection.execute("INSERT INTO catalog_options(kind,name,is_active) VALUES(?,?,TRUE) ON DUPLICATE KEY UPDATE is_active=TRUE",[kind,value]);
    await connection.execute("INSERT INTO admin_audit_logs(admin_user_id,action,entity_type,entity_id,details) VALUES(?,'save','product',?,?)",[adminUserId,String(savedId),JSON.stringify({name:product.name,status:product.status,images:images.length})]);
    await connection.commit();product.id=savedId;return product;
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}

export async function deleteProduct(id:number,adminUserId:string){await ensure();const database=db();if(!database){memory.delete(id);return;}await database.execute("DELETE FROM products WHERE id=?",[id]);await database.execute("INSERT INTO admin_audit_logs(admin_user_id,action,entity_type,entity_id) VALUES(?,'delete','product',?)",[adminUserId,String(id)]);}
export async function bulkUpdateProductStatus(ids:number[],status:CatalogProduct["status"],adminUserId:string){await ensure();const unique=[...new Set(ids)].filter(Number.isInteger);if(!unique.length)return 0;const database=db();if(!database){let changed=0;for(const id of unique){const product=memory.get(id);if(product){product.status=status;changed++;}}return changed;}const placeholders=unique.map(()=>"?").join(",");const[result]=await database.execute<ResultSetHeader>(`UPDATE products SET status=? WHERE id IN (${placeholders})`,[status,...unique]);await database.execute("INSERT INTO admin_audit_logs(admin_user_id,action,entity_type,details) VALUES(?,'bulk_status','product',?)",[adminUserId,JSON.stringify({ids:unique,status})]);return result.affectedRows;}
export async function deleteProducts(ids:number[],adminUserId:string){await ensure();const unique=[...new Set(ids)].filter(Number.isInteger);if(!unique.length)return 0;const database=db();if(!database){let changed=0;for(const id of unique)if(memory.delete(id))changed++;return changed;}const placeholders=unique.map(()=>"?").join(",");const[result]=await database.execute<ResultSetHeader>(`DELETE FROM products WHERE id IN (${placeholders})`,unique);await database.execute("INSERT INTO admin_audit_logs(admin_user_id,action,entity_type,details) VALUES(?,'bulk_delete','product',?)",[adminUserId,JSON.stringify({ids:unique})]);return result.affectedRows;}
export async function adminOverview(){await ensure();const database=db();if(!database)return{products:memory.size,orders:0,pendingOrders:0,revenue:0};const [rows]=await database.query<(RowDataPacket&{products:number;orders:number;pendingOrders:number;revenue:number})[]>("SELECT (SELECT COUNT(*) FROM products) products,(SELECT COUNT(*) FROM orders) orders,(SELECT COUNT(*) FROM orders WHERE status IN ('pending','confirmed','preparing')) pendingOrders,(SELECT COALESCE(SUM(total),0) FROM orders WHERE status<>'cancelled') revenue");return rows[0];}
