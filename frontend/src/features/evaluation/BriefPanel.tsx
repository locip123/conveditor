import type { Brief, DrawingStage } from '../../types/workflow'

export const stages: { id: DrawingStage; name: string; subtitle: string; focus: string }[] = [
  { id: 'sketch', name: '草稿', subtitle: '动作与比例', focus: '优先看动作线、重心与剪影。保留草稿感，不提前清线或上色。' },
  { id: 'lineart', name: '线稿', subtitle: '结构与线条', focus: '优先看轮廓、遮挡与线条主次。保留已确定的动作和构图。' },
  { id: 'color', name: '上色', subtitle: '色彩与光影', focus: '优先看色块、明度与光源一致性。保留角色识别色和原有线稿。' },
]

export function BriefPanel({ brief, disabled, onChange }: { brief: Brief; disabled: boolean; onChange: (brief: Brief) => void }) {
  return <aside className="brief-panel panel">
    <div className="panel-heading"><span className="eyebrow">CREATIVE BRIEF</span><h2>这一笔，往哪里走？</h2><p>告诉 AI 你的意图，让建议服务于创作。</p></div>
    <fieldset disabled={disabled}>
      <legend>01 <span>当前绘画阶段</span></legend>
      <div className="stage-options">{stages.map((stage, index) => <button type="button" key={stage.id} className={`stage-option ${brief.stage === stage.id ? 'active' : ''}`} aria-pressed={brief.stage === stage.id} onClick={() => onChange({ ...brief, stage: stage.id })}>
        <span className="stage-number">0{index + 1}</span><span><b>{stage.name}</b><small>{stage.subtitle}</small></span><span className="radio-dot" />
      </button>)}</div>
      <p className="stage-focus">{stages.find(stage => stage.id === brief.stage)?.focus}</p>
      <label className="field-label" htmlFor="goal">02 <span>创作目标</span></label>
      <textarea id="goal" value={brief.goal} maxLength={1500} rows={4} placeholder="例如：让小狐狸信使的奔跑更有向前冲的动势。" onChange={event => onChange({ ...brief, goal: event.target.value })} />
      <label className="field-label" htmlFor="preserve">03 <span>一定要保留</span></label>
      <textarea id="preserve" value={brief.preserve} maxLength={1500} rows={3} placeholder="角色特征、构图、笔触，或你喜欢的细节。" onChange={event => onChange({ ...brief, preserve: event.target.value })} />
      <div className="scope-card"><span className="eyebrow">本轮修改范围</span><b>{brief.region ? '局部选区' : '整幅画稿'}</b><p>{brief.region ? '可在选区旁直接与 AI 对话或修改局部；框外像素保持原样，采纳前请检查框内效果。' : '用画布工具栏的「选区」框出想讨论或修改的范围。'}</p>{brief.region && <button type="button" className="text-button" onClick={() => onChange({ ...brief, region: null })}>清除选区 →</button>}</div>
    </fieldset>
    <div className="human-note"><span>✳</span><p>你决定方向，AI 提供另一种可能。<br />每一次修改，都由你确认。</p></div>
  </aside>
}
