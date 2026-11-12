'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { GoalPlanAction, GoalProject } from '@/lib/goal-plans';
import { deriveProjectProgress, type ProjectProgressModel, type ProjectProgressObservation, type ProjectProgressView } from '@/lib/project-progress';
import type { ProjectDeliverable } from '@/lib/project-deliverables';
import type { ProjectMeasurementSeries } from '@/lib/project-measurement-series';
import { latencyChartGeometry } from '@/lib/project-progress-visuals';

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
      <p>{observation.text}</p>
    </div>;
  }

  const geometry = latencyChartGeometry(observations);
  if (!geometry) return <p className="project-progress-gap">至少需要两次已确认可比较的观测才能绘制趋势。</p>;
  const { width, height, plot, plotWidth, minMs, maxMs, timeScale, xAxisLabel, yTicks, points } = geometry;
  const hasDistinctTimes = timeScale === 'timestamp';
  const chartDescription = `共 ${observations.length} 条已确认可比较的完整基准延迟观测，单位毫秒。纵轴显示实际观测值；横轴${hasDistinctTimes ? '按实际观测时间缩放' : '由于观测时间相同，使用等距记录顺序'}。`;
  return <>
    <figure className="project-trend-figure">
      <div className="project-trend-chart-wrap">
        <svg className="project-trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="project-trend-chart-title project-trend-chart-description">
        <title id="project-trend-chart-title">完整基准延迟趋势图</title>
        <desc id="project-trend-chart-description">{chartDescription}</desc>
        {yTicks.map(tick => <g key={`${tick.value}-${tick.y}`}>
          <line className="project-trend-gridline" x1={plot.left} x2={width - plot.right} y1={tick.y} y2={tick.y} />
          <text className="project-trend-tick" x={plot.left - 8} y={tick.y + 4} textAnchor="end">{tick.value}</text>
        </g>)}
        <line className="project-trend-axis" x1={plot.left} x2={plot.left} y1={plot.top} y2={height - plot.bottom} />
        <line className="project-trend-axis" x1={plot.left} x2={width - plot.right} y1={height - plot.bottom} y2={height - plot.bottom} />
        <polyline points={points.map(point => `${point.x},${point.y}`).join(' ')} />
        {points.map((point, index) => <g key={point.id}>
          <title>{`${formatDateTime(point.observedAt)} · ${point.value} ms · ${point.source} · ${point.reference}`}</title>
          <circle cx={point.x} cy={point.y} r="4" />
          {(points.length <= 8 || index === 0 || index === points.length - 1) && <text className="project-trend-point-label" x={point.x} y={point.y - 9} textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}>{point.value}</text>}
        </g>)}
        <text className="project-trend-axis-label" x="18" y={plot.top + geometry.plotHeight / 2} textAnchor="middle" transform={`rotate(-90 18 ${plot.top + geometry.plotHeight / 2})`}>实测延迟（ms）</text>
        <text className="project-trend-axis-label" x={plot.left + plotWidth / 2} y={height - 6} textAnchor="middle">{xAxisLabel}</text>
        <text className="project-trend-date" x={plot.left} y={height - plot.bottom + 18} textAnchor="start">{new Date(observations[0].observedAt).toLocaleDateString('zh-CN')}</text>
        <text className="project-trend-date" x={width - plot.right} y={height - plot.bottom + 18} textAnchor="end">{new Date(observations[observations.length - 1].observedAt).toLocaleDateString('zh-CN')}</text>
        </svg>
      </div>
      <figcaption>纵轴范围为本序列实际观测最小值 {minMs} 至最大值 {maxMs} ms。仅绘制此已确认口径下的观测。{hasDistinctTimes ? '横向位置按真实观测时间缩放。' : '观测时间相同，横向等距仅区分记录，不代表时间间隔。'}</figcaption>
    </figure>
    <ul className="project-trend-observations">{observations.map(item => <li key={item.id}>
      <strong>{item.value} ms</strong><span>{formatDateTime(item.observedAt)} · {item.level} · {item.source}</span><small>{item.reference} · {item.text}</small>
    </li>)}</ul>
  </>;
}

function MilestoneMap({ model, project, contractVersions }: {
  model: ProjectProgressModel;
  project: GoalProject;
  contractVersions: Array<{ goalPlanId: string; version: number | null }>;
}) {
  const stages = [
    { id: 'near', label: '近期' },
    { id: 'future', label: '远期' },
  ] as const;
  return <div className="project-milestone-map" role="group" aria-label="按当前目标契约阶段分组的项目里程碑图">
    <p className="project-milestone-map-note">只展示项目明确关联的当前里程碑；同一阶段内的排列不代表日期、依赖或完成度。</p>
    <div className="project-milestone-lanes">{stages.map(stage => {
      const milestones = model.milestones.filter(item => item.stage === stage.id);
      return <section className="project-milestone-lane" key={stage.id} aria-labelledby={`project-milestone-lane-${stage.id}`}>
        <header><h4 id={`project-milestone-lane-${stage.id}`}>{stage.label}</h4><span>{milestones.length} 项</span></header>
        {milestones.length ? <ul>{milestones.map(milestone => {
          const linkedEvidence = project.evidence.filter(item => milestone.evidenceIds.includes(item.id));
          const contractVersion = contractVersions.find(item => item.goalPlanId === milestone.goalPlanId)?.version ?? null;
          return <li key={`${milestone.goalPlanId}:${milestone.id}`}>
            <span className="project-milestone-map-marker" aria-hidden="true" />
            <article>
              <header><span>{milestone.goalTitle} · 当前契约 {contractVersion === null ? '版本未知' : `V${contractVersion}`}</span><strong>{milestone.title}</strong></header>
              {milestone.successCriteria && <p><b>当前契约标准</b>：{milestone.successCriteria}</p>}
              {milestone.evidenceRequirement && <p><b>证据要求</b>：{milestone.evidenceRequirement}</p>}
              <p className="project-progress-version-note">当前契约标准只作当前参考；本视图不会用它回判历史观测。</p>
              <p className="project-progress-status">{milestone.evidenceStatus}</p>
              <p className="project-progress-gap">{milestone.gap}</p>
              {linkedEvidence.map(item => <div className="project-progress-linked-evidence" key={item.id}>
                <strong>{item.reference}</strong><span>{item.level} · {item.source} · {formatDateTime(item.observedAt)}</span><p>{item.text}</p>
              </div>)}
            </article>
          </li>;
        })}</ul> : <p className="project-progress-gap">当前契约未记录此阶段的显式里程碑。</p>}
      </section>;
    })}</div>
  </div>;
}

export default function ProjectProgressPanel({ project, actions, contractVersions }: {
  project: GoalProject;
  actions: GoalPlanAction[];
  contractVersions: Array<{ goalPlanId: string; version: number | null }>;
}) {
  const [deliverables, setDeliverables] = useState<ProjectDeliverable[]>([]);
  const [measurementSeries, setMeasurementSeries] = useState<ProjectMeasurementSeries[]>([]);
  const [deliverableTitle, setDeliverableTitle] = useState('');
  const [seriesName, setSeriesName] = useState('');
  const [seriesBasis, setSeriesBasis] = useState('');
  const [confirmedComparable, setConfirmedComparable] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<ProjectProgressView>('evidence');
  const [selectedSeriesId, setSelectedSeriesId] = useState('');
  const model = deriveProjectProgress(project, actions, deliverables, measurementSeries);
  const selectedSeries = model.trend.series.find(item => item.id === selectedSeriesId);

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

  useEffect(() => {
    let current = true;
    void fetch(`/api/projects/${encodeURIComponent(project.id)}/measurement-series`)
      .then(async response => {
        const payload = await response.json() as { series?: ProjectMeasurementSeries[]; error?: string };
        if (!response.ok) throw new Error(payload.error || '无法读取比较序列');
        if (current) setMeasurementSeries(payload.series ?? []);
      })
      .catch(cause => { if (current) setError(cause instanceof Error ? cause.message : '无法读取比较序列'); });
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

  async function saveSeries(path: string, method: 'POST' | 'DELETE', body?: unknown): Promise<ProjectMeasurementSeries[] | null> {
    setBusyId(path);
    setError('');
    try {
      const response = await fetch(path, {
        method,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
      const payload = await response.json() as { series?: ProjectMeasurementSeries[]; error?: string };
      if (!response.ok) throw new Error(payload.error || '无法保存比较序列');
      const nextSeries = payload.series ?? [];
      setMeasurementSeries(nextSeries);
      return nextSeries;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存比较序列');
      return null;
    } finally {
      setBusyId(null);
    }
  }

  async function createSeries(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = seriesName.trim();
    if (!name || !seriesBasis.trim() || !confirmedComparable) return;
    const nextSeries = await saveSeries(`/api/projects/${encodeURIComponent(project.id)}/measurement-series`, 'POST', {
      name, basis: seriesBasis, confirmedComparable,
    });
    const created = nextSeries?.find(item => item.name === name);
    if (created) {
      setSelectedSeriesId(created.id);
      setSeriesName('');
      setSeriesBasis('');
      setConfirmedComparable(false);
    }
  }

  function assignObservation(observationId: string) {
    if (!selectedSeriesId) return;
    void saveSeries(`/api/projects/${encodeURIComponent(project.id)}/measurement-series/${encodeURIComponent(selectedSeriesId)}/evidence`, 'POST', { evidenceId: observationId });
  }

  function reconfirmObservation(seriesId: string, observationId: string) {
    void saveSeries(`/api/projects/${encodeURIComponent(project.id)}/measurement-series/${encodeURIComponent(seriesId)}/evidence`, 'POST', { evidenceId: observationId });
  }

  function removeObservation(seriesId: string, observationId: string) {
    void saveSeries(`/api/projects/${encodeURIComponent(project.id)}/measurement-series/${encodeURIComponent(seriesId)}/evidence/${encodeURIComponent(observationId)}`, 'DELETE');
  }

  function deleteSeries(seriesId: string) {
    void saveSeries(`/api/projects/${encodeURIComponent(project.id)}/measurement-series/${encodeURIComponent(seriesId)}`, 'DELETE');
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
      {model.milestones.length ? <MilestoneMap model={model} project={project} contractVersions={contractVersions} /> : <p className="project-progress-gap">项目没有显式关联的目标里程碑，因此没有可绘制的里程碑图。</p>}
    </div>}

    {view === 'trend' && <div className="project-progress-trend">
      <h4>延迟观测（ms）</h4>
      <p className="project-progress-series-note">默认每条测量单独展示。只有在填写并确认相同工作负载、测试环境和指标口径后，手动加入同一序列的记录才会进行对比。</p>
      <label className="project-progress-series-select">当前序列
        <select aria-label="选择已确认的可比较测量序列" value={selectedSeriesId} onChange={event => setSelectedSeriesId(event.target.value)}>
          <option value="">不比较观测</option>
          {model.trend.series.map(item => <option key={item.id} value={item.id}>{item.name} · {item.observations.length} 次有效测量</option>)}
        </select>
      </label>
      {selectedSeries && <div className="project-progress-selected-series">
        <div className="project-progress-series-heading"><div><strong>{selectedSeries.name}</strong><span>口径说明：{selectedSeries.basis}</span><small>用户确认时间：{formatDateTime(selectedSeries.confirmedComparableAt)}</small></div>
          <button type="button" disabled={Boolean(busyId)} onClick={() => deleteSeries(selectedSeries.id)}>删除此序列</button>
        </div>
        <TrendChart observations={selectedSeries.observations} />
        {selectedSeries.firstToLastDeltaMs !== null && <p className="project-progress-delta">同一已确认口径的首末观测差：{selectedSeries.firstToLastDeltaMs > 0 ? '+' : ''}{selectedSeries.firstToLastDeltaMs} ms</p>}
        {selectedSeries.gap && <p className="project-progress-gap">{selectedSeries.gap}</p>}
        {selectedSeries.excludedEvidence.length > 0 && <div className="project-progress-series-excluded"><strong>未参与趋势的已关联证据</strong>{selectedSeries.excludedEvidence.map(item => <article key={item.id}>
          <p>{item.reference} · {item.source}：{item.reason}</p><small>{item.text}</small>
          {item.canReconfirm && <button type="button" disabled={Boolean(busyId)} onClick={() => reconfirmObservation(selectedSeries.id, item.id)}>核对后重新确认</button>}
        </article>)}</div>}
        {selectedSeries.observations.map(item => <div className="project-progress-series-member" key={item.id}>
          <div><span>{item.reference} · {item.source} · {formatDateTime(item.observedAt)} · {item.level}</span><small>{item.text}</small></div>
          <button type="button" disabled={Boolean(busyId)} onClick={() => removeObservation(selectedSeries.id, item.id)}>移出序列</button>
        </div>)}
      </div>}
      {!selectedSeries && <p className="project-progress-gap">尚未选择比较序列；以下观测只逐条展示，不计算跨记录趋势或差值。</p>}
      <div className="project-progress-unassigned">
        <h5>未归入序列的单次观测</h5>
        {model.trend.unassignedObservations.length ? model.trend.unassignedObservations.map(item => <article key={item.id}>
          <div><strong>{item.value} ms · {item.reference}</strong><span>{item.source} · {item.level} · {formatDateTime(item.observedAt)}</span><small>{item.text}</small></div>
          <button type="button" disabled={Boolean(busyId) || !selectedSeriesId} onClick={() => assignObservation(item.id)}>确认同口径并加入</button>
        </article>) : <p className="project-progress-gap">没有未分组的完整延迟测量。</p>}
      </div>
      <form className="project-progress-series-form" onSubmit={event => void createSeries(event)}>
        <h5>建立可比较序列</h5>
        <label>序列名称<input required maxLength={100} value={seriesName} onChange={event => setSeriesName(event.target.value)} placeholder="例如：工作负载 A / staging / v1" /></label>
        <label>比较口径说明<textarea required maxLength={1000} rows={2} value={seriesBasis} onChange={event => setSeriesBasis(event.target.value)} placeholder="说明工作负载、环境和指标定义为何相同" /></label>
        <label className="project-progress-confirm-comparable"><input type="checkbox" checked={confirmedComparable} onChange={event => setConfirmedComparable(event.target.checked)} />我确认将加入此序列的测量使用相同工作负载、测试环境和指标口径。</label>
        <button type="submit" disabled={Boolean(busyId) || !seriesName.trim() || !seriesBasis.trim() || !confirmedComparable}>创建已确认序列</button>
      </form>
      <p className="project-progress-gap">没有适用的结构化项目阈值。序列内差值只表示该口径下的数值变化，不代表达标或性能改善。</p>
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

    {view !== 'deliverables' && <p className="project-progress-rule-note">观测视图只展示实际观测值和证据等级；不以当前或历史目标契约标准回判这些观测。</p>}
    {error && <p className="project-progress-error" role="alert">{error}</p>}
  </section>;
}
