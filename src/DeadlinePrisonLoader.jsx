// 死線監獄 · loading / 登入落地畫面（零外部依賴，CSS 自帶於 <style>）
// 用途:遮住初次載入時 Google Fonts(display=swap)的字體切換閃爍,並統一服刑系統的進場視覺。
// 設計約束:純 CSS-in-JS、單檔自含、prefers-reduced-motion 已降級;不引入任何動畫套件。

const CSS = `
.dpl-root{position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#0b0b09;font-family:"PingFang TC","Microsoft JhengHei","Noto Sans TC",ui-sans-serif,sans-serif;isolation:isolate}
.dpl-root.dpl-fixed{position:fixed;inset:0;z-index:9999}
.dpl-root.dpl-inline{width:100%;min-height:500px;border-radius:14px}
.dpl-bars{position:absolute;inset:0;z-index:0;background:repeating-linear-gradient(90deg,transparent 0 46px,rgba(255,255,255,.018) 46px 48px)}
.dpl-vig{position:absolute;inset:0;z-index:1;background:radial-gradient(120% 90% at 50% 42%,transparent 40%,rgba(0,0,0,.7) 100%)}
.dpl-scan{position:absolute;left:0;right:0;height:120px;top:-30%;z-index:2;background:linear-gradient(180deg,transparent,rgba(232,182,0,.05),transparent);animation:dpl-scan 5.5s linear infinite}
.dpl-haz{position:absolute;left:0;right:0;height:5px;z-index:3;background:repeating-linear-gradient(45deg,#E8B600 0 12px,#16150f 12px 24px);background-size:34px 34px;opacity:.8;animation:dpl-haz 2.4s linear infinite}
.dpl-haz.dpl-t{top:0}.dpl-haz.dpl-b{bottom:0}
.dpl-content{position:relative;z-index:4;display:flex;flex-direction:column;align-items:center;gap:18px;padding:0 24px;text-align:center;width:100%;box-sizing:border-box}
.dpl-badge{display:inline-flex;align-items:center;gap:10px;border:1px solid rgba(232,182,0,.55);border-radius:3px;padding:7px 16px;font-family:ui-monospace,Menlo,monospace;font-size:12px;letter-spacing:.22em;color:#cfcabb;opacity:0;animation:dpl-up .5s ease-out .5s both}
.dpl-dot{width:8px;height:8px;border-radius:50%;background:#E8553B;box-shadow:0 0 8px #E8553B;animation:dpl-blink 1.1s steps(1,end) infinite}
.dpl-sep{color:#5a5b52}
.dpl-word{display:flex;line-height:.92;font-weight:800;letter-spacing:.04em;font-size:clamp(52px,12vw,118px);opacity:0;animation:dpl-flicker .55s ease-out both}
.dpl-word .dpl-w1{color:#ededed;text-shadow:0 3px 0 rgba(0,0,0,.5)}
.dpl-word .dpl-w2{color:#E8B600;text-shadow:0 3px 0 rgba(0,0,0,.5);animation:dpl-glow 2.6s ease-in-out infinite}
.dpl-sub{position:relative;font-family:ui-monospace,Menlo,monospace;font-weight:700;letter-spacing:.34em;font-size:clamp(15px,3.2vw,30px);color:#5f6157;padding-bottom:8px;opacity:0;animation:dpl-up .5s ease-out .65s both}
.dpl-sub .dpl-num{color:#cfcabb}
.dpl-uline{position:absolute;left:50%;bottom:0;width:120px;max-width:60%;height:3px;background:#E8B600;transform:translateX(-50%) scaleX(0);transform-origin:center;animation:dpl-draw .6s ease-out .9s both}
.dpl-loader{width:min(440px,82%);margin-top:6px;opacity:0;animation:dpl-up .5s ease-out .8s both}
.dpl-lrow{display:flex;justify-content:space-between;font-family:ui-monospace,Menlo,monospace;font-size:12px;letter-spacing:.2em;color:#7c7d72;margin-bottom:9px}
.dpl-proc::after{content:"";animation:dpl-dots 1.4s steps(1,end) infinite}
.dpl-track{position:relative;height:8px;border-radius:2px;background:rgba(255,255,255,.07);overflow:hidden}
.dpl-fill{position:relative;height:100%;background:repeating-linear-gradient(45deg,#E8B600 0 9px,#a87f00 9px 18px);background-size:26px 26px;animation:dpl-haz 1s linear infinite;transition:width .4s cubic-bezier(.23,1,.32,1)}
.dpl-fill.dpl-indet{width:38%;animation:dpl-haz 1s linear infinite,dpl-indet 1.5s ease-in-out infinite}
.dpl-sheen{position:absolute;top:0;left:0;height:100%;width:60px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.45),transparent);animation:dpl-sheen 1.4s linear infinite}
.dpl-footer{margin-top:14px;opacity:0;animation:dpl-up .5s ease-out 1s both}
@keyframes dpl-scan{0%{top:-30%}100%{top:120%}}
@keyframes dpl-haz{0%{background-position:0 0}100%{background-position:34px 0}}
@keyframes dpl-blink{0%,55%{opacity:1}56%,100%{opacity:.18}}
@keyframes dpl-glow{0%,100%{text-shadow:0 3px 0 rgba(0,0,0,.5),0 0 2px rgba(232,182,0,.2)}50%{text-shadow:0 3px 0 rgba(0,0,0,.5),0 0 16px rgba(232,182,0,.55)}}
@keyframes dpl-flicker{0%{opacity:0}18%{opacity:.7}24%{opacity:.12}40%{opacity:.9}52%{opacity:.25}68%{opacity:1}78%{opacity:.55}88%{opacity:1}100%{opacity:1}}
@keyframes dpl-up{0%{opacity:0;transform:translateY(8px)}100%{opacity:1;transform:translateY(0)}}
@keyframes dpl-draw{0%{transform:translateX(-50%) scaleX(0)}100%{transform:translateX(-50%) scaleX(1)}}
@keyframes dpl-indet{0%{transform:translateX(-120%)}100%{transform:translateX(320%)}}
@keyframes dpl-sheen{0%{left:-60px}100%{left:100%}}
@keyframes dpl-dots{0%{content:"."}33%{content:".."}66%{content:"..."}100%{content:""}}
@media (prefers-reduced-motion:reduce){
.dpl-scan,.dpl-haz,.dpl-dot,.dpl-word,.dpl-badge,.dpl-sub,.dpl-uline,.dpl-loader,.dpl-fill,.dpl-sheen,.dpl-word .dpl-w2,.dpl-footer{animation:none!important}
.dpl-word,.dpl-badge,.dpl-sub,.dpl-loader,.dpl-footer{opacity:1;transform:none}
.dpl-uline{transform:translateX(-50%) scaleX(1)}
.dpl-fill.dpl-indet{width:88%}
}
`

export default function DeadlinePrisonLoader({
  status = '收容中',
  statusEn = 'INTAKE OPEN',
  cellNo = '0118',
  progress = null,
  procLabel = '收容程序',
  fullscreen = true,
  children,
}) {
  const isDeterminate = typeof progress === 'number'
  const pct = isDeterminate ? Math.max(0, Math.min(100, progress)) : 0

  return (
    <div className={`dpl-root ${fullscreen ? 'dpl-fixed' : 'dpl-inline'}`} role="status" aria-live="polite" aria-label="死線監獄載入中">
      <style>{CSS}</style>
      <div className="dpl-bars" />
      <div className="dpl-vig" />
      <div className="dpl-scan" />
      <div className="dpl-haz dpl-t" />

      <div className="dpl-content">
        <div className="dpl-badge">
          <span className="dpl-dot" />
          <span>{status}</span>
          <span className="dpl-sep">·</span>
          <span>{statusEn}</span>
          <span className="dpl-sep">·</span>
          <span>24H</span>
        </div>

        <div className="dpl-word">
          <span className="dpl-w1">死線</span>
          <span className="dpl-w2">監獄</span>
        </div>

        <div className="dpl-sub">
          DEADLINE&nbsp;PRISON&nbsp;·&nbsp;NO.<span className="dpl-num">{cellNo}</span>
          <span className="dpl-uline" />
        </div>

        <div className="dpl-loader">
          <div className="dpl-lrow">
            <span>{procLabel}</span>
            {isDeterminate ? <span>{Math.round(pct)}%</span> : <span className="dpl-proc">PROCESSING</span>}
          </div>
          <div className="dpl-track">
            <div
              className={`dpl-fill${isDeterminate ? '' : ' dpl-indet'}`}
              style={isDeterminate ? { width: `${pct}%` } : undefined}
            >
              <div className="dpl-sheen" />
            </div>
          </div>
        </div>

        {children ? <div className="dpl-footer">{children}</div> : null}
      </div>

      <div className="dpl-haz dpl-b" />
    </div>
  )
}
