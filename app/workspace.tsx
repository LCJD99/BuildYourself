'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  evidenceLevels,
  nodes,
  type Evidence,
  type EvidenceAssessment,
  type EvidenceNodeId,
  type MinimumEvidenceLevel,
  type NodeId,
  type Result,
  type TaskExecution,
} from '@/lib/model';

type Graph = {
  evidence: Evidence[];
  results: Result[];
  assessments: Record<EvidenceNodeId, EvidenceAssessment>;
  requirements: Record<EvidenceNodeId, MinimumEvidenceLevel>;
  taskExecution: TaskExecution;
  context: NodeId;
};

const labels: Record<NodeId, string> = { goal: '目标', task: '任务', milestone: '里程碑' };
const requirementLevels: MinimumEvidenceLevel[] = ['E0', 'E1', 'E2', 'E3'];

function date(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

export default function Workspace() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [selection, setSelected] = useState<NodeId | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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
                  <div className="evidence-top"><span>{evidence.level} · {evidenceLevels[evidence.level].title} · {evidenceLevels[evidence.level].trust}</span><time>{date(evidence.observedAt)}</time></div>
                  <p>{evidence.text}</p>
                  <div className="evidence-foot">来源：{evidence.source} · 引用：{evidence.reference}</div>
                  <div className="tags">{evidence.links.map(id => <span key={id}>{labels[id]}</span>)}</div>
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

          {results.map((result, index) => (
            <article className="result" key={result.title}>
              <div className="result-label"><span>{index === 0 ? '01' : '02'} / {result.title}</span><span>{index === 0 ? '□' : '◇'}</span></div>
              <div className={`status ${result.tone}`}><span>●</span> {result.status}</div>
              <p>{result.detail}</p>
              <dl>
                <dt>判定标准</dt><dd>{result.standard}</dd>
                <dt>证据来源</dt><dd>{result.evidence.length ? result.evidence.map(evidence => `${evidence.level} ${evidence.source}（${evidence.reference}）`).join('；') : '暂无关联证据'}</dd>
                <dt>判定缺口</dt><dd>{result.gap}</dd>
              </dl>
            </article>
          ))}
          <div className="hint"><span>✳</span><p><strong>执行完成与目标进展分开判断</strong><br />保存行动完成不会自动提高能力或里程碑判定。</p></div>
        </div>
      </aside>
    </main>
  );
}
