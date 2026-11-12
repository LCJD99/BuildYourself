'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GoalRelation, GoalRelationEvidenceReference, GoalRelationSnapshot, GoalRelationType } from '@/lib/goal-relations';

type ActionOption = { id: string; goalPlanId: string; goalTitle: string; title: string };
type RelationsResponse = { relations?: GoalRelation[]; actions?: ActionOption[]; relation?: GoalRelation; error?: string };
type RelationForm = {
  type: GoalRelationType;
  sourceActionId: string;
  targetActionId: string;
  sourceType: 'user' | 'rule' | 'professional' | 'ai_inference';
  sourceLabel: string;
  sourceReference: string;
  confidence: 'low' | 'medium' | 'high';
  impact: string;
  minimumRestDays: number;
  evidenceReferences: GoalRelationEvidenceReference[];
  newReferenceKind: GoalRelationEvidenceReference['kind'];
  newReferenceId: string;
  newReferenceLabel: string;
};

const typeLabels: Record<GoalRelationType, string> = {
  prerequisite: '前置依赖', time_conflict: '时间冲突', recovery_conflict: '恢复冲突',
  shared_activity: '共享活动', shared_material: '共享材料',
};
const typeOptions = Object.keys(typeLabels) as GoalRelationType[];
const statusLabels = { candidate: '待验证', confirmed: '已确认', verified: '已验证', rejected: '已否定' };
const confidenceLabels = { low: '低', medium: '中', high: '高' };
const sourceTypeLabels = { user: '用户提出', rule: '规则识别', professional: '专业资料', ai_inference: 'AI 推断' };

const emptyForm = (): RelationForm => ({
  type: 'time_conflict', sourceActionId: '', targetActionId: '', sourceType: 'ai_inference', sourceLabel: 'AI 推断',
  sourceReference: '', confidence: 'low', impact: '', minimumRestDays: 1,
  evidenceReferences: [], newReferenceKind: 'reference', newReferenceId: '', newReferenceLabel: '',
});

function actionLabel(action: ActionOption) { return `${action.goalTitle} · ${action.title}`; }
function date(value: string) { return new Date(value).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }); }
function relationSnapshotSummary(relation: GoalRelationSnapshot) {
  return `${relation.sourceAction.goalTitle}·${relation.sourceAction.actionTitle} → ${relation.targetAction.goalTitle}·${relation.targetAction.actionTitle}；${typeLabels[relation.type]}；${statusLabels[relation.status]}；可信度 ${confidenceLabels[relation.confidence]}；来源 ${relation.sourceLabel}${relation.sourceReference ? `（${relation.sourceReference}）` : ''}；影响 ${relation.impact}；证据 ${relation.evidenceReferences.map(item => `${item.label} [${item.kind}:${item.id}]`).join('、')}`;
}

export default function GoalRelationsPanel() {
  const [relations, setRelations] = useState<GoalRelation[]>([]);
  const [actions, setActions] = useState<ActionOption[]>([]);
  const [form, setForm] = useState<RelationForm>(emptyForm);
  const [correction, setCorrection] = useState<{ id: string; form: RelationForm; reason: string } | null>(null);
  const [resolutionReasons, setResolutionReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/goal-relations', { cache: 'no-store' });
      const data = await response.json() as RelationsResponse;
      if (!response.ok) throw new Error(data.error || '无法读取跨目标关系');
      setRelations(data.relations ?? []);
      setActions(data.actions ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法读取跨目标关系'); }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 4000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  function relationInput(value: RelationForm) {
    return {
      type: value.type, sourceActionId: value.sourceActionId, targetActionId: value.targetActionId,
      sourceType: value.sourceType, sourceLabel: value.sourceLabel, sourceReference: value.sourceReference || null,
      confidence: value.confidence, impact: value.impact,
      ...(value.type === 'recovery_conflict' ? { minimumRestDays: value.minimumRestDays } : {}),
      evidenceReferences: [...value.evidenceReferences,
        ...(value.newReferenceId.trim() && value.newReferenceLabel.trim() ? [{ kind: value.newReferenceKind, id: value.newReferenceId.trim(), label: value.newReferenceLabel.trim() }] : [])],
    };
  }

  async function createCandidate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyId('create');
    try {
      const response = await fetch('/api/goal-relations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', relation: relationInput(form) }),
      });
      const data = await response.json() as RelationsResponse;
      if (!response.ok) throw new Error(data.error || '无法保存关系候选');
      setForm(emptyForm()); setError(''); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法保存关系候选'); }
    finally { setBusyId(''); }
  }

  async function resolve(relation: GoalRelation, action: 'confirm' | 'reject') {
    const reason = resolutionReasons[relation.id]?.trim();
    if (!reason) { setError(action === 'confirm' ? '请填写确认依据。' : '请填写否定原因。'); return; }
    setBusyId(relation.id);
    try {
      const response = await fetch('/api/goal-relations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, relationId: relation.id, version: relation.version, reason, ...(action === 'confirm' ? { confirmed: true } : {}) }),
      });
      const data = await response.json() as RelationsResponse;
      if (!response.ok) throw new Error(data.error || '无法处理关系');
      setResolutionReasons(current => ({ ...current, [relation.id]: '' })); setError(''); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法处理关系'); }
    finally { setBusyId(''); }
  }

  function beginCorrection(relation: GoalRelation) {
    setCorrection({
      id: relation.id,
      form: {
        type: relation.type, sourceActionId: relation.sourceAction.actionId, targetActionId: relation.targetAction.actionId,
        sourceType: relation.sourceType, sourceLabel: relation.sourceLabel, sourceReference: relation.sourceReference ?? '',
        confidence: relation.confidence, impact: relation.impact, minimumRestDays: relation.minimumRestDays ?? 1,
        evidenceReferences: relation.evidenceReferences.filter(item => item.kind !== 'action'),
        newReferenceKind: 'reference', newReferenceId: '', newReferenceLabel: '',
      },
      reason: '',
    });
  }

  async function saveCorrection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!correction) return;
    const relation = relations.find(item => item.id === correction.id);
    if (!relation) return;
    setBusyId(relation.id);
    try {
      const response = await fetch('/api/goal-relations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'correct', relationId: relation.id, version: relation.version, reason: correction.reason,
          relation: relationInput(correction.form) }),
      });
      const data = await response.json() as RelationsResponse;
      if (!response.ok) throw new Error(data.error || '无法保存关系修正');
      setCorrection(null); setError(''); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法保存关系修正'); }
    finally { setBusyId(''); }
  }

  function actionSelect(value: RelationForm, update: (next: RelationForm) => void, key: 'sourceActionId' | 'targetActionId') {
    return <select value={value[key]} required onChange={event => update({ ...value, [key]: event.target.value })}>
      <option value="">选择行动</option>{actions.map(action => <option key={action.id} value={action.id}>{actionLabel(action)}</option>)}
    </select>;
  }

  function formFields(value: RelationForm, update: (next: RelationForm) => void) {
    return <>
      <div className="relation-form-grid">
        <label>关系类型<select value={value.type} onChange={event => update({ ...value, type: event.target.value as GoalRelationType })}>
          {typeOptions.map(type => <option key={type} value={type}>{typeLabels[type]}</option>)}
        </select></label>
        <label>可信度<select value={value.confidence} onChange={event => update({ ...value, confidence: event.target.value as RelationForm['confidence'] })}>
          <option value="low">低</option><option value="medium">中</option><option value="high">高</option>
        </select></label>
        <label>关系来源<select value={value.sourceType} onChange={event => update({ ...value, sourceType: event.target.value as RelationForm['sourceType'] })}>
          {Object.entries(sourceTypeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label>来源说明<input required maxLength={200} value={value.sourceLabel} onChange={event => update({ ...value, sourceLabel: event.target.value })} /></label>
        <label>来源引用<input value={value.sourceReference} maxLength={500} placeholder="文档、会话或规则引用（可选）" onChange={event => update({ ...value, sourceReference: event.target.value })} /></label>
        {value.type === 'recovery_conflict' && <label>完整恢复日数<input type="number" min="1" max="7" value={value.minimumRestDays} onChange={event => update({ ...value, minimumRestDays: Number(event.target.value) })} /></label>}
      </div>
      <div className="relation-form-grid">
        <label>起始行动{actionSelect(value, update, 'sourceActionId')}</label>
        <label>关联行动{actionSelect(value, update, 'targetActionId')}</label>
      </div>
      <label>对计划的影响<textarea required maxLength={1000} rows={2} value={value.impact} placeholder="说明这条关系会影响哪项行动或判断" onChange={event => update({ ...value, impact: event.target.value })} /></label>
      <div className="goal-relation-evidence-editor">
        <strong>证据引用</strong>
        <ul>{value.evidenceReferences.map((reference, index) => <li key={`${reference.kind}-${reference.id}`}>
          <span>{reference.label} [{reference.kind}:{reference.id}]</span>
          <button type="button" aria-label={`移除证据引用 ${reference.label}`} onClick={() => update({ ...value, evidenceReferences: value.evidenceReferences.filter((_, itemIndex) => itemIndex !== index) })}>移除</button>
        </li>)}</ul>
        <div className="relation-form-grid">
          <label>引用类型<select value={value.newReferenceKind} onChange={event => update({ ...value, newReferenceKind: event.target.value as GoalRelationEvidenceReference['kind'] })}>
            <option value="reference">其他来源</option><option value="evidence">证据</option><option value="project">项目</option>
          </select></label>
          <label>引用 ID<input maxLength={300} value={value.newReferenceId} onChange={event => update({ ...value, newReferenceId: event.target.value })} /></label>
          <label>引用说明<input maxLength={300} value={value.newReferenceLabel} onChange={event => update({ ...value, newReferenceLabel: event.target.value })} /></label>
          <button type="button" className="secondary-button" disabled={!value.newReferenceId.trim() || !value.newReferenceLabel.trim()} onClick={() => update({ ...value,
            evidenceReferences: [...value.evidenceReferences, { kind: value.newReferenceKind, id: value.newReferenceId.trim(), label: value.newReferenceLabel.trim() }],
            newReferenceId: '', newReferenceLabel: '',
          })}>添加引用</button>
        </div>
      </div>
    </>;
  }

  const candidateCount = relations.filter(relation => relation.status === 'candidate').length;
  return <section className="goal-relations-panel" aria-labelledby="goal-relations-title">
    <div className="goal-relations-head"><div><span className="kicker">CROSS-GOAL RELATIONS</span><h3 id="goal-relations-title">跨目标关系与依据</h3></div><span>{candidateCount} 条待验证</span></div>
    <p className="goal-relations-intro">候选关系在你确认前不会作为事实参与重排。确认后只影响之后生成的建议；已接受计划不会被自动改动。每次修正、确认或否定都会保留版本与原因。</p>
    {error && <p className="commitment-error" role="alert">{error}</p>}
    <details className="goal-relation-create">
      <summary>添加关系候选</summary>
      {actions.length < 2 ? <p>至少需要两个活跃目标中的行动，才能记录跨目标关系。</p> : <form onSubmit={event => void createCandidate(event)}>
        {formFields(form, next => setForm(next))}
        <button className="primary-button" disabled={busyId === 'create' || form.sourceActionId === form.targetActionId || !form.sourceActionId || !form.targetActionId || actions.find(item => item.id === form.sourceActionId)?.goalPlanId === actions.find(item => item.id === form.targetActionId)?.goalPlanId}>{busyId === 'create' ? '保存中…' : '保存为待验证候选'}</button>
      </form>}
    </details>
    {relations.length === 0 ? <p className="goal-relations-empty">暂无关系记录。</p> : <div className="goal-relations-list">{relations.map(relation => <article className="goal-relation-card" key={relation.id}>
      <div className="goal-relation-card-head"><strong>{relation.sourceAction.goalTitle} · {relation.sourceAction.actionTitle} → {relation.targetAction.goalTitle} · {relation.targetAction.actionTitle}</strong><span className={`goal-relation-status ${relation.status}`}>{statusLabels[relation.status]} · v{relation.version}</span></div>
      <p className="goal-relation-type">{typeLabels[relation.type]} · 可信度 {confidenceLabels[relation.confidence]}</p>
      <p>{relation.impact}{relation.minimumRestDays ? `（完整恢复 ${relation.minimumRestDays} 天）` : ''}</p>
      <small>来源：{sourceTypeLabels[relation.sourceType]} · {relation.sourceLabel}{relation.sourceReference ? ` · ${relation.sourceReference}` : ''}</small>
      <small>证据引用：{relation.evidenceReferences.map(item => `${item.label} [${item.kind}:${item.id}]`).join('；')}</small>
      {relation.status === 'candidate' && <div className="goal-relation-resolution">
        <label>核对依据或否定原因<input value={resolutionReasons[relation.id] ?? ''} onChange={event => setResolutionReasons(current => ({ ...current, [relation.id]: event.target.value }))} /></label>
        <button type="button" className="primary-button" disabled={busyId === relation.id || !(resolutionReasons[relation.id] ?? '').trim()} onClick={() => void resolve(relation, 'confirm')}>确认关系</button>
        <button type="button" className="secondary-button" disabled={busyId === relation.id || !(resolutionReasons[relation.id] ?? '').trim()} onClick={() => void resolve(relation, 'reject')}>否定关系</button>
      </div>}
      <div className="goal-relation-actions"><button type="button" className="secondary-button" disabled={busyId === relation.id} onClick={() => beginCorrection(relation)}>修正关系</button></div>
      {correction?.id === relation.id && <form className="goal-relation-correction" onSubmit={event => void saveCorrection(event)}>
        {formFields(correction.form, next => setCorrection(current => current ? { ...current, form: next } : current))}
        <label>修正原因<textarea required maxLength={500} rows={2} value={correction.reason} onChange={event => setCorrection(current => current ? { ...current, reason: event.target.value } : current)} /></label>
        <div><button className="primary-button" disabled={busyId === relation.id}>保存修正为待验证候选</button><button type="button" className="secondary-button" onClick={() => setCorrection(null)}>取消</button></div>
      </form>}
      <details className="goal-relation-history"><summary>查看变更记录（{relation.events.length}）</summary>
        <ol>{relation.events.map(event => <li key={event.id}><time>{date(event.createdAt)} · v{event.version} · {event.action}</time><span>{event.reason}</span>
          {event.before && event.after && <><small>更改前：{relationSnapshotSummary(event.before)}</small><small>更改后：{relationSnapshotSummary(event.after)}</small></>}
        </li>)}</ol>
      </details>
    </article>)}</div>}
  </section>;
}
