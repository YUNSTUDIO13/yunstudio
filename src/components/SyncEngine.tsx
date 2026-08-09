import { useSyncEngine } from '../lib/sync'

/** 全局挂载的同步引擎：监听在线事件并把本地发件箱补传到云端。自身不渲染任何 UI。 */
export default function SyncEngine() {
  useSyncEngine()
  return null
}
