import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import type { Profile, ProfileInput } from '../types'

// ============================================================
// 个人资料（profiles 表）云端读写 + 头像 Storage 上传
// 头像路径约定：avatars/{user_id}/avatar.<ext>（配合 SQL 的 foldername 策略）
// ============================================================

const TABLE = 'profiles'
const BUCKET = 'avatars'

interface ProfileContextValue {
  profile: Profile | null
  loading: boolean
  error: string | null
  /** 更新资料字段（昵称/职位/部门/签名） */
  updateProfile: (input: ProfileInput) => Promise<void>
  /** 上传头像二进制，返回公开 URL */
  uploadAvatar: (blob: Blob, mime: string) => Promise<string>
  /** 移除头像（清空 avatar_url 并删除桶内文件） */
  removeAvatar: () => Promise<void>
  refresh: () => Promise<void>
}

const ProfileContext = createContext<ProfileContextValue>({
  profile: null,
  loading: true,
  error: null,
  updateProfile: async () => {},
  uploadAvatar: async () => '',
  removeAvatar: async () => {},
  refresh: async () => {},
})

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) {
      setProfile(null)
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    const { data, error: err } = await supabase
      .from(TABLE)
      .select('*')
      .eq('id', user.id)
      .maybeSingle()

    if (err) {
      setError(err.message)
      setProfile(null)
    } else if (!data) {
      // 老账号可能没有 profile 行（注册触发器是后加的）：这里补建一条
      const fallback = {
        id: user.id,
        email: user.email ?? null,
        display_name: (user.email ?? '').split('@')[0] || null,
      }
      const { data: created, error: insErr } = await supabase
        .from(TABLE)
        .insert(fallback)
        .select('*')
        .maybeSingle()
      if (insErr) {
        setError(insErr.message)
        setProfile(null)
      } else {
        setProfile((created as Profile) ?? null)
        setError(null)
      }
    } else {
      setProfile(data as Profile)
      setError(null)
    }
    setLoading(false)
  }, [user])

  useEffect(() => {
    load()
  }, [load])

  // Realtime：多 PC 间资料/头像秒级同步
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`profiles:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: TABLE,
          filter: `id=eq.${user.id}`,
        },
        (payload: RealtimePostgresChangesPayload<Profile>) => {
          if (payload.eventType === 'DELETE') {
            setProfile(null)
          } else {
            setProfile(payload.new as Profile)
          }
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user])

  const updateProfile = useCallback(
    async (input: ProfileInput) => {
      if (!user) throw new Error('未登录')
      const patch: ProfileInput = {}
      if ('display_name' in input) patch.display_name = normalize(input.display_name)
      if ('title' in input) patch.title = normalize(input.title)
      if ('department' in input) patch.department = normalize(input.department)
      if ('bio' in input) patch.bio = normalize(input.bio)

      const { data, error: err } = await supabase
        .from(TABLE)
        .update(patch)
        .eq('id', user.id)
        .select('*')
        .maybeSingle()
      if (err) throw err
      if (data) setProfile(data as Profile)
    },
    [user],
  )

  const uploadAvatar = useCallback(
    async (blob: Blob, mime: string) => {
      if (!user) throw new Error('未登录')
      const ext = mime === 'image/webp' ? 'webp' : mime === 'image/png' ? 'png' : 'jpg'
      // 固定文件名 + upsert：同一用户永远只占一个文件，不会越传越多
      const path = `${user.id}/avatar.${ext}`

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { contentType: mime, upsert: true, cacheControl: '3600' })
      if (upErr) throw upErr

      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
      // 加时间戳绕过 CDN / 浏览器缓存，换头像后立刻可见
      const publicUrl = `${pub.publicUrl}?v=${Date.now()}`

      const { data, error: err } = await supabase
        .from(TABLE)
        .update({ avatar_url: publicUrl })
        .eq('id', user.id)
        .select('*')
        .maybeSingle()
      if (err) throw err
      if (data) setProfile(data as Profile)
      return publicUrl
    },
    [user],
  )

  const removeAvatar = useCallback(async () => {
    if (!user) throw new Error('未登录')
    // 三种扩展名都尝试删一遍（历史上可能传过不同格式），失败忽略
    await supabase.storage
      .from(BUCKET)
      .remove([`${user.id}/avatar.webp`, `${user.id}/avatar.jpg`, `${user.id}/avatar.png`])
      .catch(() => {})

    const { data, error: err } = await supabase
      .from(TABLE)
      .update({ avatar_url: null })
      .eq('id', user.id)
      .select('*')
      .maybeSingle()
    if (err) throw err
    if (data) setProfile(data as Profile)
  }, [user])

  return (
    <ProfileContext.Provider
      value={{ profile, loading, error, updateProfile, uploadAvatar, removeAvatar, refresh: load }}
    >
      {children}
    </ProfileContext.Provider>
  )
}

/** 空串统一存 null，避免数据库里出现 '' 与 null 两种"空" */
function normalize(v?: string | null): string | null {
  if (v == null) return null
  const t = v.trim()
  return t.length ? t : null
}

export function useProfile(): ProfileContextValue {
  return useContext(ProfileContext)
}
