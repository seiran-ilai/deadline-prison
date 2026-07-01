// 預約播報字串:把一筆預約資料組成固定格式純文字通知,供 Discord 播報。
// 純文字,不使用 emoji、不使用破折號。分隔符固定:「｜」分欄位、「·」串次要資訊、「x」表數量。
// 底線開頭目錄不會被 Vercel 建成 function,僅供 /api/booking* import。

export const KIND_LABEL = { crunch: '集體趕稿', named: '指名互動', free: '自由入場' }

// 單一純函式:輸入一筆預約,輸出多行字串。
//   action        動作:新報名 / 取消 / 異動
//   kind          場次類型:free / named / crunch
//   sessionTitle  場次名稱
//   date          'YYYY-MM-DD' | null
//   isMember      true=會員(帶收監編號、無伺服器)/ false=訪客(名稱為「暱稱@伺服器」)
//   name          訪客:暱稱@伺服器;會員:名稱(皆來自預約人既有暱稱/伺服器欄位)
//   inmateNo      會員收監編號(number)
//   slots         指名/監督:[{ guardName, time }];time='HH:MM'(指名互動時段)或 null(集體場指定監督)
//   addons        每卒加購:[{ guardName, polaroid, sign, portrait }]
//   captureTarget 監獄外抓捕目標暱稱(僅集體場,不指定獄卒)| null
//   count         目前人數 N
//   capacity      集體場人數上限(顯示 N/上限)| null
// 指名時段依獄卒分組每組一行;加購依 (品項, 對象獄卒, 空白/簽繪) 分組每組一行;抓捕固定只輸出目標暱稱。
export function formatReservationBroadcast(reservation = {}) {
  const {
    action = '新報名', kind = 'free', sessionTitle = '', date = null,
    isMember = false, name = '', inmateNo = null,
    slots = [], addons = [], captureTarget = null,
    count = null, capacity = null,
  } = reservation
  const lines = []

  // 第 1 行:動作 + 場次類型
  lines.push(`${action} ${KIND_LABEL[kind] || KIND_LABEL.free}`)

  // 第 2 行:身分(訪客=暱稱@伺服器;會員=名稱 · No.編號)
  lines.push(isMember
    ? `會員｜${name} · No.${String(inmateNo ?? '').padStart(4, '0')}`
    : `訪客｜${name}`)

  // 第 3 行:場次
  if (sessionTitle) lines.push(`場次｜${sessionTitle}`)

  // 指名行(僅指名互動,每位獄卒一行;同一獄卒多時段串同一行)
  const namedSlots = slots.filter(s => s && s.time)
  if (kind === 'named' && namedSlots.length) {
    const byGuard = new Map()
    for (const s of namedSlots) {
      if (!byGuard.has(s.guardName)) byGuard.set(s.guardName, [])
      byGuard.get(s.guardName).push(s.time)
    }
    for (const [guardName, times] of byGuard) lines.push(`指名｜${guardName} · 時段 ${times.join(' · ')}`)
  }

  // 加購行(有才輸出,每種組合一行)
  // 拍立得:每位獄卒一行,x數量(空白 或 簽繪);空白與簽繪、不同對象獄卒皆分開行
  for (const a of addons) {
    if (a && a.polaroid > 0) lines.push(`加購｜拍立得 x${a.polaroid}（${a.sign ? '簽繪' : '空白'}）· 對象 ${a.guardName}`)
  }
  // 指定監督(集體場):slots 內無時段者
  if (kind === 'crunch') {
    for (const s of slots.filter(s => s && !s.time)) lines.push(`加購｜指定監督 · 監督 ${s.guardName}`)
  }
  // 肖像畫:每位獄卒一行
  for (const a of addons) {
    if (a && a.portrait > 0) lines.push(`加購｜肖像畫 x${a.portrait} · 負責 ${a.guardName}`)
  }
  // 監獄外抓捕(僅集體場,不指定獄卒,只輸出目標暱稱)
  if (kind === 'crunch' && captureTarget) lines.push(`加購｜監獄外抓捕 · 目標 ${captureTarget}`)

  // 末行:日期與狀態
  const d = date || '未定'
  if (kind === 'named') {
    lines.push(`日期｜${d} · 共 ${namedSlots.length} 段`)   // N = 所有指名時段總數
  } else if (kind === 'crunch') {
    lines.push(`日期｜${d} · 目前 ${count ?? 0}/${capacity != null ? capacity : 5}`)
  } else {
    lines.push(`日期｜${d} · 目前 ${count ?? 0} 人`)
  }

  return lines.join('\n')
}

// 關聯資料以「分開查詢再於 JS 合併」取得:獄卒名 / 時段 label 由 session_named_slots(SECURITY DEFINER)解析。
// 組成 formatReservationBroadcast 的輸入並送出 Discord webhook;失敗不擋預約。
export async function sendReservationBroadcast(supabase, {
  webhook, sess, picks = [], addons = [], captureTarget = null,
  isMember, name, inmateNo = null, count = null, action = '新報名',
}) {
  if (!webhook) return
  const nameable = sess.kind === 'named' || sess.kind === 'crunch'

  // 分開查詢:獄卒名 + 時段 label(picks / addons 參照的獄卒皆在本場可指名清單內)
  const nameMap = new Map(), labelMap = new Map()
  if (nameable && (picks.length || addons.length)) {
    const { data: ns } = await supabase.rpc('session_named_slots', { p_session: sess.id })
    for (const row of ns || []) {
      nameMap.set(row.guard_id, row.game_name || row.display_name || '獄卒')
      if (row.slot_index != null) labelMap.set(`${row.guard_id}|${row.slot_index}`, row.slot_label)
    }
  }
  const gName = g => nameMap.get(g) || '獄卒'
  const slots = picks.map(p => ({
    guardName: gName(p.g),
    time: p.s == null ? null : (labelMap.get(`${p.g}|${p.s}`) || null),
  }))
  const addonList = addons.map(a => ({ guardName: gName(a.g), polaroid: a.polaroid, sign: a.sign, portrait: a.portrait }))

  const content = formatReservationBroadcast({
    action, kind: sess.kind, sessionTitle: sess.title, date: sess.session_date,
    isMember, name, inmateNo,
    slots, addons: addonList, captureTarget,
    count, capacity: sess.capacity,
  })
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
  } catch { /* 通知失敗不影響預約 */ }
}
