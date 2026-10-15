import type { Brief, Candidate, Evaluation, Health, RegionMessageResponse } from '../types/workflow'

async function request<T>(path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('无法连接后端。请检查服务是否启动；画稿仍保留在本地。')
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : `请求失败（${response.status}），请检查后端服务。`)
  if (!data) throw new Error('后端没有返回有效数据，请检查服务。')
  return data as T
}

export const api = {
  health: () => request<Health>('health'),
  evaluate: (image: string, brief: Brief) => request<Evaluation>('evaluations', { image, brief }),
  edit: (evaluation_id: string, suggestion_ids: string[], instruction: string) =>
    request<Candidate>('edits', { evaluation_id, suggestion_ids, instruction }),
  startRegion: (image: string, brief: Brief) => request<{ id: string }>('region-sessions', { image, brief }),
  regionMessage: (id: string, message: string, mode: 'chat' | 'edit') =>
    request<RegionMessageResponse>(`region-sessions/${id}/messages`, { message, mode }),
}
