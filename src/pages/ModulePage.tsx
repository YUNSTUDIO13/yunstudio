import { useParams, Navigate } from 'react-router-dom'
import Overview from './Overview'
import Todos from './Todos'
import Requirements from './Requirements'
import Sprints from './Sprints'
import Bugs from './Bugs'
import Kpis from './Kpis'
import News from './News'
import NavConfig from './NavConfig'

/**
 * 统一模块页：根据 /modules/:id 反查并渲染对应内置组件
 * 未知 id → 重定向到 /modules/overview
 */
export default function ModulePage() {
  const { id } = useParams<{ id: string }>()

  switch (id) {
    case 'overview':
      return <Overview />
    case 'todos':
      return <Todos />
    case 'requirements':
      return <Requirements />
    case 'sprints':
      return <Sprints />
    case 'bugs':
      return <Bugs />
    case 'kpis':
      return <Kpis />
    case 'news':
      return <News />
    case 'nav-config':
      return <NavConfig />
    default:
      return <Navigate to="/modules/overview" replace />
  }
}
