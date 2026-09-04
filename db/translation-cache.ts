import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";

const memoryCache = new Map<string, string>();
let pool: Pool | null | undefined;
let schemaReady: Promise<void> | undefined;

function database() {
  if (pool !== undefined) return pool;
  if (!process.env.MYSQL_HOST) return (pool = null);
  pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    connectionLimit: 5,
    charset: "utf8mb4",
  });
  return pool;
}

async function cacheKey(source: string, targetLanguage: string) {
  const bytes = new TextEncoder().encode(`${targetLanguage}\0${source}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function ensureSchema(db: Pool) {
  schemaReady ??= (async () => {
    await db.execute(`CREATE TABLE IF NOT EXISTS translation_cache (
      cache_key CHAR(64) PRIMARY KEY, source_text TEXT NOT NULL,
      target_language VARCHAR(16) NOT NULL, translated_text TEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX translation_cache_updated_at_idx (updated_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await db.execute(`CREATE TABLE IF NOT EXISTS translation_usage (
      billing_period CHAR(7) PRIMARY KEY, reserved_characters INT UNSIGNED NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  })();
  await schemaReady;
}

export async function readTranslations(texts: string[], targetLanguage: string) {
  const db = database();
  const found = new Map<string, string>();
  const keyed = await Promise.all(texts.map(async (source) => ({ source, key: await cacheKey(source, targetLanguage) })));
  if (db && keyed.length) {
    await ensureSchema(db);
    const placeholders = keyed.map(() => "?").join(", ");
    const [rows] = await db.query<(RowDataPacket & { cache_key: string; translated_text: string })[]>(
      `SELECT cache_key, translated_text FROM translation_cache WHERE cache_key IN (${placeholders})`,
      keyed.map(({ key }) => key),
    );
    const byKey = new Map(rows.map((row) => [row.cache_key, row.translated_text]));
    keyed.forEach(({ source, key }) => {
      const translated = byKey.get(key);
      if (translated !== undefined) found.set(source, translated);
    });
    return found;
  }
  keyed.forEach(({ source, key }) => {
    const cached = memoryCache.get(key);
    if (cached !== undefined) found.set(source, cached);
  });
  return found;
}

export async function writeTranslations(entries: Array<[string, string]>, targetLanguage: string) {
  const db = database();
  const keyed = await Promise.all(entries.map(async ([source, translated]) => ({ source, translated, key: await cacheKey(source, targetLanguage) })));
  if (!db) {
    keyed.forEach(({ key, translated }) => memoryCache.set(key, translated));
    return;
  }
  await ensureSchema(db);
  await Promise.all(keyed.map(({ key, source, translated }) => db.execute(
    `INSERT INTO translation_cache (cache_key, source_text, target_language, translated_text)
     VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE translated_text = VALUES(translated_text), updated_at = CURRENT_TIMESTAMP`,
    [key, source, targetLanguage, translated],
  )));
}

export async function reserveMonthlyCharacters(characters: number, limit: number) {
  const db = database();
  if (!db) return true;
  await ensureSchema(db);
  const period = new Date().toISOString().slice(0, 7);
  await db.execute(
    "INSERT IGNORE INTO translation_usage (billing_period, reserved_characters) VALUES (?, 0)",
    [period],
  );
  const [result] = await db.execute(
    `UPDATE translation_usage SET reserved_characters = reserved_characters + ?
     WHERE billing_period = ? AND reserved_characters + ? <= ?`,
    [characters, period, characters, limit],
  );
  const affected = (result as { affectedRows?: number }).affectedRows ?? 0;
  return affected > 0;
}

export async function releaseMonthlyCharacters(characters: number) {
  const db = database();
  if (!db) return;
  const period = new Date().toISOString().slice(0, 7);
  await db.execute(
    "UPDATE translation_usage SET reserved_characters = GREATEST(0, reserved_characters - ?) WHERE billing_period = ?",
    [characters, period],
  );
}
