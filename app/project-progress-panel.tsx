'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { GoalPlanAction, GoalProject } from '@/lib/goal-plans';
import { deriveProjectProgress, type ProjectProgressModel, type ProjectProgressObservation, type ProjectProgressView } from '@/lib/project-progress';
import type { ProjectDeliverable } from '@/lib/project-deliverables';

const viewLabels: Record<ProjectProgressView, string> = {
  evidence: '证据概览',
  milestones: '里程碑进展',
  trend: '观测趋势',
  deliverables: '固定交付进度',
};

function formatDateTime(value: string | null) {
  if (!value) return '暂无更新时间';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
    : '时间格式无效';
}

function EvidenceLevelCounts({ model }: { model: ProjectProgressModel }) {
  return <p className="project-progress-quality">{model.evidence.qualityLabel} · {model.evidence.qualityDetail}</p>;
}

function TrendChart({ observations }: { observations: ProjectProgressObservation[] }) {
  if (!observations.length) return <p className="project-progress-gap">没有符合条件的完整延迟测量。</p>;
  if (observations.length === 1) {
    const observation = observations[0];
    return <div className="project-trend-single">
      <strong>{observation.value} ms</strong>
      <span>{formatDateTime(observation.observedAt)} · {observation.level} · {observation.source}</span>
      <small>{observation.reference}</small>
    </div>;
  }

  const values = observations.map(item => item.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = 640;
  const height = 200;
  const points = observations.map((item, index) => {
    const x = observations.length === 1 ? width / 2 : 38 + (index / (observations.length - 1)) * (width - 76);
    const y = max === min ? height / 2 : height - 38 - ((item.value - min) / (max - min)) * (height - 76);
    return { ...item, x, y };
  });
  return <>
    <div className="project-trend-chart-wrap">
      <svg className="project-trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="按观测时间排列的完整基准延迟实测值，单位毫秒">
        <line x1="38" x2={width - 38} y1={height - 30} y2={height - 30} />
        <polyline points={points.map(point => `${point.x},${point.y}`).join(' ')} />
        {points.map((point, index) => <g key={point.id}>
          <circle cx={point.x} cy={point.y} r="4" />
          <text x={point.x} y={point.y - 10} textAnchor="middle">{point.value} ms</text>
          {(index === 0 || index === points.length - 1) && <text className="project-trend-date" x={point.x} y={height - 10} textAnchor={index === 0 ? 'start' : 'end'}>{new Date(point.observedAt).toLocaleDateString('zh-CN')}</text>}
        </g>)}
      </svg>
    </div>
    <ul className="project-trend-observations">{observations.map(item => <li key={item.id}>
      <strong>{item.value} ms</strong><span>{formatDateTime(item.observedAt)} · {item.level} · {item.source}</span><small>{item.reference}</small>
    </li>)}</ul>
  </>;
}

export default function ProjectProgressPanel({ project, actions }: { project: GoalProject; actions: GoalPlanAction[] }) {
  const [deliverables, setDeliverables] = useState<ProjectDeliverable[]>([]);
  const [deliverableTitle, setDeliverableTitle] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<ProjectProgressView>('evidence');
  const model = deriveProjectProgress(project, actions, deliverables);

  useEffect(() => {
    let current = true;
    void fetch(`/api/projects/${encodeURIComponent(project.id)}/deliverables`)
      .then(async response => {
        const payload = await response.json() as { deliverables?: ProjectDeliverable[]; error?: string };
        if (!response.ok) throw new Error(payload.error || '无法读取项目交付物');
        if (current) setDeliverables(payload.deliverables ?? []);
      })
      .catch(cause => { if (current) setError(cause instanceof Error ? cause.message : '无法读取项目交付物'); });
    return () => { current = false; };
  }, [project.id]);

  async function saveDeliverables(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<boolean> {
    setBusyId(path);
    setError('');
    try {
      const response = await fetch(path, {
        method,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
      const payload = await response.json() as { deliverables?: ProjectDeliverable[]; error?: string };
      if (!response.ok) throw new Error(payload.error || '无法保存项目交付物');
      setDeliverables(payload.deliverables ?? []);
      setEditingId(null);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存项目交付物');
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function addDeliverable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = deliverableTitle.trim();
    if (!title) return;
    if (await saveDeliverables(`/api/projects/${encodeURIComponent(project.id)}/deliverables`, 'POST', { title })) setDeliverableTitle('');
  }

  return <section className="project-progress" aria-labelledby="project-progress-title">
    <div className="project-progress-heading">
      <div><span className="kicker">PROJECT PROGRESS</span><h3 id="project-progress-title">项目进展视图</h3></div>
      <span className="project-progress-count">{model.evidence.count} 条关联证据</span>
    </div>
    <div className="project-progress-meta">
      <div><span>证据来源</span><strong>{model.evidence.sources.length ? model.evidence.sources.join('、') : '暂无'}</strong></div>
      <div><span>证据更新时间</span><strong>{formatDateTime(model.evidence.updatedAt)}</strong></div>
      <EvidenceLevelCounts model={model} />
    </div>
    <div className="project-progress-tabs" role="group" aria-label="选择项目进展视图">
      {(['evidence', 'milestones', 'trend', 'deliverables'] as const).map(option => <button key={option} type="button" aria-pressed={view === option} onClick={() => setView(option)}>{viewLabels[option]}</button>)}
    </div>
    <p className="project-progress-view-label">当前视图：{viewLabels[view]}</p>

    {view === 'evidence' && <div className="project-progress-evidence">
      {project.evidence.length ? project.evidence.map(item => <article key={item.id}>
        <div><strong>{item.reference}</strong><span>{item.level} · {item.source} · 观测于 {formatDateTime(item.observedAt)}</span></div>
        <p>{item.text}</p>
      </article>) : <p className="project-progress-gap">尚无明确关联到此项目的证据；普通外部日程和未关联记录不会计入项目历史。</p>}
    </div>}

    {view === 'milestones' && <div className="project-progress-milestones">
      {model.milestones.length ? model.milestones.map(milestone => {
        const linkedEvidence = project.evidence.filter(item => milestone.evidenceIds.includes(item.id));
        return <article key={`${milestone.goalPlanId}:${milestone.id}`}>
          <header><span>{milestone.goalTitle} · {milestone.stage === 'near' ? '近期' : '远期'}</span><strong>{milestone.title}</strong></header>
          {milestone.successCriteria && <p><b>成功标准</b>：{milestone.successCriteria}</p>}
          {milestone.evidenceRequirement && <p><b>证据要求</b>：{milestone.evidenceRequirement}</p>}
          <p className="project-progress-status">{milestone.evidenceStatus}</p>
          <p className="project-progress-gap">{milestone.gap}</p>
          {linkedEvidence.map(item => <div className="project-progress-linked-evidence" key={item.id}>
            <strong>{item.reference}</strong><span>{item.level} · {item.source} · {formatDateTime(item.observedAt)}</span><p>{item.text}</p>
          </div>)}
        </article>;
      }) : <p className="project-progress-gap">项目没有显式关联的目标里程碑。</p>}
    </div>}

    {view === 'trend' && <div className="project-progress-trend">
      <h4>完整基准延迟观测（ms）</h4>
      <TrendChart observations={model.trend.observations} />
      {model.trend.firstToLastDeltaMs !== null && <p className="project-progress-delta">首末观测差：{model.trend.firstToLastDeltaMs > 0 ? '+' : ''}{model.trend.firstToLastDeltaMs} ms</p>}
      <p className="project-progress-gap">{model.trend.gap}</p>
    </div>}

    {view === 'deliverables' && <div className="project-progress-deliverables">
      <div className="project-progress-deliverables-head">
        <div><h4>固定交付物清单</h4><p>分母只包含此处明确保存的交付物；共享任务和证据数量不会改变进度。</p></div>
        {model.deliverables.available && <strong>{model.deliverables.completed} / {model.deliverables.total} · {model.deliverables.percent}%</strong>}
      </div>
      {model.deliverables.available && <div className="project-deliverables-meter" role="progressbar" aria-label="固定交付物完成进度" aria-valuemin={0} aria-valuemax={model.deliverables.total} aria-valuenow={model.deliverables.completed} aria-valuetext={`${model.deliverables.completed}/${model.deliverables.total} 项，${model.deliverables.percent}%`}>
        <span style={{ width: `${model.deliverables.percent}%` }} />
      </div>}
      {!model.deliverables.available && <p className="project-progress-gap">{model.deliverables.reason}</p>}
      <ul className="project-progress-deliverable-list">{deliverables.map(item => <li key={item.id}>
        <label><input type="checkbox" checked={item.completed} disabled={Boolean(busyId)} onChange={event => void saveDeliverables(`/api/projects/${encodeURIComponent(project.id)}/deliverables/${encodeURIComponent(item.id)}`, 'PATCH', { completed: event.target.checked })} />
          {editingId === item.id ? <input aria-label="交付物名称" maxLength={240} value={editingTitle} onChange={event => setEditingTitle(event.target.value)} /> : <span className={item.completed ? 'completed-deliverable' : ''}>{item.title}</span>}
        </label>
        {editingId === item.id ? <div><button type="button" disabled={Boolean(busyId)} onClick={() => void saveDeliverables(`/api/projects/${encodeURIComponent(project.id)}/deliverables/${encodeURIComponent(item.id)}`, 'PATCH', { title: editingTitle })}>保存名称</button><button type="button" onClick={() => setEditingId(null)}>取消</button></div> : <div><button type="button" disabled={Boolean(busyId)} onClick={() => { setEditingId(item.id); setEditingTitle(item.title); }}>编辑</button><button type="button" disabled={Boolean(busyId)} onClick={() => void saveDeliverables(`/api/projects/${encodeURIComponent(project.id)}/deliverables/${encodeURIComponent(item.id)}`, 'DELETE')}>删除</button></div>}
      </li>)}</ul>
      <form className="project-progress-add-deliverable" onSubmit={addDeliverable}>
        <label htmlFor="project-progress-deliverable-title">添加固定交付物</label>
        <input id="project-progress-deliverable-title" maxLength={240} value={deliverableTitle} onChange={event => setDeliverableTitle(event.target.value)} placeholder="例如：验收报告" />
        <button type="submit" disabled={Boolean(busyId) || !deliverableTitle.trim()}>添加到分母</button>
      </form>
    </div>}

    {view !== 'deliverables' && <p className="project-progress-rule-note">观测视图没有可适用的结构化项目判定规则，因此只展示观测值与证据等级，不自动判断达标。</p>}
    {error && <p className="project-progress-error" role="alert">{error}</p>}
  </section>;
}
