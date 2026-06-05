import { Link } from 'react-router-dom'

// 監獄介紹(形象):佔位文案,RP 沿用「服刑/放風/死線」用語。之後可替換正式內容。
export default function About() {
  return (
    <div>
      <h1>監獄介紹</h1>
      <p style={{ color: '#bbb', lineHeight: 1.8 }}>
        死線監獄是一座專收「拖稿犯」的虛擬監所。當你被死線追著跑,就來自首入監——
        在限定的「刑期」內,和其他獄友一起把稿子寫完。
      </p>

      <h3 style={{ marginTop: 24 }}>服刑節奏</h3>
      <ul style={{ color: '#bbb', lineHeight: 1.9 }}>
        <li><strong>服刑(專注)</strong>:25 分鐘專心趕稿,不得分心。</li>
        <li><strong>放風</strong>:每輪之間 5 分鐘休息,喘口氣。</li>
        <li><strong>長休</strong>:每 4 輪後 15 分鐘長放風。</li>
        <li><strong>典獄長</strong>:全程控場,負責開始、結束與輪數調整。</li>
      </ul>

      <h3 style={{ marginTop: 24 }}>怎麼入監</h3>
      <p style={{ color: '#bbb', lineHeight: 1.8 }}>
        到「近期場次」挑一梯次,按「入監服刑」用 Discord 登入完成預約,
        到時準時報到,開始服你的死線之刑。
      </p>

      <p style={{ marginTop: 24 }}>
        <Link to="/sessions" style={{ color: '#e0b04a' }}>→ 前往近期場次</Link>
      </p>
    </div>
  )
}
