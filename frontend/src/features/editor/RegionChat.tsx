import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../api/client'
import type { Brief, Candidate, Region, RegionMessage } from '../../types/workflow'

type Props = {
  anchor: RefObject<HTMLDivElement | null>; region: Region; brief: Brief
  disabled: boolean; configured: boolean; autoFocus: boolean; snapshot: () => string
  onBusy: (mode: 'region-chat' | 'region-edit' | null) => void
  onCandidate: (candidate: Candidate, source: string) => Promise<void>
}

export function RegionChat({ anchor, region, brief, disabled, configured, autoFocus, snapshot, onBusy, onCandidate }: Props) {
  const panel = useRef<HTMLElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const transcript = useRef<HTMLDivElement>(null)
  const session = useRef<{ id: string; source: string } | null>(null)
  const sending = useRef(false)
  const hasFocused = useRef(false)
  const [messages, setMessages] = useState<RegionMessage[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'chat' | 'edit' | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, visible: false })

  useLayoutEffect(() => {
    function place() {
      if (!anchor.current || !panel.current) return
      const canvas = anchor.current.getBoundingClientRect()
      const popup = panel.current.getBoundingClientRect()
      const bounds = { left: canvas.left + region.x * canvas.width, right: canvas.left + (region.x + region.width) * canvas.width, top: canvas.top + region.y * canvas.height, bottom: canvas.top + (region.y + region.height) * canvas.height }
      const gap = 12, margin = 12
      let left = bounds.right + gap, top = bounds.top
      if (left + popup.width > window.innerWidth - margin) {
        if (bounds.left - gap - popup.width >= margin) left = bounds.left - gap - popup.width
        else {
          left = bounds.left
          top = bounds.bottom + gap
          if (top + popup.height > window.innerHeight - margin && bounds.top - gap - popup.height >= margin) top = bounds.top - gap - popup.height
        }
      }
      left = Math.max(margin, Math.min(left, window.innerWidth - popup.width - margin))
      top = Math.max(margin, Math.min(top, window.innerHeight - popup.height - margin))
      setPosition({ left, top, visible: bounds.bottom > 0 && bounds.top < window.innerHeight && bounds.right > 0 && bounds.left < window.innerWidth })
    }
    const observer = new ResizeObserver(place)
    if (anchor.current) observer.observe(anchor.current)
    if (panel.current) observer.observe(panel.current)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    place()
    return () => { observer.disconnect(); window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [anchor, region, collapsed])

  useEffect(() => {
    if (autoFocus && position.visible && !disabled && !hasFocused.current) {
      textarea.current?.focus({ preventScroll: true })
      hasFocused.current = true
    }
  }, [autoFocus, position.visible, disabled])
  useEffect(() => { if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight }, [messages, busy])

  async function send(mode: 'chat' | 'edit') {
    const message = draft.trim()
    if (!message || disabled || !configured || sending.current) return
    sending.current = true
    setBusy(mode); setError(''); onBusy(mode === 'chat' ? 'region-chat' : 'region-edit')
    try {
      if (!session.current) {
        const source = snapshot()
        const created = await api.startRegion(source, brief)
        session.current = { id: created.id, source }
      }
      const response = await api.regionMessage(session.current.id, message, mode)
      setMessages(previous => [...previous, { role: 'user', content: message }, { role: 'assistant', content: response.reply }])
      setDraft('')
      if (response.candidate) await onCandidate(response.candidate, session.current.source)
    } catch (error) { setError((error as Error).message) }
    finally { sending.current = false; setBusy(null); onBusy(null) }
  }

  return createPortal(<section ref={panel} className={`region-chat ${collapsed ? 'collapsed' : ''}`} aria-label="选区对话" style={{ left: position.left, top: position.top, visibility: position.visible ? 'visible' : 'hidden' }}>
    <div className="region-chat-heading"><div><span className="spark">✳</span><b>选区对话</b><span className="region-chat-badge">局部</span></div><button type="button" className="quiet" aria-label={collapsed ? '展开选区对话' : '收起选区对话'} aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? '＋' : '−'}</button></div>
    {!collapsed && <>
      <div ref={transcript} className="region-chat-messages" role="log" aria-live="polite" aria-label="选区聊天记录">
        {messages.map((message, index) => <div key={index} className={`region-message ${message.role}`}><b>{message.role === 'user' ? '你' : 'AI 作画搭档'}</b><p>{message.content}</p></div>)}
        {busy && <p className="region-chat-wait" role="status"><span className="spinner" />{busy === 'chat' ? '正在观察选区并回复…' : '正在理解要求并生成局部候选…'}</p>}
      </div>
      {error && <p className="region-chat-error" role="alert">{error}</p>}
      {!configured && <p className="region-chat-error">模型尚未连接，请检查后端模型配置。</p>}
      <label className="sr-only" htmlFor="region-message">给选区 AI 的消息</label>
      <textarea ref={textarea} id="region-message" rows={3} value={draft} maxLength={2000} disabled={disabled} placeholder="输入问题或具体修改要求…" onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void send('chat') } }} />
      <div className="region-chat-actions"><button className="secondary" disabled={disabled || !configured || !draft.trim()} onClick={() => void send('chat')}>发送消息</button><button className="primary" disabled={disabled || !configured || !draft.trim()} onClick={() => void send('edit')}>修改选区</button></div>
      <small className="region-chat-footer">Ctrl / ⌘ + Enter 发送消息 · 修改后先对比采纳<br />重新框选或改变画稿、目标会开启新对话。</small>
    </>}
  </section>, document.body)
}
