import { useState, useEffect, useRef } from 'react'
import { PHASE_LABEL, fmt } from './pomodoro'

// 自由入場:個人番茄鐘(純本人裝置,不寫 DB、不與他人同步)。
// 節奏同全場番茄鐘:專注 → 放風,每第 8 輪後長休 15 分;可 25/5 預設或自訂分鐘數。
// 支援 暫停 / 繼續 / 重新開始 / 停止,與可開關的階段切換鈴聲。設定記在 localStorage。

const LS_KEY = 'dp_personal_pomodoro'
const PHASE_BADGE = {
  focus: { bg: 'rgba(245,197,24,.16)', color: 'var(--hazard)' },
  break: { bg: 'rgba(63,179,107,.16)', color: 'var(--ok)' },
  longbreak: { bg: 'rgba(58,123,208,.18)', color: '#7fb0ea' },
}
const DEFAULT_SETTINGS = { focusMin: 25, breakMin: 5, longMin: 15, rounds: 4, bell: true, custom: false }

// 與 pomodoroState 同節奏,但分鐘數可自訂(自訂模式仍每第 8 輪後長休)
function phaseAt(elapsedSeconds, { focusMin, breakMin, longMin, rounds }) {
  const F = Math.max(1, focusMin) * 60, B = Math.max(1, breakMin) * 60, L = Math.max(1, longMin) * 60
  const N = Math.max(1, rounds)
  let t = Math.max(0, Math.floor(elapsedSeconds))
  for (let i = 1; i <= N; i++) {
    if (t < F) return { phase: 'focus', round: i, remainingSeconds: F - t, ended: false }
    t -= F
    if (i === N) break
    const isLong = i % 8 === 0
    const dur = isLong ? L : B
    if (t < dur) return { phase: isLong ? 'longbreak' : 'break', round: i, remainingSeconds: dur - t, ended: false }
    t -= dur
  }
  return { phase: 'ended', round: N, remainingSeconds: 0, ended: true }
}

function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(LS_KEY) || '{}') } }
  catch { return { ...DEFAULT_SETTINGS } }
}

export default function PersonalPomodoro({ title }) {
  const [cfg, setCfg] = useState(loadSettings)
  // run: null=未開始;{ startAt, pausedAcc, pausedAt } —— elapsed = pausedAcc + (pausedAt ? 0 : now-startAt)
  const [run, setRun] = useState(null)
  const [, setTick] = useState(0)
  const audioRef = useRef(null)
  const prevKey = useRef(null)

  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)) } catch { /* 忽略 */ } }, [cfg])

  // 每秒重繪(僅計時中)
  useEffect(() => {
    if (!run || run.pausedAt) return
    const t = setInterval(() => setTick(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [run])

  const elapsed = run ? run.pausedAcc + (run.pausedAt ? 0 : Math.floor((Date.now() - run.startAt) / 1000)) : 0
  const st = run ? phaseAt(elapsed, cfg) : null

  // 鈴聲:階段/輪次一變就響(開始計時即為使用者手勢,已可自動播放)
  const bellKey = st && !st.ended ? `${st.phase}-${st.round}` : st?.ended ? 'ended' : null
  useEffect(() => {
    if (!run) { prevKey.current = null; return }
    if (cfg.bell && bellKey != null && prevKey.current != null && prevKey.current !== bellKey) {
      const a = audioRef.current
      if (a) { try { a.currentTime = 0; a.play() } catch { /* 播放失敗忽略 */ } }
    }
    prevKey.current = bellKey
  }, [bellKey, run, cfg.bell])

  function start() {
    // 在使用者手勢內先解鎖音訊(靜音播一次),之後階段切換才能自動響
    if (!audioRef.current) { audioRef.current = new Audio('/bell.mp3'); audioRef.current.preload = 'auto' }
    if (cfg.bell) { try { const a = audioRef.current; a.muted = true; a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false }).catch(() => { a.muted = false }) } catch { /* 忽略 */ } }
    prevKey.current = 'focus-1'
    setRun({ startAt: Date.now(), pausedAcc: 0, pausedAt: null })
  }
  const pause = () => setRun(r => r && !r.pausedAt ? { ...r, pausedAcc: r.pausedAcc + Math.floor((Date.now() - r.startAt) / 1000), pausedAt: Date.now() } : r)
  const resume = () => setRun(r => r && r.pausedAt ? { ...r, startAt: Date.now(), pausedAt: null } : r)
  const restart = () => { prevKey.current = 'focus-1'; setRun({ startAt: Date.now(), pausedAcc: 0, pausedAt: null }) }
  const stop = () => setRun(null)

  const setNum = (key, v, min, max) => {
    const n = parseInt(v)
    setCfg(c => ({ ...c, [key]: Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : c[key] }))
  }

  // ---- 未開始:設定畫面 ----
  if (!run) return (
    <div className="ses-timer waiting pp-setup">
      <div className="st-big">個人番茄鐘</div>
      {title && <div className="st-sub">{title}</div>}
      <div className="pp-modes">
        <button type="button" className={`pp-mode${!cfg.custom ? ' on' : ''}`} onClick={() => setCfg(c => ({ ...c, custom: false, focusMin: 25, breakMin: 5, longMin: 15 }))}>25 / 5 標準</button>
        <button type="button" className={`pp-mode${cfg.custom ? ' on' : ''}`} onClick={() => setCfg(c => ({ ...c, custom: true }))}>自訂時間</button>
      </div>
      {cfg.custom && (
        <div className="pp-fields">
          <label>專注<input type="number" min="1" max="180" value={cfg.focusMin} onChange={e => setNum('focusMin', e.target.value, 1, 180)} />分</label>
          <label>放風<input type="number" min="1" max="60" value={cfg.breakMin} onChange={e => setNum('breakMin', e.target.value, 1, 60)} />分</label>
          <label>長休<input type="number" min="1" max="120" value={cfg.longMin} onChange={e => setNum('longMin', e.target.value, 1, 120)} />分</label>
        </div>
      )}
      <div className="pp-fields">
        <label>輪數<input type="number" min="1" max="48" value={cfg.rounds} onChange={e => setNum('rounds', e.target.value, 1, 48)} />輪</label>
        <label className="pp-bell"><input type="checkbox" checked={cfg.bell} onChange={e => setCfg(c => ({ ...c, bell: e.target.checked }))} />切換鈴聲</label>
      </div>
      <div className="pp-hint">每第 8 輪後長休 {cfg.longMin} 分鐘；僅在你的裝置計時，不與他人同步。</div>
      <button type="button" className="btn-pri pp-start" onClick={start}>▶ 開始番茄鐘</button>
    </div>
  )

  // ---- 結束 ----
  if (st.ended) return (
    <div className="ses-timer waiting pp-setup">
      <div className="st-big">🔓 番茄鐘完成</div>
      <div className="st-sub">共 {cfg.rounds} 輪 已全部完成</div>
      <div className="pp-ctrl">
        <button type="button" className="btn-sm" onClick={restart}>重新開始</button>
        <button type="button" className="btn-sm" onClick={stop}>回到設定</button>
      </div>
    </div>
  )

  // ---- 計時中 / 暫停 ----
  const badge = PHASE_BADGE[st.phase] ?? PHASE_BADGE.focus
  const paused = !!run.pausedAt
  return (
    <div className={`ses-timer${st.phase === 'focus' && !paused ? ' focus' : ''}`}>
      <div className="st-phase">
        <span className="st-badge" style={{ background: badge.bg, color: badge.color }}>
          {paused ? '暫停中' : PHASE_LABEL[st.phase]}</span>
        <span className="st-round">第 {st.round} / {cfg.rounds} 輪 · 個人</span>
      </div>
      <div className="st-clock" style={paused ? { opacity: .5 } : undefined}>{fmt(st.remainingSeconds)}</div>
      <div className="st-dots">
        {Array.from({ length: cfg.rounds }, (_, i) => {
          const n = i + 1
          const cls = n < st.round ? 'done' : n === st.round ? 'cur' : ''
          return <i key={n} className={cls} />
        })}
      </div>
      <div className="pp-ctrl">
        {paused
          ? <button type="button" className="btn-sm" onClick={resume}>▶ 繼續</button>
          : <button type="button" className="btn-sm" onClick={pause}>⏸ 暫停</button>}
        <button type="button" className="btn-sm" onClick={restart}>重新開始</button>
        <button type="button" className="btn-sm btn-danger" onClick={stop}>停止</button>
        <label className="pp-bell sm"><input type="checkbox" checked={cfg.bell} onChange={e => setCfg(c => ({ ...c, bell: e.target.checked }))} />鈴聲</label>
      </div>
    </div>
  )
}
