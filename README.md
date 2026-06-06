# 死線監獄 ｜ DEADLINE PRISON

一間以「番茄鐘」執行的趕稿收容所。入監即上鎖,鈴響才放風,全程同步直播犯人服刑進度——你不是一個人在趕,是一群人一起服刑。

以 React + Vite 打造,登入採 Discord OAuth(透過 Supabase Auth),場次/名單/目標資料存於 Supabase。

## 開發

```bash
npm install
npm run dev      # 本機開發
npm run build    # 產出 production build
npm run preview  # 預覽 production build
npm run lint     # ESLint
```

## 環境變數

於本機 `.env`(以及 Vercel 專案設定)提供:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

`api/booking.js` 亦支援不帶前綴的 `SUPABASE_URL` / `SUPABASE_ANON_KEY`。

> OAuth 回呼採動態 `window.location`,不寫死網域;更換網域時只需在 Supabase Auth 與 Discord Developer Portal 的 Redirect 清單加入新網域。
