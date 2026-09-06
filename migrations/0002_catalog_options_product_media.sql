CREATE TABLE IF NOT EXISTS products (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sku VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  brand VARCHAR(100) NOT NULL,
  category VARCHAR(100) NOT NULL,
  price INT UNSIGNED NOT NULL DEFAULT 0,
  stock INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('active','draft','out_of_stock') NOT NULL DEFAULT 'draft',
  color VARCHAR(30) NOT NULL DEFAULT 'smoke',
  fitment JSON NOT NULL,
  image_url TEXT NULL,
  description TEXT NOT NULL,
  shipping_type ENUM('small','home','quote') NOT NULL DEFAULT 'small',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX products_status_idx(status),
  INDEX products_category_idx(category)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS catalog_options (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kind ENUM('brand','category','vehicle') NOT NULL,
  name VARCHAR(150) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY catalog_options_kind_name_unique(kind,name),
  INDEX catalog_options_kind_sort_idx(kind,is_active,sort_order)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_images (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  product_id BIGINT UNSIGNED NOT NULL,
  image_url TEXT NOT NULL,
  sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX product_images_product_sort_idx(product_id,sort_order),
  CONSTRAINT product_images_product_fk FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_specifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  product_id BIGINT UNSIGNED NOT NULL,
  spec_name VARCHAR(100) NOT NULL,
  spec_value VARCHAR(150) NOT NULL,
  group_sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
  value_sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
  INDEX product_specs_product_sort_idx(product_id,group_sort_order,value_sort_order),
  CONSTRAINT product_specs_product_fk FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO catalog_options(kind,name) SELECT 'brand',brand FROM products WHERE brand<>'';
INSERT IGNORE INTO catalog_options(kind,name) SELECT 'category',category FROM products WHERE category<>'';
INSERT INTO product_images(product_id,image_url,sort_order)
SELECT p.id,p.image_url,0 FROM products p
WHERE p.image_url IS NOT NULL AND p.image_url<>''
AND NOT EXISTS(SELECT 1 FROM product_images pi WHERE pi.product_id=p.id);
