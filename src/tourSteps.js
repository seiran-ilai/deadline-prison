// 後台系統教學導覽步驟。文案可再調整；不綁特定 DOM 結構，改版不易壞。
//
// 每步驟 schema：
//   { tab, kind?, anchor?, place?, title, body }
//   - tab：切到該分頁（導覽中所有分頁都以「假資料示範頁」呈現，故未在場也能看）。
//   - kind：'crunch'（集體趕稿）｜'named'（指名互動）｜'free'（自由入場）——
//           只對犯人服刑／獄卒作業有意義，用來就地切換示範，呈現不同情境的介面。
//   - anchor：'tab:<k>' 指向分頁鈕；'region:<id>' 指向頁面主要區塊（帶 data-tour="<id>"）；
//             省略或找不到 → 氣泡置中。
//   - place：'up'|'down'|'left'|'right'|'auto'（預設 auto，依空間自動選側）。

export const INMATE_TOUR = [
  { tab: 'booking', title: '歡迎入獄', body: '這是死線監獄後台。以下用示範資料帶你逐頁認識犯人可用的功能；隨時可按「跳過」，之後也能從右上「犯人導覽」重看。' },
  { tab: 'booking', anchor: 'tab:booking', title: '已預約場次', body: '這裡查看你的報名紀錄與梯次狀態，也可以取消預約。報名新梯次一律從官網進行。' },
  { tab: 'booking', anchor: 'region:booking-list', title: '預排任務', body: '每個已預約的梯次可先「預排任務」，把想推進的稿件掛上；開始服刑時就會直接帶入本場目標。' },
  { tab: 'me', anchor: 'tab:me', title: '我的稿件', body: '在這裡管理你的作業與子項目進度。服刑時獄卒看得到你挑選的本場目標並協助代勾完成。' },
  { tab: 'me', anchor: 'region:ms-list', title: '稿件與子項目', body: '每本稿件可拆子項目逐項勾選，完成度即時反映在進度條；無子項目的稿件可直接整本勾完成。' },
  { tab: 'session', kind: 'crunch', anchor: 'tab:session', title: '犯人服刑', body: '報名場次後就能進到這頁，等待開始服刑時可先挑本場目標。介面依場次類型而不同，接下來依序看三種情境：集體趕稿、指名互動、自由入場。' },
  { tab: 'session', kind: 'crunch', anchor: 'region:sg-top', title: '集體趕稿 · 番茄鐘', body: '集體趕稿場有番茄鐘（專注 25 分 → 放風 5 分為一輪），上排是你的身分卡、專屬獄卒與倒數計時，跟著節奏專注即可。' },
  { tab: 'session', kind: 'crunch', anchor: 'region:sg-goals', title: '本場目標', body: '在這裡挑選本場要推進的稿件並展開子項目勾選；獄卒也看得到並能協助代勾。' },
  { tab: 'session', kind: 'named', anchor: 'region:sg-top', title: '指名互動 · 版面不同', body: '指名互動場沒有番茄鐘、也沒有本場廣播。上排依序是：你的身分卡、指名獄卒（沒指名會顯示「未指名」）、本場預約與購入；接著是本場獄卒與本場目標。' },
  { tab: 'session', kind: 'named', anchor: 'region:sg-booking', title: '本場預約與購入', body: '這一區依獄卒分欄：每位獄卒列出你的預約時段、加購與現場購入，各欄有小計；欄位多的時候可以左右滑動，底部的指名費用／拍立得費用／合計固定不動。' },
  { tab: 'session', kind: 'free', anchor: 'region:sg-top', title: '自由入場 · 個人番茄鐘', body: '自由入場沒有獄卒相關資訊，但你可以自行啟用個人番茄鐘：25／5 標準或自訂時間、自訂輪數（每第 8 輪長休 15 分），支援暫停／重新開始與切換鈴聲，只在你的裝置計時。' },
  { tab: 'session', kind: 'free', anchor: 'region:sg-goals', title: '自由入場也記錄成果', body: '一樣可以挑選本場目標推進稿件；在自由入場完成的稿件，同樣會記錄到「服刑紀錄」。' },
  { tab: 'records', anchor: 'tab:records', title: '服刑紀錄', body: '這裡依場次類型（集體趕稿／指名互動／自由入場）累積你的出席與服刑統計，是你在監獄裡的歷程。' },
  { tab: 'profile', anchor: 'tab:profile', title: '個人資料', body: '這裡可改暱稱與頭像。有問題到官方 Discord 聯繫典獄長即可。' },
]

export const GUARD_TOUR = [
  { tab: 'guardwork', kind: 'crunch', title: '獄卒作業導覽', body: '你是獄方人員，除了犯人功能，還有專屬的看守作業。以下用示範資料帶你逐頁看獄卒這邊；隨時可從右上「獄卒導覽」重看。' },
  { tab: 'guardwork', kind: 'crunch', anchor: 'tab:guardwork', title: '獄卒作業', body: '本場服刑時進到這頁，看守你負責的犯人。介面依場次類型而不同：先看集體趕稿場（自由入場無獄卒作業，不會出現在這頁）。' },
  { tab: 'guardwork', kind: 'crunch', anchor: 'region:gw-switch', title: '切換場次', body: '同時看守多個未結束場次時，從這裡切換；不同類型（集體趕稿／指名互動）介面會跟著切換。' },
  { tab: 'guardwork', kind: 'crunch', anchor: 'region:gw-inmates', title: '本場囚犯', body: '集體趕稿場會列出指派給你的專屬看守犯人（含走查／臨時報名），可展開協助代勾目標；下方是本場其他囚犯。' },
  { tab: 'guardwork', kind: 'crunch', anchor: 'region:gw-worklist', title: '本場工作 + 即時收入', body: '被指名、拍立得、互動探監等指派給你的服務項目都在這裡，做完勾選核對項；下方即時估算收入：各項薪資 + 均分獎金 = 總金額。' },
  { tab: 'guardwork', kind: 'named', anchor: 'region:gw-serve', title: '指名互動 · 我的服務對象', body: '指名互動場的介面不同：改以「我的服務對象」呈現，每位彙整指名時段、購買項目（可勾核對項）與目標稿件，下方同樣即時估算收入。' },
  { tab: 'memos', anchor: 'tab:memos', title: 'MEMO / 確認項', body: '在這裡建立你每場或指定場要確認的事項，服刑時逐項勾選完成。' },
  { tab: 'memos', anchor: 'region:memo-list', title: '每場 / 指定場 MEMO', body: '「每場」會出現在你看守的所有場次；「指定場」只在特定梯次顯示，可指定對象犯人。' },
  { tab: 'guardrecords', anchor: 'tab:guardrecords', title: '看守紀錄', body: '這裡依場次類型累積你的看守場次與服務統計（合照／互動／被指名／拍立得）。' },
]

// 官網「後台系統教學介紹」（犯人視角）—— 對外說明報名到服刑的流程。
// 由 src/site/PrisonSite.jsx 直接以 { n, title, body } 使用，不經 Tour 元件，形狀維持不變。
export const SITE_INMATE_GUIDE = [
  { n: '01', title: '註冊 / 免登入預約', body: '可註冊帳號成為正式犯人，或不登入只填「暱稱 + 伺服器」直接預約。同暱稱+伺服器會累積到同一份犯人資料。' },
  { n: '02', title: '報名梯次', body: '在官網挑選梯次報名；指名互動可選獄卒與時段，集體趕稿可加購拍立得、互動探監等。報名後可到後台「已預約場次」查看紀錄。' },
  { n: '03', title: '準時服刑', body: '到場後跟著番茄鐘節奏（集體場）或本場流程（指名／自由場）專注趕稿，獄卒在場監督與互動。' },
  { n: '04', title: '查看進度與紀錄', body: '「我的稿件」追蹤作業進度，「服刑紀錄」累積你的服刑歷程。' },
]
