export const createTranslationCacheTable = `
CREATE TABLE IF NOT EXISTS translation_cache (
  cache_key TEXT PRIMARY KEY,
  source_text TEXT NOT NULL,
  target_language TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

export const createTranslationUsageTable = `
CREATE TABLE IF NOT EXISTS translation_usage (
  billing_period TEXT PRIMARY KEY,
  reserved_characters INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

export const createTranslationCacheUpdatedIndex = `
CREATE INDEX IF NOT EXISTS idx_translation_cache_updated_at
ON translation_cache(updated_at)`;
