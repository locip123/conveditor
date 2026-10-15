import { useEffect, useRef, useState } from 'react'
import type { Candidate } from '../../types/workflow'

export type Preview = { candidate: Candidate; image: string; source: string }

export function CandidateDialog({ preview, onAdopt, onDiscard }: { preview: Preview; onAdopt: () => void; onDiscard: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [split, setSplit] = useState(50)
  const [mode, setMode] = useState<'slider' | 'side'>('slider')
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="candidate-dialog" onCancel={event => { event.preventDefault(); onDiscard() }}>
    <div className="dialog-heading"><div><span className="eyebrow">A NEW POSSIBILITY</span><h2>看看这一笔，是否更接近你的想法。</h2></div><button className="quiet" onClick={onDiscard} aria-label="放弃候选并关闭">✕</button></div>
    <div className="compare-toolbar"><p>原画稿已保留。采纳前，检查角色特征、修改范围与画风。</p><div className="segmented"><button className={mode === 'slider' ? 'active' : ''} onClick={() => setMode('slider')}>滑动对比</button><button className={mode === 'side' ? 'active' : ''} onClick={() => setMode('side')}>并排对比</button></div></div>
    {mode === 'slider' ? <div className="compare-slider">
      <img src={preview.image} alt="AI 修正候选" />
      <img className="before-image" src={preview.source} alt="修正前的画稿" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} />
      <span className="compare-label before">原画稿</span><span className="compare-label after">AI 候选</span>
      <div className="compare-divider" style={{ left: `${split}%` }}><span>↔</span></div>
      <input type="range" min={0} max={100} value={split} onChange={event => setSplit(Number(event.target.value))} aria-label="前后对比位置" />
    </div> : <div className="compare-side"><figure><img src={preview.source} alt="原画稿" /><figcaption>原画稿</figcaption></figure><figure><img src={preview.image} alt="AI 修正候选" /><figcaption>AI 候选</figcaption></figure></div>}
    <div className="candidate-details"><p>{preview.candidate.scope === 'masked_region' ? '本轮为局部修正：选区外原始像素已保留，请检查选区内非目标部位及边缘衔接。' : '本轮为整幅指令修正：请检查未要求修改的区域是否保持一致。'}</p><details><summary>查看本轮生成指令 · {preview.candidate.model}</summary><pre>{preview.candidate.prompt}</pre></details></div>
    <div className="dialog-actions"><button className="secondary" onClick={onDiscard}>放弃候选，继续绘画</button><button className="primary" onClick={onAdopt}>✓  采纳并保存新版本</button></div>
  </dialog>
}
