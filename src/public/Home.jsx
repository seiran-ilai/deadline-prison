import { Link } from 'react-router-dom'

// 首頁(形象):RP 風格簡介 + 導向近期場次。文案為佔位,之後可調。
export default function Home() {
  const cta = { display: 'inline-block', padding: '10px 20px', borderRadius: 6, textDecoration: 'none', fontWeight: 700 }
  return (
    <div>
      <section style={{ textAlign: 'center', padding: '32px 0' }}>
        <h1 style={{ fontSize: 36, margin: '0 0 12px' }}>死線監獄 · Doing Time</h1>
        <p style={{ fontSize: 18, color: '#bbb', margin: '0 0 24px' }}>
          趕稿即服刑。把死線變成刑期,和獄友一起把稿子寫完。
        </p>
        <Link to="/sessions" style={{ ...cta, background: '#e0b04a', color: '#1a1a1a' }}>查看近期趕稿場次</Link>
      </section>

      <section style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 16 }}>
        <Card title="🏚 監獄介紹" desc="這座監獄怎麼運作、刑期與放風規則。" to="/about" />
        <Card title="👮 監獄人員" desc="看守你的獄卒與典獄長名冊。" to="/staff" />
        <Card title="🗓 近期場次" desc="選一梯次,入監服刑、開始趕稿。" to="/sessions" />
      </section>
    </div>
  )
}

function Card({ title, desc, to }) {
  return (
    <Link to={to} style={{ flex: '1 1 220px', textDecoration: 'none', color: '#eee', border: '1px solid #333', borderRadius: 8, padding: 16, background: '#222' }}>
      <strong style={{ fontSize: 16 }}>{title}</strong>
      <p style={{ color: '#aaa', margin: '8px 0 0', fontSize: 14 }}>{desc}</p>
    </Link>
  )
}
