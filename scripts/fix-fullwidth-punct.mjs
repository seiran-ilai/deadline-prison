// 把「使用者可見文字」裡緊鄰中文的半形標點轉全形。日期/數字一律保留半形。
// 安全策略:
//  - 簡易 tokenizer 區分 字串('/"/`) / JSX 文字(normal) / 行註解 / 區塊註解。
//  - 只在「非註解」區域,且該半形標點的『前一字或後一字是中文(含全形標點)』時才轉換。
//    -> 程式碼裡的逗號/冒號(物件、陣列、ternary)前後都是 ASCII,不會被動到。
//    -> 數字/日期(6/14、80、12)不在轉換目標,且其旁的標點多為 ASCII 鄰接,不轉。
//  - 註解一律不動。
// 用法: node scripts/fix-fullwidth-punct.mjs            (實際寫入)
//       node scripts/fix-fullwidth-punct.mjs --dry      (只列出統計,不寫入)
import { readFileSync, writeFileSync } from 'node:fs'
import { globSync } from 'node:fs'

const DRY = process.argv.includes('--dry')
const MAP = { ',': '，', ':': '：', ';': '；', '?': '？', '(': '（', ')': '）', '!': '！' }

// 「中文情境」字元:中日韓表意文字、假名、CJK 標點、全形 ASCII/標點。
function isCJK(ch) {
  if (!ch) return false
  const c = ch.codePointAt(0)
  return (c >= 0x2E80 && c <= 0x9FFF) ||   // CJK 部首~統一表意(含擴充A)
         (c >= 0xF900 && c <= 0xFAFF) ||   // 相容表意
         (c >= 0x3000 && c <= 0x303F) ||   // CJK 標點(「」、。·…)
         (c >= 0xFF00 && c <= 0xFFEF)      // 全形 ASCII / 全形標點
}

function transform(src) {
  let out = ''
  let i = 0
  const n = src.length
  let state = 'normal' // normal | line | block | sq | dq | tpl
  let changed = 0
  while (i < n) {
    const ch = src[i]
    const next = src[i + 1]
    if (state === 'normal') {
      if (ch === '/' && next === '/') { state = 'line'; out += ch; i++; continue }
      if (ch === '/' && next === '*') { state = 'block'; out += ch; i++; continue }
      if (ch === "'") { state = 'sq'; out += ch; i++; continue }
      if (ch === '"') { state = 'dq'; out += ch; i++; continue }
      if (ch === '`') { state = 'tpl'; out += ch; i++; continue }
      // JSX 文字也落在 normal:依中文鄰接決定是否轉
      if (MAP[ch] && (isCJK(src[i - 1]) || isCJK(src[i + 1]))) { out += MAP[ch]; changed++; i++; continue }
      out += ch; i++; continue
    }
    if (state === 'line') { out += ch; if (ch === '\n') state = 'normal'; i++; continue }
    if (state === 'block') {
      out += ch
      if (ch === '*' && next === '/') { out += next; i += 2; state = 'normal'; continue }
      i++; continue
    }
    // 字串狀態:sq/dq/tpl
    if (ch === '\\') { out += ch + (next ?? ''); i += 2; continue } // 跳過跳脫字元
    const closing = state === 'sq' ? "'" : state === 'dq' ? '"' : '`'
    if (ch === closing) { state = 'normal'; out += ch; i++; continue }
    if (MAP[ch] && (isCJK(src[i - 1]) || isCJK(src[i + 1]))) { out += MAP[ch]; changed++; i++; continue }
    out += ch; i++; continue
  }
  return { out, changed }
}

const files = globSync('src/**/*.{jsx,js}').filter(f => !f.replaceAll('\\', '/').startsWith('src/site/'))
let totalFiles = 0, totalChanges = 0
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const { out, changed } = transform(src)
  if (changed > 0) {
    totalFiles++; totalChanges += changed
    console.log(`${changed.toString().padStart(4)}  ${f}`)
    if (!DRY) writeFileSync(f, out)
  }
}
console.log(`\n${DRY ? '[DRY] ' : ''}共 ${totalChanges} 處全形轉換,跨 ${totalFiles} 個檔案`)
