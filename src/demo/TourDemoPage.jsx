import DemoSessionGoals from './DemoSessionGoals'
import DemoGuardWork from './DemoGuardWork'
import DemoMemos from './DemoMemos'
import DemoBookings from './DemoBookings'
import DemoManuscripts from './DemoManuscripts'
import DemoRecords from './DemoRecords'
import DemoGuardRecords from './DemoGuardRecords'
import DemoProfile from './DemoProfile'

// 導覽示範頁分派器:依目前分頁渲染對應的假資料示範元件。
// kind('crunch'|'named')只對犯人服刑 / 獄卒作業有意義,用來呈現兩種不同介面。
export default function TourDemoPage({ tab, kind = 'crunch' }) {
  switch (tab) {
    case 'session': return <DemoSessionGoals kind={kind} />
    case 'guardwork': return <DemoGuardWork kind={kind} />
    case 'memos': return <DemoMemos />
    case 'booking': return <DemoBookings />
    case 'me': return <DemoManuscripts />
    case 'records': return <DemoRecords />
    case 'guardrecords': return <DemoGuardRecords />
    case 'profile': return <DemoProfile />
    default: return null
  }
}
