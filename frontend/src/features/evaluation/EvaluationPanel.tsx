import type { Evaluation, Health, Region } from '../../types/workflow'

type Props = {
  evaluation: Evaluation | null; selected: string[]; instruction: string
  pending: string | null; ready: boolean; health: Health | null; stale: boolean
  onEvaluate: () => void; onGenerate: () => void; onSelect: (id: string) => void
  onInstruction: (value: string) => void; onHighlight: (region: Region | null) => void
}

export function EvaluationPanel(props: Props) {
  const { evaluation, selected, instruction, pending, ready, health, stale, onEvaluate, onGenerate, onSelect, onInstruction, onHighlight } = props
  return <aside className="evaluation-panel panel">
    <div className="panel-heading"><span className="eyebrow">YOUR CREATIVE PARTNER</span><h2><span className="spark">✳</span> AI 作画搭档</h2><p>先理解画面，再一起把它画好。</p></div>
    <div className="evaluation-body">
      {!health?.configured && <div className="connection-note">{health ? '模型尚未配置。填写项目根目录 .env 中的 OPENAI_API_KEY 并重启后端。' : '正在检查后端连接，可继续在画布上创作。'}</div>}
      <button className="primary full" onClick={onEvaluate} disabled={!ready || !!pending || !health?.configured}>{pending === 'evaluate' ? '正在观察画稿…' : evaluation ? '↻  重新评估画稿' : '✳  评估当前画稿'}</button>
      <small className="under-button">发送当前画面与创作要求进行真实 AI 评估</small>
      {pending && <div className="pending" role="status"><span className="spinner" /><b>{pending === 'generate' || pending === 'region-edit' ? '正在生成修正候选' : pending === 'region-chat' ? '正在回复选区对话' : pending === 'evaluate' ? '正在理解你的画面' : '正在处理画稿'}</b><p>云端处理可能需要几分钟。完成后再继续编辑。</p></div>}
      {!evaluation && !pending && <div className="evaluation-empty"><div className="empty-orbit">✧</div><h3>{stale ? '画稿或要求已更新' : '每一张好画，都始于对话'}</h3><p>{stale ? '重新评估，让建议与当前创作保持一致。' : '画几笔，或导入你的画稿。AI 会根据当前阶段，给出具体而克制的建议。'}</p><ol><li><span>1</span>观察画面，理解你的意图</li><li><span>2</span>由你挑选本轮修正建议</li><li><span>3</span>对比候选，决定是否采纳</li></ol></div>}
      {evaluation && <>
        <div className="critique-summary"><span className="eyebrow">画面观察</span><p>{evaluation.summary}</p>{evaluation.strengths.map((strength, index) => <div className="strength" key={index}>✓ <span>{strength}</span></div>)}</div>
        <div className="section-title"><h3>本轮修正建议</h3><small>已选 {selected.length} 项</small></div>
        <p className="muted small">只选择你认同的问题。指向建议可在画布定位。</p>
        {evaluation.suggestions.length === 0 && <p className="empty-message">本轮没有需要修正的问题。可以继续绘画，或调整目标后再次评估。</p>}
        <div className="suggestions">{evaluation.suggestions.map(suggestion => <label key={suggestion.id} className={`suggestion ${selected.includes(suggestion.id) ? 'selected' : ''}`} onMouseEnter={() => onHighlight(suggestion.region)} onMouseLeave={() => onHighlight(null)}>
          <div className="suggestion-top"><input type="checkbox" checked={selected.includes(suggestion.id)} disabled={!!pending} onChange={() => onSelect(suggestion.id)} /><b>{suggestion.title}</b><span className={`priority ${suggestion.priority}`}>{({ high: '优先', medium: '建议', low: '可选' })[suggestion.priority]}</span></div>
          <p>{suggestion.observation}</p><div className="suggestion-action">↳ {suggestion.action}</div><small>{suggestion.reason}</small>
        </label>)}</div>
        {evaluation.suggestions.length > 0 && <div className="generation-controls"><label htmlFor="instruction">本轮补充 <span>可选</span></label><textarea id="instruction" rows={2} maxLength={1500} disabled={!!pending} value={instruction} onChange={event => onInstruction(event.target.value)} placeholder="例如：动作只微调，保留松弛的手绘线条。" /><button className="primary full" disabled={!selected.length || !!pending} onClick={onGenerate}>{pending === 'generate' ? '正在生成…' : `生成修正候选${selected.length ? ` · ${selected.length} 项` : ''}`}</button><small className="under-button">生成会调用图像模型，候选等待你确认采纳。</small></div>}
        <details className="model-detail"><summary>本次评估信息</summary><p>{evaluation.model}<br />{evaluation.prompt_version}</p></details>
      </>}
    </div>
    <div className="panel-footer"><span className={`status-dot ${health?.configured ? 'online' : ''}`} />{health?.configured ? '真实模型已配置' : '等待模型连接'}<span>由你掌握最后一笔</span></div>
  </aside>
}
