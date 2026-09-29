# 燁達機車精品店

Next.js 商店專案，包含商品與後台管理、會員、購物車、訂單、綠界測試金流／物流、DeepL 翻譯及 MySQL 資料儲存。

## 在另一台電腦繼續開發

```bash
git clone https://github.com/sky940714/yehda-moto-demo.git
cd yehda-moto-demo
npm ci
cp .env.example .env.local
npm run dev
```

接著在 `.env.local` 填入實際環境變數。這個檔案包含 API 金鑰與資料庫密碼，因此不會上傳 GitHub，請使用 AirDrop、USB 或密碼管理器另外移轉。

專案需要 Node.js 22.13 以上版本。MySQL 資料庫需先建立 `.env.local` 指定的資料庫；應用程式第一次使用各功能時會建立必要資料表。

## 常用指令

```bash
npm run dev          # 本機開發
npm run build:vercel # 驗證 Vercel 正式建置
npm run lint         # 程式檢查
```

## 不應提交的檔案

- `.env.local` 與任何真正的 API 金鑰、OAuth 密鑰、資料庫密碼
- `node_modules/`
- `.next/`、`dist/`、`.wrangler/` 等可重新產生的建置檔
- `.mysql-local/` 本機資料庫內容；若需要保留資料，請另行建立加密 SQL 備份
