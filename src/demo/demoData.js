// 導覽示範用假資料。全靜態、不連 Supabase、不寫入;金額/日期寫死,不用亂數與時鐘。
// 對照各正式頁面的資料形狀(但只保留「講解各功能」所需的代表性內容)。

// ---- 身分 ----
export const DEMO_INMATE = { inmate_no: 1, game_name: '示範犯人', display_name: '示範犯人', avatar_url: null, role: 'member' }
export const DEMO_GUARD_SELF = { inmate_no: null, game_name: '示範獄卒', display_name: '示範獄卒', avatar_url: null, role: 'guard' }

// ---- 犯人 · 本場目標(含子項目;用 computeProgress 算進度)----
export const DEMO_GOALS = [
  { id: 'g1', priority: 1, title: '第一章 · 開場', is_done: false,
    steps: [
      { id: 's1', title: '故事大綱', done: true },
      { id: 's2', title: '初稿 3000 字', done: true },
      { id: 's3', title: '潤稿與校對', done: false },
    ] },
  { id: 'g2', priority: 2, title: '封面 · 線稿', is_done: false, steps: [] },
]

// ---- 犯人 · 指名互動:本場預約與購入(依獄卒分欄;底部彙總 指名費用/拍立得費用/合計) ----
export const DEMO_NAMED_PURCHASE = {
  groups: [
    { guard: '示範獄卒', lines: [
      { tag: '預約', desc: '預約時段 21:00、21:30', amt: 30 },
      { tag: '購入', desc: '拍立得（含簽繪） x2', amt: 16 },
    ], subtotal: 46 },
    { guard: '值班典獄長', lines: [
      { tag: '購入', desc: '拍立得（空白） x1', amt: 5 },
    ], subtotal: 5 },
  ],
  nominate: 30, polaroid: 21, total: 51,
}
// 指名互動:我指名的獄卒(獄卒欄位卡)
export const DEMO_NOMINATED_GUARD = { inmate_no: null, game_name: '示範獄卒', display_name: '示範獄卒', avatar_url: null, role: 'guard' }

// ---- 本場廣播(探望)----
export const DEMO_VISITS = [
  { id: 'v1', visitor_name: '路人甲', message: '加油！等你完稿', guard_name: '示範獄卒' },
  { id: 'v2', visitor_name: '編輯大人', message: '這章節奏很好，繼續', guard_name: null },
]

// ---- 本場獄卒(頭貼格)----
export const DEMO_SESSION_GUARDS = [
  { id: 'sg1', name: '示範獄卒', role: 'guard', me: true },
  { id: 'sg2', name: '值班典獄長', role: 'warden', me: false },
]

// ---- 獄卒 · 集體趕稿:本場囚犯 ----
export const DEMO_MY_INMATES = [
  { id: 'mi1', name: '阿寫', no: 2, status: '服刑中', goals: DEMO_GOALS },
  { id: 'mi2', name: '小畫', no: 3, status: '服刑完畢',
    goals: [{ id: 'g3', title: '短篇 · 完結', is_done: true, steps: [{ id: 's4', title: '全文', done: true }] }] },
]
export const DEMO_WARD_BOOKINGS = [{ booking_id: 'wb1', game_name: '臨時報名 · 訪客' }]
export const DEMO_OTHER_INMATES = [
  { id: 'oi1', name: '大摸魚', no: 4, status: '尚未挑稿' },
  { id: 'oi2', name: '趕稿仙人', no: 5, status: '服刑中' },
]

// ---- 獄卒 · 集體趕稿:本場工作(wk-item)----
export const DEMO_WORKLIST = [
  { id: 'w1', type: 'polaroid', tlabel: '拍立得', tcls: 'pol', who: '阿寫', amount: 6, detail: '2 張 · 含簽繪',
    chks: [{ f: 'polaroid', lbl: '拍立得' }] },
  { id: 'w2', type: 'visit', tlabel: '互動探監', tcls: 'vis', who: '編輯大人 → 小畫', amount: 5, detail: '',
    chks: [{ f: 'interact', lbl: '互動' }, { f: 'photo', lbl: '合照' }] },
  { id: 'w3', type: 'signup', tlabel: '指定監督', tcls: 'sup', who: '大摸魚', amount: 3, detail: '',
    chks: [{ f: 'interact', lbl: '互動' }] },
]

// ---- 獄卒 · 指名互動:我的服務對象(serve-card)----
export const DEMO_SERVE_TARGETS = [
  { name: '阿寫', no: 2, status: '服刑中',
    slots: ['21:00', '22:00'],
    buys: [
      { name: '指名時段 2 段（20 萬）', chks: [{ f: 'interact', lbl: '互動' }] },
      { name: '拍立得 2 張（6 萬）', chks: [{ f: 'polaroid', lbl: '拍立得' }] },
    ],
    goals: DEMO_GOALS },
  { name: '小畫', no: 3, status: '服刑完畢', slots: ['21:30'],
    buys: [{ name: '互動探監（5 萬）', chks: [{ f: 'interact', lbl: '互動' }, { f: 'photo', lbl: '合照' }] }],
    goals: [] },
]

// ---- 獄卒 · 即時收入(估算)----
export const DEMO_INCOME_CRUNCH = {
  segments: [{ title: '拍立得', amount: '6 萬' }, { title: '互動探監', amount: '5 萬' }, { title: '指定監督', amount: '3 萬' }],
  direct: '14 萬', pool: '2.5 萬', final: '16.5 萬',
}
export const DEMO_INCOME_NAMED = {
  segments: [{ title: '指名時段', note: '2 段', amount: '20 萬' }, { title: '拍立得', amount: '6 萬' }, { title: '互動探監', amount: '5 萬' }],
  direct: '31 萬', pool: '3 萬', final: '34 萬',
}

// ---- MEMO / 確認項 ----
export const DEMO_MEMOS_EVERY = [
  { id: 'm1', scope: 'every', content: '服刑開始前先確認犯人麥克風/畫面正常', target: null },
  { id: 'm2', scope: 'every', content: '每輪放風提醒犯人回報進度', target: null },
]
export const DEMO_MEMOS_SESSION = [
  { id: 'm3', scope: 'session', content: '本場結束前收齊拍立得檔案', target: '阿寫' },
]
export const DEMO_SESSION_MEMO_TITLE = '週末衝刺場'

// 本場 MEMO(服刑中逐項勾選;done 為示範預設)
export const DEMO_SESSION_MEMOS = [
  { id: 'sm1', scope: 'every', content: '確認犯人麥克風/畫面正常', target: null, done: true },
  { id: 'sm2', scope: 'every', content: '每輪放風提醒回報進度', target: null, done: false },
  { id: 'sm3', scope: 'session', content: '收齊拍立得檔案', target: '阿寫', done: false },
]

// ---- 已預約場次 ----
export const DEMO_BOOKINGS = [
  { id: 'b1', title: '週末衝刺場', status: 'booking', date: '2026-07-05', kind: 'crunch', goals: ['第一章 · 開場', '封面 · 線稿'] },
  { id: 'b2', title: '指名互動夜', status: 'serving', date: '2026-07-06', kind: 'named', goals: [] },
]

// ---- 我的稿件 ----
export const DEMO_MANUSCRIPTS = [
  { id: 'ms1', priority: 1, title: '長篇連載 · 第一章', due_date: '2026-07-10',
    steps: [{ id: 't1', title: '大綱', done: true }, { id: 't2', title: '初稿', done: true }, { id: 't3', title: '潤稿', done: false }], is_done: false },
  { id: 'ms2', priority: 2, title: '封面 · 線稿', due_date: '', steps: [], is_done: false },
  { id: 'ms3', priority: 3, title: '短篇 · 完結', due_date: '', steps: [], is_done: true },
]

// ---- 服刑紀錄(犯人)----
export const DEMO_RECORDS = [
  { key: 'r1', kind: 'crunch', title: '上週衝刺場', date: '2026-06-28', rounds: 4, ended: true,
    guards: ['示範獄卒'], goals: ['第三章 · 高潮'], visits: [{ id: 'rv1', visitor: '路人甲', message: '好看！', guard: '示範獄卒' }] },
  { key: 'r2', kind: 'named', title: '指名互動夜', date: '2026-06-21', rounds: 4, ended: true,
    guards: [], goals: ['番外 · 小劇場'],
    items: [{ name: '指名時段 2 段', guard: '示範獄卒', amount: 20 }, { name: '拍立得 3 張', guard: '示範獄卒', amount: 9 }] },
]
export const DEMO_RECORD_STATS = {
  crunch: { count: 6, rounds: 24, visits: 8 },
  named: { count: 3, rounds: 12, visits: 0 },
  free: { count: 1, rounds: 4, visits: 0 },
}

// ---- 看守紀錄(獄卒)----
export const DEMO_GUARD_RECORDS = [
  { key: 'gr1', kind: 'crunch', title: '上週衝刺場', date: '2026-06-28', rounds: 4, ended: true,
    guarded: ['阿寫', '小畫'], photoCount: 2, interactCount: 3 },
  { key: 'gr2', kind: 'named', title: '指名互動夜', date: '2026-06-21', rounds: 4, ended: true,
    guarded: ['阿寫'], nominateCount: 4, polaroidCount: 5 },
]
export const DEMO_GUARD_RECORD_STATS = {
  crunch: { count: 5, photo: 9, interact: 14 },
  named: { count: 3, nominate: 11, polaroid: 18 },
}

// ---- 個人資料(靜態)----
export const DEMO_PROFILE_FORM = { game_name: '示範犯人', bio: '一句自我介紹，顯示在這裡。' }
