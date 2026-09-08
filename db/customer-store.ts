import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { listProducts } from "./catalog";

export type SavedCartItem = { productId: number; variantId?: number; options: Record<string, string>; quantity: number };
export type CustomerStore = { favorites: number[]; cart: SavedCartItem[] };

let pool: Pool | null | undefined;
let ready: Promise<void> | undefined;
const memory = new Map<string, CustomerStore>();

function database() {
  if (pool !== undefined) return pool;
  if (!process.env.MYSQL_HOST) return (pool = null);
  return (pool = mysql.createPool({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE, connectionLimit: 5, charset: "utf8mb4" }));
}

async function ensure() {
  ready ??= (async () => {
    const db = database();
    if (!db) return;
    await listProducts(true);
    await db.execute(`CREATE TABLE IF NOT EXISTS user_favorites (
      user_id CHAR(36) NOT NULL, product_id BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, product_id), INDEX user_favorites_product_idx(product_id),
      CONSTRAINT user_favorites_user_fk FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT user_favorites_product_fk FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await db.execute(`CREATE TABLE IF NOT EXISTS user_cart_items (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id CHAR(36) NOT NULL,
      product_id BIGINT UNSIGNED NOT NULL, variant_id BIGINT UNSIGNED NULL,
      option_values JSON NOT NULL, quantity SMALLINT UNSIGNED NOT NULL DEFAULT 1,
      item_key CHAR(64) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY user_cart_item_unique(user_id, item_key), INDEX user_cart_user_idx(user_id),
      CONSTRAINT user_cart_user_fk FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT user_cart_product_fk FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE,
      CONSTRAINT user_cart_variant_fk FOREIGN KEY(variant_id) REFERENCES product_variants(id) ON DELETE SET NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  })();
  await ready;
}

function cleanOptions(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key.trim().slice(0, 100), String(item).trim().slice(0, 150)]).filter(([key, item]) => key && item));
}

export function cleanStore(input: Partial<CustomerStore>): CustomerStore {
  const favorites = [...new Set(Array.isArray(input.favorites) ? input.favorites.map(Number).filter((id) => Number.isInteger(id) && id > 0).slice(0, 500) : [])];
  const grouped = new Map<string, SavedCartItem>();
  for (const item of Array.isArray(input.cart) ? input.cart : []) {
    const source = item as Partial<SavedCartItem>, productId = Number(source.productId), variantId = Number(source.variantId) || undefined, options = cleanOptions(source.options);
    if (!Number.isInteger(productId) || productId < 1) continue;
    const key = `${productId}:${variantId || 0}:${JSON.stringify(options)}`, current = grouped.get(key);
    const quantity = Math.max(1, Math.min(99, Number(source.quantity) || 1));
    grouped.set(key, { productId, variantId, options, quantity: Math.min(99, (current?.quantity || 0) + quantity) });
    if (grouped.size >= 100) break;
  }
  return { favorites, cart: [...grouped.values()] };
}

export async function readCustomerStore(userId: string): Promise<CustomerStore> {
  await ensure(); const db = database();
  if (!db) return memory.get(userId) || { favorites: [], cart: [] };
  const [favoriteRows, cartRows] = await Promise.all([
    db.query<(RowDataPacket & { product_id: number })[]>("SELECT product_id FROM user_favorites WHERE user_id=? ORDER BY created_at DESC", [userId]).then(([rows]) => rows),
    db.query<(RowDataPacket & { product_id: number; variant_id: number | null; option_values: unknown; quantity: number })[]>("SELECT product_id,variant_id,option_values,quantity FROM user_cart_items WHERE user_id=? ORDER BY updated_at DESC,id DESC", [userId]).then(([rows]) => rows),
  ]);
  return cleanStore({ favorites: favoriteRows.map((row) => Number(row.product_id)), cart: cartRows.map((row) => ({ productId: Number(row.product_id), variantId: row.variant_id ? Number(row.variant_id) : undefined, options: typeof row.option_values === "string" ? JSON.parse(row.option_values) : row.option_values as Record<string, string>, quantity: Number(row.quantity) })) });
}

export async function saveCustomerStore(userId: string, input: Partial<CustomerStore>) {
  const store = cleanStore(input); await ensure(); const db = database();
  if (!db) { memory.set(userId, store); return store; }
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("DELETE FROM user_favorites WHERE user_id=?", [userId]);
    for (const productId of store.favorites) await connection.execute("INSERT INTO user_favorites(user_id,product_id) SELECT ?,id FROM products WHERE id=?", [userId, productId]);
    await connection.execute("DELETE FROM user_cart_items WHERE user_id=?", [userId]);
    for (const item of store.cart) {
      const key = `${item.productId}:${item.variantId || 0}:${JSON.stringify(item.options)}`;
      await connection.execute("INSERT INTO user_cart_items(user_id,product_id,variant_id,option_values,quantity,item_key) SELECT ?,p.id,CASE WHEN v.id IS NULL THEN NULL ELSE v.id END,?,?,? FROM products p LEFT JOIN product_variants v ON v.id=? AND v.product_id=p.id WHERE p.id=?", [userId, JSON.stringify(item.options), item.quantity, key, item.variantId || 0, item.productId]);
    }
    await connection.commit(); return readCustomerStore(userId);
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
