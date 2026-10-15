import type { Revision } from '../../types/workflow'

export function History({ revisions, disabled, onRestore, onDelete }: { revisions: Revision[]; disabled: boolean; onRestore: (revision: Revision) => void; onDelete: (revision: Revision) => void }) {
  return <section className="history-panel">
    <div className="section-title"><h2>画稿版本 <span>{revisions.length.toString().padStart(2, '0')}</span></h2><small>点击恢复 · 保留最近 20 份</small></div>
    <div className="history-list">
      {revisions.length === 0 && <p className="muted">保存画稿，或完成一次 AI 评估，建立第一个创作节点。</p>}
      {[...revisions].reverse().map((revision, index) => <div className="revision" key={revision.id}>
        <button className="revision-restore" disabled={disabled} onClick={() => onRestore(revision)} title={`恢复：${revision.name}`} aria-label={`恢复版本：${revision.name}`}>
          <img src={revision.image} alt={revision.name} />
          <span><b>{revision.name}</b><small>{new Date(revision.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} {index === 0 ? '· 最近保存' : ''}</small></span>
        </button>
        <button className="revision-delete" disabled={disabled} onClick={() => onDelete(revision)} title="删除此版本，不影响当前画稿" aria-label={`删除版本：${revision.name}`}>删除</button>
      </div>)}
    </div>
  </section>
}
