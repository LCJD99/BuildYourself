'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  evidenceLevels,
  nodes,
  type Evidence,
  type EvidenceAssessment,
  type EvidenceNodeId,
  type EvidenceSnapshot,
  type MinimumEvidenceLevel,
  type NodeId,
  type Result,
  type TaskExecution,
} from '@/lib/model';

type Graph = {
  evidence: Evidence[];
  results: Array<Result & {
    method?: '规则核验' | 'Agent 汇总';
    reasoning?: string;
    confirmationRequired?: boolean;
    confirmationRequirement?: string;
    canConfirm?: boolean;
    confirmedAt?: string | null;
  }>;
  assessments: Record<EvidenceNodeId, EvidenceAssessment>;
  requirements: Record<EvidenceNodeId, MinimumEvidenceLevel>;
  taskExecution: TaskExecution;
  changes: Array<{
    id: string;
    eventType: 'milestone.confirmed' | 'evidence.corrected';
    entityId: string;
    summary: string;
    createdAt: string;
    evidenceIds: string[];
    resultChanges: Array<{ nodeId: EvidenceNodeId; title: string; beforeStatus: string; afterStatus: string; beforeGap: string; afterGap: string; beforeDetail: string; afterDetail: string }>;
    confirmationInvalidated: boolean;
  }>;
  context: NodeId;
};

const labels: Record<NodeId, string> = { goal: '目标', task: '任务', milestone: '里程碑' };
const requirementLevels: MinimumEvidenceLevel[] = ['E0', 'E1', 'E2', 'E3'];
const revisionFields: Array<{ key: keyof EvidenceSnapshot; label: string }> = [
  { key: 'text', label: '证据原文' },
  { key: 'source', label: '来源' },
  { key: 'reference', label: '引用' },
  { key: 'observedAt', label: '证据时间' },
  { key: 'links', label: '关联对象' },
  { key: 'level', label: '证据等级' },
  { key: 'reportSubmitted', label: '报告是否已提交' },
  { key: 'benchmarkComplete', label: '完整基准测试' },
  { key: 'latencyMs', label: '实测延迟（ms）' },
];

function date(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

function dateTimeInput(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '';
  parsed.setMinutes(parsed.getMinutes() - parsed.getTimezoneOffset());
  return parsed.toISOString().slice(0, 16);
}

function revisionValue(key: keyof EvidenceSnapshot, value: EvidenceSnapshot[keyof EvidenceSnapshot]) {
  if (value === null) return '未说明';
  if (key === 'links' && Array.isArray(value)) return value.map(id => labels[id as NodeId]).join('、');
  if (key === 'reportSubmitted' || key === 'benchmarkComplete') return value ? '是' : '否';
  if (key === 'observedAt' && typeof value === 'string') return date(value);
  return String(value);
}

export default function Workspace() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [selection, setSelected] = useState<NodeId | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [editingEvidence, setEditingEvidence] = useState<string | null>(null);
  const [evidenceDraft, setEvidenceDraft] = useState<Evidence | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/graph', { cache: 'no-store' });
      if (!response.ok) throw Error();
      const data: Graph = await response.json();
      setGraph(data);
      setError('');
    } catch {
      setError('无法读取本地图谱，请检查应用服务。');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function select(id: NodeId) {
    setSelected(id);
    try {
      const response = await fetch('/api/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) throw Error();
    } catch {
      setError('当前对象未能同步到 pi，请重试。');
    }
  }

  async function saveExecution(completed: boolean) {
    setSaving(true);
    try {
      const response = await fetch('/api/execution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || '无法保存执行状态');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存执行状态');
    } finally {
      setSaving(false);
    }
  }

  async function saveRequirement(nodeId: EvidenceNodeId, minimumEvidenceLevel: MinimumEvidenceLevel) {
    setSaving(true);
    try {
      const response = await fetch('/api/evidence-requirement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, minimumEvidenceLevel }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || '无法保存证据要求');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存证据要求');
    } finally {
      setSaving(false);
    }
  }

  function beginEvidenceEdit(evidence: Evidence) {
    setEditingEvidence(evidence.id);
    setEvidenceDraft({ ...evidence, observedAt: dateTimeInput(evidence.observedAt) });
    setError('');
  }

  function updateEvidenceDraft(update: Partial<Evidence>) {
    setEvidenceDraft(currentDraft => currentDraft ? { ...currentDraft, ...update } : currentDraft);
  }

  async function correctEvidence(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!evidenceDraft) return;
    if (!evidenceDraft.links.length) {
      setError('请至少保留一个关联对象。');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/evidence', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...evidenceDraft, observedAt: new Date(evidenceDraft.observedAt).toISOString() }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw Error(result.error || '无法更正证据');
      setEditingEvidence(null);
      setEvidenceDraft(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法更正证据');
    } finally {
      setSaving(false);
    }
  }

  function cancelEvidenceEdit() {
    setEditingEvidence(null);
    setEvidenceDraft(null);
    setError('');
  }

  async function confirmMilestone() {
    setConfirming(true);
    try {
      const response = await fetch('/api/milestone-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'milestone' }),
      });
      const result = await response.json() as { created?: boolean; error?: string };
      if (!response.ok) throw Error(result.error || '无法确认里程碑');
      if (result.created) {
        setCelebrating(true);
        window.setTimeout(() => setCelebrating(false), 1100);
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法确认里程碑');
    } finally {
      setConfirming(false);
    }
  }

  const selected = selection ?? graph?.context ?? 'task';
  const current = nodes.find(node => node.id === selected)!;
  const results = graph?.results ?? [];
  const visible = graph?.evidence.filter(evidence => selected === 'goal' || evidence.links.includes(selected)) ?? [];
  const assessment = selected === 'task' || selected === 'milestone' ? graph?.assessments[selected] : null;

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brandmark">✳</span>
          <div><strong>BuildYourself</strong><small>个人执行空间</small></div>
        </div>
        <div className="nav-label">工作空间 <span>01</span></div>
        <button className="nav-home" onClick={() => void select('goal')}>◈ <span>目标全景</span></button>
        <div className="tree-label">我的目标 <span>⌄</span></div>
        <div className="tree">
          {nodes.map((node, index) => (
            <button key={node.id} className={`${selected === node.id ? 'active ' : ''}${index ? 'child' : ''}`} onClick={() => void select(node.id)}>
              <span className="node-icon">{index === 0 ? '◉' : index === 1 ? '□' : '◇'}</span>
              <span>{node.title}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom"><span className="online" /> 本地个人空间 <small>数据保存在本机</small></div>
      </aside>

      <section className="center">
        <header className="topbar"><span>工作空间 <b>/</b> {current.type}</span><span className="top-right">◷ &nbsp; 本地原型</span></header>
        <div className="content">
          <div className="eyebrow"><span className="dot" /> {current.type}概览 <span className="muted"> / &nbsp; EXECUTION SPACE</span></div>
          <h1>{current.title}</h1>
          <p className="lead">{current.description}</p>
          <div className="meta">
            <span>◉ &nbsp; 活跃中</span><span>◇ &nbsp; 1 个里程碑</span><span>◷ &nbsp; {graph?.evidence.length ?? 0} 条证据</span>
          </div>

          {selected === 'task' && (
            <section className="execution-panel" aria-labelledby="execution-title">
              <div className="execution-copy">
                <span className="kicker">TASK EXECUTION</span>
                <h2 id="execution-title">执行记录</h2>
                {graph?.taskExecution.completedAt ? (
                  <p><span className="execution-status complete">执行已完成</span> 记录时间：{date(graph.taskExecution.completedAt)}</p>
                ) : (
                  <p><span className="execution-status pending">尚未记录完成</span> 标记后会保存实际执行时间。</p>
                )}
                <small>执行状态与证据充足度分别记录；完成操作不会自动改变里程碑判定。</small>
              </div>
              <button className={graph?.taskExecution.completedAt ? 'secondary-button' : 'primary-button'} disabled={saving} onClick={() => void saveExecution(!graph?.taskExecution.completedAt)}>
                {saving ? '保存中…' : graph?.taskExecution.completedAt ? '撤销完成记录' : '标记已完成'}
              </button>
            </section>
          )}

          <div className="divider" />
          <div className="section-title">
            <div><span className="kicker">YOUR PROGRESS</span><h2>{selected === 'goal' ? '目标地图' : '关联对象'}</h2></div>
            <span className="subtle">选择节点查看详情 ↗</span>
          </div>
          <div className="map">
            {nodes.filter(node => node.id !== selected).map(node => (
              <button className="map-item" key={node.id} onClick={() => void select(node.id)}>
                <span className="map-icon">{node.type === '任务' ? '□' : node.type === '目标' ? '◉' : '◇'}</span>
                <span><small>{node.type}</small><strong>{node.title}</strong><em>{node.description}</em></span>
                <span className="arrow">↗</span>
              </button>
            ))}
          </div>

          <div className="section-title evidence-heading">
            <div><span className="kicker">THE EVIDENCE</span><h2>近期证据 <span className="count">{visible.length}</span></h2></div>
            <span className="subtle">按记录时间排列</span>
          </div>
          {error && <p role="alert" className="error">{error}</p>}
          {visible.length === 0 ? (
            <div className="empty"><span>✳</span><strong>还没有证据</strong><p>在 pi 中使用 /evidence 记录一次反馈。<br />你可以把它关联到任务和里程碑。</p></div>
          ) : (
            <div className="evidence-list">
              {visible.map(evidence => (
                <article key={evidence.id}>
                  {editingEvidence === evidence.id && evidenceDraft ? (
                    <form className="evidence-edit" onSubmit={event => void correctEvidence(event)}>
                      <div className="evidence-edit-heading"><strong>更正证据</strong><span>保留原记录身份，并重新判定所有关联对象。</span></div>
                      <label>证据原文<textarea required rows={4} value={evidenceDraft.text} onChange={event => updateEvidenceDraft({ text: event.target.value })} /></label>
                      <div className="evidence-edit-grid">
                        <label>来源<input required value={evidenceDraft.source} onChange={event => updateEvidenceDraft({ source: event.target.value })} /></label>
                        <label>引用<input required value={evidenceDraft.reference} onChange={event => updateEvidenceDraft({ reference: event.target.value })} /></label>
                        <label>证据时间<input required type="datetime-local" value={evidenceDraft.observedAt} onChange={event => updateEvidenceDraft({ observedAt: event.target.value })} /></label>
                        <label>证据等级<select value={evidenceDraft.level} onChange={event => updateEvidenceDraft({ level: event.target.value as Evidence['level'] })}>
                          {(['E1', 'E2', 'E3'] as const).map(level => <option key={level} value={level}>{level} · {evidenceLevels[level].title}</option>)}
                        </select></label>
                      </div>
                      <fieldset className="evidence-links"><legend>关联对象</legend>
                        {nodes.map(node => <label key={node.id}><input type="checkbox" checked={evidenceDraft.links.includes(node.id)} onChange={event => updateEvidenceDraft({ links: event.target.checked ? [...evidenceDraft.links, node.id] : evidenceDraft.links.filter(id => id !== node.id) })} />{node.type}：{node.title}</label>)}
                      </fieldset>
                      <div className="evidence-edit-grid">
                        {evidenceDraft.links.includes('task') && <label>报告是否已提交<select value={evidenceDraft.reportSubmitted === null ? 'unknown' : evidenceDraft.reportSubmitted ? 'yes' : 'no'} onChange={event => updateEvidenceDraft({ reportSubmitted: event.target.value === 'unknown' ? null : event.target.value === 'yes' })}><option value="unknown">证据未说明</option><option value="yes">是</option><option value="no">否</option></select></label>}
                        {evidenceDraft.links.includes('milestone') && <>
                          <label>是否完成完整基准测试<select value={evidenceDraft.benchmarkComplete === null ? 'unknown' : evidenceDraft.benchmarkComplete ? 'yes' : 'no'} onChange={event => updateEvidenceDraft({ benchmarkComplete: event.target.value === 'unknown' ? null : event.target.value === 'yes' })}><option value="unknown">证据未说明</option><option value="yes">是</option><option value="no">否</option></select></label>
                          <label>实测延迟（ms）<input type="number" min="0" step="any" value={evidenceDraft.latencyMs ?? ''} onChange={event => updateEvidenceDraft({ latencyMs: event.target.value === '' ? null : Number(event.target.value) })} /></label>
                        </>}
                      </div>
                      <div className="evidence-edit-actions"><button type="button" className="secondary-button" disabled={saving} onClick={cancelEvidenceEdit}>取消</button><button type="submit" className="primary-button" disabled={saving}>{saving ? '保存中…' : '保存更正并重判'}</button></div>
                    </form>
                  ) : <>
                    <div className="evidence-top">
                      <span>{evidence.level} · {evidenceLevels[evidence.level].title} · {evidenceLevels[evidence.level].trust}{Boolean(evidence.revisionCount) && <em className="corrected-badge">已更正 {evidence.revisionCount} 次</em>}</span>
                      <div className="evidence-actions"><time>{date(evidence.observedAt)}</time><button type="button" className="edit-evidence-button" aria-label={`更正证据：${evidence.reference}`} onClick={() => beginEvidenceEdit(evidence)}>更正</button></div>
                    </div>
                    {Boolean(evidence.lastCorrectedAt) && <div className="evidence-revision-time">最近更正：{date(evidence.lastCorrectedAt!)}</div>}
                    <p>{evidence.text}</p>
                    <div className="evidence-foot">来源：{evidence.source} · 引用：{evidence.reference}</div>
                    <div className="tags">{evidence.links.map(id => <span key={id}>{labels[id]}</span>)}</div>
                    {Boolean(evidence.revisions?.length) && <details className="evidence-history">
                      <summary>查看更正记录（{evidence.revisions!.length}）</summary>
                      <ol>{evidence.revisions!.map((revision, revisionIndex) => {
                        const changedFields = revisionFields.filter(({ key }) => JSON.stringify(revision.before[key]) !== JSON.stringify(revision.after[key]));
                        return <li key={`${revision.changedAt}-${revisionIndex}`}>
                          <time>{date(revision.changedAt)}</time>
                          {changedFields.map(({ key, label }) => <p key={key}><strong>{label}</strong><span>原：{revisionValue(key, revision.before[key])}</span><span>更正为：{revisionValue(key, revision.after[key])}</span></p>)}
                        </li>;
                      })}</ol>
                    </details>}
                  </>}
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <aside className="detail">
        <div className="detail-top"><span>结果与依据</span><span>✳</span></div>
        <div className="detail-content">
          <div className="detail-overline">CURRENT VIEW</div>
          <h2>{current.title}</h2>
          <p className="detail-intro">执行记录、证据充足度和结果判定分别展示。</p>
          <div className="detail-divider" />

          {assessment && (
            <section className="assessment-card" aria-labelledby="assessment-title">
              <div className="result-label"><span>证据要求</span><span>◈</span></div>
              <label htmlFor="minimum-evidence" id="assessment-title">最低证据等级</label>
              <select id="minimum-evidence" value={graph?.requirements[selected as EvidenceNodeId] ?? 'E1'} disabled={saving} onChange={event => void saveRequirement(selected as EvidenceNodeId, event.target.value as MinimumEvidenceLevel)}>
                {requirementLevels.map(level => <option key={level} value={level}>{level} · {evidenceLevels[level].title}</option>)}
              </select>
              <div className={`status ${assessment.status === '证据充足' || assessment.status === '无需证据' ? 'success' : 'neutral'}`}><span>●</span> {assessment.status}</div>
              <p>{assessment.summary}</p>
              <dl>
                <dt>最低要求</dt><dd>{assessment.requiredLevel} · {evidenceLevels[assessment.requiredLevel].title}（{evidenceLevels[assessment.requiredLevel].trust}）</dd>
                <dt>当前最高</dt><dd>{assessment.highestLevel ? `${assessment.highestLevel} · ${evidenceLevels[assessment.highestLevel].title}（${evidenceLevels[assessment.highestLevel].trust}）` : '暂无关联证据'}</dd>
                <dt>证据缺口</dt><dd>{assessment.gap}</dd>
              </dl>
            </section>
          )}

          {results.map((result, index) => {
            const isMilestone = index === 1;
            return (
              <article className={`result${isMilestone && celebrating ? ' celebrating' : ''}`} key={result.title}>
                <div className="result-label"><span>{index === 0 ? '01' : '02'} / {result.title}</span><span>{index === 0 ? '□' : '◇'}</span></div>
                <div className={`status ${result.tone}`} aria-live="polite"><span>●</span> {result.status}</div>
                <p>{result.detail}</p>
                <dl>
                  <dt>判定标准</dt><dd>{result.standard}</dd>
                  <dt>证据来源</dt><dd>{result.evidence.length ? result.evidence.map(evidence => `${evidence.level} ${evidence.source}（${evidence.reference}）`).join('；') : '暂无关联证据'}</dd>
                  <dt>判定缺口</dt><dd>{result.gap}</dd>
                  {isMilestone && <><dt>判定方式</dt><dd>{result.method ?? '规则核验'}</dd><dt>判定理由</dt><dd>{result.reasoning ?? result.detail}</dd><dt>确认要求</dt><dd>{result.confirmationRequirement ?? '达到标准后由用户核对并确认。'}</dd></>}
                </dl>
                {isMilestone && selected === 'milestone' && result.canConfirm && (
                  <button className="primary-button confirm-button" disabled={confirming} onClick={() => void confirmMilestone()}>
                    {confirming ? '保存确认…' : '确认里程碑达成'}
                  </button>
                )}
                {isMilestone && result.status === '已确认达成' && result.confirmedAt && (
                  <p className="confirmed-at">已于 {date(result.confirmedAt)} 确认达成</p>
                )}
              </article>
            );
          })}
          <section className="change-log" aria-labelledby="change-log-title">
            <div className="result-label"><h3 id="change-log-title">变更记录</h3><span>{graph?.changes.length ?? 0}</span></div>
            {graph?.changes.length ? (
              <ul>{graph.changes.map(change => <li key={change.id}>
                <span>{change.summary}</span>
                {change.resultChanges.map(result => <div className="change-outcome" key={result.nodeId}>
                  <strong>{result.title}：{result.beforeStatus} → {result.afterStatus}</strong>
                  {result.beforeDetail !== result.afterDetail && <span>判定说明：{result.beforeDetail} → {result.afterDetail}</span>}
                  {result.beforeGap !== result.afterGap && <span>判定缺口：{result.beforeGap} → {result.afterGap}</span>}
                  {result.beforeGap === result.afterGap && <span>判定缺口：{result.afterGap}</span>}
                </div>)}
                {change.eventType === 'evidence.corrected' && !change.resultChanges.length && <span className="change-outcome">关联对象的结论与缺口没有变化。</span>}
                {change.confirmationInvalidated && <span className="confirmation-reset">原里程碑确认已撤销，请重新核对并确认。</span>}
                <time>{date(change.createdAt)}</time>
              </li>)}</ul>
            ) : <p>尚无证据更正或里程碑确认记录。</p>}
          </section>
          <div className="hint"><span>✳</span><p><strong>执行完成与目标进展分开判断</strong><br />保存行动完成不会自动提高能力或里程碑判定。</p></div>
        </div>
      </aside>
    </main>
  );
}
