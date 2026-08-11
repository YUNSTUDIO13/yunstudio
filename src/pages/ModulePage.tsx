import { useParams, Navigate } from 'react-router-dom'
import Overview from './Overview'
import Todos from './Todos'
import Requirements from './Requirements'
import Sprints from './Sprints'
import Bugs from './Bugs'
import News from './News'
import NavConfig from './NavConfig'
import TagDict from './TagDict'
import Apps from './Apps'
import UISettings from './UISettings'
import Movies from './Movies'

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
    case 'news':
      return <News />
    case 'nav-config':
      return <NavConfig />
    case 'tag-dict':
      return <TagDict />
    case 'apps':
      return <Apps />
    case 'ui-settings':
      return <UISettings />
    case 'movies':
      return <Movies />
    default:
      return <Navigate to="/modules/overview" replace />
  }
}
