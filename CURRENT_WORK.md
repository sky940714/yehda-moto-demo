# 目前開發進度（2026-10-06）

這份文件提供給新的 Codex 聊天室接續工作。開始前先閱讀本文件、`README.md` 與 `AGENTS.md`，並先檢查 Git、Docker 與環境變數狀態。不要把任何 `.env`、資料庫備份或金鑰提交到 GitHub。

## 目前正在做的事情

建立與驗證隔離的測試網站 `https://staging.yada.motorcycles`，用綠界 Stage 環境完成信用卡結帳測試，再確認測試站後台能正確收到訂單、付款狀態、庫存及會員點數異動。

## 已完成

- 正式網站使用 `https://yada.motorcycles`，並保留正式資料庫與私密環境設定。
- 建立獨立的 staging App、MySQL 資料庫及 Caddy 反向代理設定。
- staging 使用獨立資料庫，只同步商品目錄，不複製正式會員與訂單。
- staging 網頁有 Basic Auth 與禁止搜尋引擎收錄設定；綠界回呼路徑不受 Basic Auth 阻擋，但仍由程式驗證 CheckMacValue。
- `staging.yada.motorcycles` DNS 已指向 `202.182.105.222`；公開 DNS 已可解析。
- 綠界 staging 金流使用測試環境，不會對正式信用卡扣款。
- 修正結帳頁面在會員資料非同步載入後，沒有帶入姓名、Email、手機與地址的問題；顧客手動修改過的欄位不會被覆蓋。
- Google OAuth 正式站已可使用；測試站需在 Google Cloud Console 保留 staging origin 與 callback URI。
- 正式站與測試站共用程式碼，但資料庫及付款環境彼此隔離。

## 接下來的測試順序

1. 確認 staging 首頁可登入與顯示商品。
2. 驗證 staging Google 登入與會員資料帶入結帳頁。
3. 加入商品、選擇配送方式並建立測試訂單。
4. 進入綠界 Stage 信用卡頁，使用綠界官方測試卡完成付款。
5. 確認綠界付款回呼成功，前台顯示正確付款結果。
6. 確認 staging 後台收到訂單，並核對付款狀態、庫存及會員點數。
7. 測試付款失敗、取消、重複回呼與重新整理等例外情況。

## 已知限制與注意事項

- staging 目前重點是金流測試；若未另外設定綠界 Stage 物流金鑰，超商地圖與物流建立不能視為完整測試。
- staging 不應使用正式 R2 或正式顧客資料；後台圖片上傳可能因此不可用。
- 本機 `.local-backups/` 及 `.env.local` 不屬於 GitHub 內容，禁止提交。
- 正式資料庫、本機資料庫與 staging 資料庫是三套不同資料，不會自動互相覆蓋。
- 部署前必須先執行 `npm run lint` 與 `npm run build:vercel`。

## 新聊天室接續提示

可直接對新的 Codex 聊天室說：

> 請先閱讀 `CURRENT_WORK.md`、`README.md` 與 `AGENTS.md`，檢查 Git 與目前環境狀態，接續完成 staging 的綠界信用卡完整測試。請勿覆寫正式資料庫、正式私密設定或提交任何金鑰。
