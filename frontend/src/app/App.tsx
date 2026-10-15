import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { CanvasEditor, type CanvasHandle } from '../features/editor/CanvasEditor'
import { RegionChat } from '../features/editor/RegionChat'
import { downloadImage, fitImage, importImage, sampleImage } from '../features/editor/images'
import { BriefPanel, stages } from '../features/evaluation/BriefPanel'
import { EvaluationPanel } from '../features/evaluation/EvaluationPanel'
import { CandidateDialog, type Preview } from '../features/editing/CandidateDialog'
import { History } from '../features/history/History'
import { loadWorkspace, saveWorkspace } from '../features/history/persistence'
import type { Brief, Drawing, Evaluation, Health, Region, Revision } from '../types/workflow'

const initialBrief: Brief = {
  stage: 'sketch', goal: '设计一只温暖、勇敢的小狐狸信使。希望姿态自然，剪影清晰，适合二维动画。',
  preserve: '保留尖耳朵、围巾和挎包，保持简洁的手绘风格。', region: null,
}
const blank: Drawing = { base: null, strokes: [] }
const palette = ['#364751', '#d17a52', '#b7c7c0', '#728eaa', '#c4a0b1', '#ffffff']

export function App() {
  const canvas = useRef<CanvasHandle>(null)
  const canvasHolder = useRef<HTMLDivElement>(null)
  const [regionConversation, setRegionConversation] = useState(0)
  const [regionAutoFocus, setRegionAutoFocus] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const [drawingName, setDrawingName] = useState('未命名画稿')
  const [drawing, setDrawing] = useState<Drawing>(blank)
  const [brief, setBrief] = useState<Brief>(initialBrief)
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [undo, setUndo] = useState<Drawing[]>([])
  const [redo, setRedo] = useState<Drawing[]>([])
  const [tool, setTool] = useState<'brush' | 'eraser' | 'select'>('brush')
  const [color, setColor] = useState(palette[0])
  const [width, setWidth] = useState(5)
  const [health, setHealth] = useState<Health | null>(null)
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null)
  const [source, setSource] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [instruction, setInstruction] = useState('')
  const [highlight, setHighlight] = useState<Region | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [canvasReady, setCanvasReady] = useState(false)
  const [saved, setSaved] = useState('正在恢复工作区…')
  const saveQueue = useRef(Promise.resolve())
  const saveGeneration = useRef(0)
  const locked = !!pending || !!preview || !loaded
  const ready = canvasReady && !locked
  const reportError = useCallback((message: string) => setError(message), [])

  useEffect(() => {
    let alive = true
    loadWorkspace().then(workspace => {
      if (!alive) return
      if (workspace) {
        setDrawingName(workspace.name?.trim() || '未命名画稿')
        setDrawing(workspace.drawing); setBrief(workspace.brief); setRevisions(workspace.revisions)
      }
    }).catch(() => { if (alive) setError('无法读取本地存档。可以继续绘画，请及时导出 PNG。') })
      .finally(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    api.health().then(result => { if (alive) setHealth(result) }).catch(error => { if (alive) setError(error.message) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!loaded) return
    const generation = ++saveGeneration.current
    setSaved('正在保存…')
    const timer = setTimeout(() => {
      saveQueue.current = saveQueue.current.then(() => saveWorkspace({ name: drawingName, drawing, brief, revisions }))
        .then(() => { if (generation === saveGeneration.current) setSaved('已自动保存到本机') })
        .catch(() => { setSaved('自动保存失败'); setError('本地存储失败或空间不足，请导出 PNG 保存画稿。') })
    }, 300)
    return () => clearTimeout(timer)
  }, [drawingName, drawing, brief, revisions, loaded])

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (pending || saved === '正在保存…') { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [pending, saved])

  function invalidate() {
    setRegionAutoFocus(false)
    setRegionConversation(previous => previous + 1)
    if (evaluation) setStale(true)
    setEvaluation(null); setSelected([]); setHighlight(null); setInstruction(''); setError('')
  }
  function changeDrawing(next: Drawing) {
    setUndo(previous => [...previous, drawing].slice(-60)); setRedo([])
    setDrawing(next); invalidate()
  }
  function changeBrief(next: Brief) { setBrief(next); invalidate() }
  function addRevision(name: string, image: string, document = drawing, context = brief) {
    const revision = { id: crypto.randomUUID(), name, image, drawing: document, brief: context, createdAt: new Date().toISOString() }
    setRevisions(previous => [...previous, revision].slice(-20))
  }
  function undoDrawing() {
    if (!undo.length || locked) return
    setRedo(previous => [...previous, drawing]); setDrawing(undo[undo.length - 1]); setUndo(undo.slice(0, -1)); invalidate()
  }
  function redoDrawing() {
    if (!redo.length || locked) return
    setUndo(previous => [...previous, drawing]); setDrawing(redo[redo.length - 1]); setRedo(redo.slice(0, -1)); invalidate()
  }
  async function insertImage(file?: File) {
    if (!ready) return
    setPending('import'); setError('')
    try {
      const image = file ? await importImage(file) : await fitImage(sampleImage)
      if (drawing.base || drawing.strokes.length) addRevision('导入前的画稿', canvas.current!.snapshot())
      changeDrawing({ base: image, strokes: [] }); setBrief(previous => ({ ...previous, region: null }))
      setNotice(file ? '画稿已导入，可继续绘画或请求评估。' : '已载入原创示例草稿，可直接动笔修改。')
    } catch (error) { setError((error as Error).message) }
    finally { setPending(null) }
  }
  async function evaluate() {
    if (!ready || !brief.goal.trim()) return
    const image = canvas.current!.snapshot()
    setPending('evaluate'); setError(''); setNotice(''); setEvaluation(null); setSelected([]); setHighlight(null)
    addRevision('评估前的画稿', image)
    try {
      const result = await api.evaluate(image, brief)
      setEvaluation(result); setSource(image); setStale(false)
    } catch (error) { setError((error as Error).message) }
    finally { setPending(null) }
  }
  async function generate() {
    if (!evaluation || !selected.length || locked) return
    setPending('generate'); setError(''); setHighlight(null)
    try {
      const candidate = await api.edit(evaluation.id, selected, instruction)
      const image = await fitImage(candidate.image_url)
      setPreview({ candidate, image, source })
    } catch (error) { setError((error as Error).message) }
    finally { setPending(null) }
  }
  function adopt() {
    if (!preview) return
    const next: Drawing = { base: preview.image, strokes: [] }
    changeDrawing(next)
    addRevision('采纳 AI 修正', preview.image, next)
    setPreview(null); setNotice('已采纳并保存新版本。可以继续手绘，或重新评估。')
  }
  function restore(revision: Revision) {
    if (!ready) return
    const current = JSON.stringify({ drawing, brief })
    const isCurrent = (version: Revision) => JSON.stringify({ drawing: version.drawing, brief: version.brief }) === current
    if (isCurrent(revision)) { setNotice(`当前已是「${revision.name}」，无需重复恢复。`); return }
    const alreadySaved = revisions.some(isCurrent)
    if (!alreadySaved) addRevision('恢复前的画稿', canvas.current!.snapshot())
    changeDrawing(revision.drawing); setBrief(revision.brief)
    setNotice(`已恢复「${revision.name}」。${alreadySaved ? '' : '恢复前的画稿也已保存。'}`)
  }
  function deleteRevision(revision: Revision) {
    if (!ready) return
    setRevisions(previous => previous.filter(version => version.id !== revision.id))
    setNotice(`已删除「${revision.name}」的版本记录，当前画稿保持不变。`)
  }
  const step = preview ? 3 : pending === 'generate' || pending === 'region-edit' ? 2 : evaluation ? 1 : 0

  return <div className="application">
    <header className="app-header"><div className="brand"><span className="brand-mark">c<span>✳</span></span><b>conveditor<span>动画作画工作室</span></b></div><div className="project-name"><input aria-label="画稿名称" title="点击修改画稿名称，按 Enter 确认" value={drawingName} maxLength={60} disabled={locked} onChange={event => setDrawingName(event.target.value)} onBlur={() => setDrawingName(previous => previous.trim() || '未命名画稿')} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur() }} /><span>/</span> {stages.find(stage => stage.id === brief.stage)?.name}研究</div><div className="header-actions"><small><span className="status-dot online" />{saved}</small><button className="secondary" disabled={!ready} onClick={() => downloadImage(canvas.current!.snapshot())}>↓ 导出 PNG</button></div></header>
    <nav className="workflow-bar" aria-label="创作流程"><span className="workflow-caption">HUMAN + AI</span>{['绘画与目标', '评估与选择', '生成修正', '对比与采纳'].map((label, index) => <div className={`workflow-step ${index === step ? 'current' : ''} ${index < step ? 'done' : ''}`} key={label}><span>{index < step ? '✓' : `0${index + 1}`}</span>{label}{index < 3 && <i>—</i>}</div>)}<small>把创作的主动权留在你手里</small></nav>
    {(error || notice) && <div className={`message-banner ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}><span>{error || notice}</span><button aria-label="关闭提示" onClick={() => { setError(''); setNotice('') }}>✕</button></div>}
    <main className="workspace">
      <BriefPanel brief={brief} disabled={locked} onChange={changeBrief} />
      <section className="drawing-panel">
        <div className="drawing-heading"><div><span className="eyebrow">THE DRAWING BOARD</span><h1>让灵感，落在画布上。</h1></div><span className="paper-badge">1024 × 1024 <span>·</span> PNG</span></div>
        <div className="toolbar" role="toolbar" aria-label="绘画工具">
          <div className="tool-group">{([['brush', '✎', '画笔'], ['eraser', '◇', '橡皮'], ['select', '▧', '选区']] as const).map(([id, icon, label]) => <span className="tool-with-help" key={id}><button className={`tool-button ${tool === id ? 'active' : ''}`} aria-label={label} aria-describedby={id === 'select' ? 'selection-help' : undefined} aria-pressed={tool === id} disabled={locked} onClick={() => setTool(id)}><span aria-hidden="true">{icon}</span>{label}</button>{id === 'select' && <span id="selection-help" className="tool-help" role="tooltip">拖动框选想讨论或修改的区域。松开鼠标后，在选区旁与 AI 对话，也可按文字要求修改局部；框外像素保持原样，采纳前请检查框内效果。</span>}</span>)}</div>
          <div className="tool-group brush-settings"><input type="color" aria-label="画笔颜色" value={color} disabled={locked} onChange={event => setColor(event.target.value)} /><input type="range" aria-label="画笔大小" min={1} max={48} value={width} disabled={locked} onChange={event => setWidth(Number(event.target.value))} /><span>{width}px</span></div>
          <div className="tool-group undo-tools"><button className="icon-button" aria-label="撤销" title="撤销" disabled={locked || !undo.length} onClick={undoDrawing}>↶</button><button className="icon-button" aria-label="重做" title="重做" disabled={locked || !redo.length} onClick={redoDrawing}>↷</button></div>
          <button className="import-button" disabled={!ready} onClick={() => fileInput.current?.click()}>↑ 导入画稿</button><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void insertImage(file); event.target.value = '' }} />
        </div>
        <div className="canvas-workspace"><div className="canvas-topline"><span>画稿 01</span><span>{tool === 'select' ? '拖动框选本轮修改范围' : tool === 'eraser' ? '擦除至白色画纸' : '自由绘画 · 支持触控'}</span><span>{Math.round(width)} PX</span></div>
          <div className="canvas-holder" ref={canvasHolder}><CanvasEditor ref={canvas} drawing={drawing} region={brief.region} highlight={highlight} tool={tool} color={color} width={width} disabled={locked || !canvasReady} onChange={changeDrawing} onRegion={region => { changeBrief({ ...brief, region }); setRegionAutoFocus(!!region) }} onReady={setCanvasReady} onError={reportError} />
            {!drawing.base && !drawing.strokes.length && !pending && <div className="canvas-empty"><span className="sketch-symbol">✎</span><h2>从一笔开始。</h2><p>直接绘画，或从一张草稿出发。</p><button className="secondary" disabled={!ready} onClick={() => void insertImage()}>载入狐狸信使示例 →</button><small>原创示例草稿 · 可继续编辑</small></div>}
          </div>
          <div className="canvas-bottomline"><div className="palette">{palette.map(value => <button key={value} aria-label={`使用颜色 ${value}`} className={value === color ? 'active' : ''} style={{ background: value }} disabled={locked} onClick={() => { setColor(value); setTool('brush') }} />)}</div><span>纸上每一笔，都是你的决定。</span></div>
        </div>
        <div className="canvas-actions"><button className="text-button" disabled={!ready || (!drawing.base && !drawing.strokes.length)} onClick={() => { addRevision('清空前的画稿', canvas.current!.snapshot()); changeDrawing(blank); setBrief(previous => ({ ...previous, region: null })); setNotice('已新建空白画稿，可撤销或从历史恢复。') }}>＋ 新建空白画稿</button><button className="secondary" disabled={!ready} onClick={() => { addRevision('手动保存', canvas.current!.snapshot()); setNotice('已保存当前版本。') }}>＋ 保存版本</button></div>
        <History revisions={revisions} disabled={!ready} onRestore={restore} onDelete={deleteRevision} />
      </section>
      <EvaluationPanel evaluation={evaluation} selected={selected} instruction={instruction} pending={pending} ready={ready && !!brief.goal.trim() && !!(drawing.base || drawing.strokes.length)} health={health} stale={stale} onEvaluate={() => void evaluate()} onGenerate={() => void generate()} onSelect={id => setSelected(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id])} onInstruction={setInstruction} onHighlight={setHighlight} />
    </main>
    {brief.region && loaded && <RegionChat key={regionConversation} anchor={canvasHolder} region={brief.region} brief={brief} autoFocus={regionAutoFocus} disabled={!ready} configured={!!health?.configured} snapshot={() => canvas.current!.snapshot()} onBusy={setPending} onCandidate={async (candidate, original) => {
      const image = await fitImage(candidate.image_url)
      addRevision('局部修改前的画稿', original)
      setPreview({ candidate, image, source: original })
    }} />}
    {preview && <CandidateDialog preview={preview} onAdopt={adopt} onDiscard={() => { setPreview(null); setNotice('已放弃候选，原画稿保持在画布上。可调整建议后再次生成。') }} />}
  </div>
}
