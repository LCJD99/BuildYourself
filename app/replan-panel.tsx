'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WeeklyPlan } from '@/lib/daily-planner';
import type { ReplanProposal, ReplanTrigger } from '@/lib/replanning';
import type { DailyPlanRecord } from '@/lib/daily-plan-store';

type ReplanResponse = { proposal?: ReplanProposal; proposals?: ReplanProposal[]; error?: string };
type PlacementEdits = Record<string, string | null>;

const triggerLabels: Record<ReplanTrigger, string> = {
  new_commitment: '新增外部承诺', deadline_change: '截止变化', scope_change: '范围变化', capacity_change: '可用容量变化',
  constraint_change: '其他约束变化', infeasible: '安排不可执行', execution_deviation: '重大执行偏差',
};
const triggerOptions = Object.keys(triggerLabels) as ReplanTrigger[];

function localDateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function weekStart() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  today.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return localDateString(today);
}

function dateLabel(value: string | null) {
  if (!value) return '尚未排入';
  return new Date(`${value}T00:00:00`).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
}

function planEntries(plan: WeeklyPlan) {
  return [
    ...plan.days.flatMap(day => day.actions.map(action => ({ action, date: day.date, reason: null as string | null }))),
    ...plan.unplaced.map(item => ({ action: { ...item.action, actionId: item.action.id, estimateMinutes: item.action.estimateMinutes ?? 30, estimateIsDefault: item.action.estimateMinutes === null }, date: null, reason: item.reason })),
  ];
}

export default function ReplanPanel({ goals, onAccepted }: { goals: Array<{ id: string; title: string }>; onAccepted: (record: DailyPlanRecord) => void }) {
  const start = useMemo(weekStart, []);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${start}T00:00:00`);
    date.setDate(date.getDate() + index);
    return localDateString(date);
  }), [start]);
  const [proposals, setProposals] = useState<ReplanProposal[]>([]);
  const [trigger, setTrigger] = useState<ReplanTrigger>('new_commitment');
  const [reason, setReason] = useState('');
  const [capacityDate, setCapacityDate] = useState(start);
  const [capacityMinutes, setCapacityMinutes] = useState(240);
  const [knownCapacities, setKnownCapacities] = useState<Record<string, number>>({});
  const [recoveryConstraints, setRecoveryConstraints] = useState<NonNullable<WeeklyPlan['recoveryConstraints']>>([]);
  const [recoveryGoalId, setRecoveryGoalId] = useState('');
  const [recoveryDate, setRecoveryDate] = useState(start);
  const [recoveryReason, setRecoveryReason] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [edits, setEdits] = useState<PlacementEdits>({});
  const [acknowledgedProposalId, setAcknowledgedProposalId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = proposals.find(proposal => proposal.id === selectedId) ?? proposals[0] ?? null;

  function renderTask(action: ReturnType<typeof planEntries>[number]['action'], date: string | null, reason: string | null) {
    const value = selected && Object.hasOwn(edits, action.actionId) ? edits[action.actionId] ?? '' : date ?? '';
    return <div className="replan-task" key={action.actionId}>
      <div><strong>{action.title}</strong><small>{action.estimateMinutes ?? 30} 分钟 · 硬截止：{action.hardDeadline || '未设置'}{reason ? ` · ${reason}` : ''}</small></div>
      {selected?.status === 'draft' ? <select aria-label={`调整${action.title}日期`} value={value} disabled={busy} onChange={event => setEdits(current => ({ ...current, [action.actionId]: event.target.value || null }))}>
        <option value="">尚未排入</option>{selected.plan.days.map(day => {
          const isRecoveryDate = selected.plan.recoveryConstraints?.some(item => item.goalPlanId === action.goalPlanId && item.date === day.date);
          return <option key={day.date} value={day.date} disabled={isRecoveryDate}>{dateLabel(day.date)}{isRecoveryDate ? ' · 恢复日' : ''}</option>;
        })}
      </select> : <span>{dateLabel(date)}</span>}
    </div>;
  }

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/replans?weekStart=${encodeURIComponent(start)}`, { cache: 'no-store' });
      const data = await response.json() as ReplanResponse;
      if (!response.ok) throw new Error(data.error || '无法读取重排记录');
      setProposals(data.proposals ?? []);
      setSelectedId(current => (data.proposals ?? []).some(proposal => proposal.id === current) ? current : (data.proposals?.[0]?.id ?? ''));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法读取重排记录'); }
  }, [start]);

  useEffect(() => {
    void refresh();
    void fetch(`/api/daily-plan?weekStart=${encodeURIComponent(start)}`, { cache: 'no-store' })
      .then(response => response.ok ? response.json() as Promise<{ dailyPlan?: { plan?: WeeklyPlan | null } }> : null)
      .then(data => {
        const capacities = Object.fromEntries((data?.dailyPlan?.plan?.days ?? []).map(day => [day.date, day.capacityMinutes]));
        setKnownCapacities(capacities);
        setRecoveryConstraints(data?.dailyPlan?.plan?.recoveryConstraints ?? []);
      })
      .catch(() => undefined);
  }, [refresh, start]);

  useEffect(() => {
    setCapacityMinutes(knownCapacities[capacityDate] ?? 240);
  }, [capacityDate, knownCapacities]);

  async function requestProposal() {
    setBusy(true);
    try {
      const response = await fetch('/api/replans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weekStart: start, trigger, reason,
          recoveryConstraints,
          ...(trigger === 'capacity_change' ? { capacities: { [capacityDate]: capacityMinutes } } : {}),
        }),
      });
      const data = await response.json() as ReplanResponse;
      if (!response.ok || !data.proposal) throw new Error(data.error || '无法生成重排建议');
      setProposals(current => [data.proposal!, ...current]);
      setSelectedId(data.proposal.id);
      setEdits({}); setReason(''); setAcknowledgedProposalId(''); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法生成重排建议'); }
    finally { setBusy(false); }
  }

  async function saveEdits() {
    if (!selected || !Object.keys(edits).length) return;
    setBusy(true);
    try {
      const response = await fetch('/api/replans', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId: selected.id, placements: edits }),
      });
      const data = await response.json() as ReplanResponse;
      if (!response.ok || !data.proposal) throw new Error(data.error || '无法保存编辑');
      setProposals(current => current.map(proposal => proposal.id === data.proposal!.id ? data.proposal! : proposal));
      setEdits({}); setAcknowledgedProposalId(''); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法保存编辑'); }
    finally { setBusy(false); }
  }

  async function decide(decision: 'accept' | 'reject') {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await fetch('/api/replans', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId: selected.id, decision, acknowledgeTradeoffs: acknowledgedProposalId === selected.id }),
      });
      const data = await response.json() as ReplanResponse;
      if (!response.ok || !data.proposal) throw new Error(data.error || '无法保存决定');
      setProposals(current => current.map(proposal => proposal.id === data.proposal!.id ? data.proposal! : proposal));
      if (decision === 'accept' && data.proposal.decidedAt) onAccepted({
        plan: data.proposal.plan, status: 'confirmed', confirmedAt: data.proposal.decidedAt, updatedAt: data.proposal.decidedAt,
      });
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法保存决定'); }
    finally { setBusy(false); }
  }

  const label = (proposal: ReplanProposal) => proposal.status === 'draft' ? '待决定' : proposal.status === 'accepted' ? `已接受 · 版本 ${proposal.version}` : '已拒绝';

  return (
    <section className="replan-panel" aria-labelledby="replan-title">
      <div className="replan-head"><div><span className="kicker">PLAN CHANGES</span><h3 id="replan-title">重排建议</h3></div><span className="subtle">先查看与编辑，再单独决定是否采用</span></div>
      <p className="replan-intro">承诺与原安排分别保存。生成建议不会改动当前计划；拒绝后承诺仍标记为尚未排入。</p>
      <div className="replan-form">
        <label>触发原因
          <select value={trigger} disabled={busy} onChange={event => setTrigger(event.target.value as ReplanTrigger)}>
            {triggerOptions.map(option => <option key={option} value={option}>{triggerLabels[option]}</option>)}
          </select>
        </label>
        {trigger === 'capacity_change' && <div className="replan-capacity-fields">
          <label>调整日期<select value={capacityDate} disabled={busy} onChange={event => { setCapacityDate(event.target.value); setCapacityMinutes(knownCapacities[event.target.value] ?? 240); }}>
            {weekDates.map(date => <option key={date} value={date}>{dateLabel(date)}</option>)}
          </select></label>
          <label>可用分钟<input type="number" min="0" max="1440" step="15" value={capacityMinutes} disabled={busy} onChange={event => setCapacityMinutes(Number(event.target.value))} /></label>
        </div>}
        <fieldset className="replan-recovery-fields" disabled={busy}>
          <legend>保护恢复日</legend>
          <p>恢复日只阻止所选目标的行动，外部承诺和其他目标仍会参与排程。</p>
          {goals.length === 0 ? <small>当前没有启用的目标可设置恢复日。</small> : <>
            <label>目标<select value={recoveryGoalId} onChange={event => setRecoveryGoalId(event.target.value)}>
              <option value="">选择目标</option>{goals.map(goal => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
            </select></label>
            <div className="replan-capacity-fields">
              <label>恢复日期<select value={recoveryDate} onChange={event => setRecoveryDate(event.target.value)}>
                {weekDates.map(date => <option key={date} value={date}>{dateLabel(date)}</option>)}
              </select></label>
              <label>原因<input value={recoveryReason} maxLength={500} placeholder="例如：高强度训练后休息" onChange={event => setRecoveryReason(event.target.value)} /></label>
            </div>
            <button className="secondary-button" disabled={!recoveryGoalId || !recoveryReason.trim() || recoveryConstraints.some(item => item.goalPlanId === recoveryGoalId && item.date === recoveryDate)} onClick={() => {
              const goal = goals.find(item => item.id === recoveryGoalId);
              if (!goal) return;
              setRecoveryConstraints(current => [...current, { goalPlanId: goal.id, goalTitle: goal.title, date: recoveryDate, reason: recoveryReason.trim() }]);
              setRecoveryReason('');
            }}>添加恢复日</button>
          </>}
          {recoveryConstraints.length > 0 && <ul className="replan-recovery-list">{recoveryConstraints.map((item, index) => <li key={`${item.goalPlanId}-${item.date}`}>
            <span>{item.goalTitle} · {dateLabel(item.date)} · {item.reason}</span>
            <button type="button" disabled={busy} aria-label={`移除${item.goalTitle}在${item.date}的恢复日`} onClick={() => setRecoveryConstraints(current => current.filter((_, currentIndex) => currentIndex !== index))}>移除</button>
          </li>)}</ul>}
        </fieldset>
        <label>变化说明
          <textarea value={reason} maxLength={1000} rows={2} disabled={busy} placeholder="例如：收到周三交大纲、周五交成果的通知" onChange={event => setReason(event.target.value)} />
        </label>
        <button className="primary-button" disabled={busy || !reason.trim()} onClick={() => void requestProposal()}>{busy ? '处理中…' : '生成一份建议'}</button>
      </div>
      {error && <p className="commitment-error" role="alert">{error}</p>}

      {proposals.length > 0 && <>
        {proposals.length > 1 && <label className="replan-history-select">重排记录
          <select value={selected?.id ?? ''} onChange={event => { setSelectedId(event.target.value); setEdits({}); setAcknowledgedProposalId(''); }}>
            {proposals.map(proposal => <option key={proposal.id} value={proposal.id}>{label(proposal)} · {new Date(proposal.createdAt).toLocaleString('zh-CN')}</option>)}
          </select>
        </label>}
        {selected && <article className="replan-proposal">
          <div className="replan-proposal-status"><strong>{triggerLabels[selected.trigger]} · {label(selected)}</strong><time>{new Date(selected.createdAt).toLocaleString('zh-CN')}</time></div>
          <p className="replan-reason">{selected.triggerReason}</p>
          {selected.changes.length > 0 ? <ul className="replan-changes">{selected.changes.map(change => (
            <li key={change.actionId}><strong>{change.title}</strong><span>{dateLabel(change.fromDate)} → {dateLabel(change.toDate)}</span><small>{change.reason}</small></li>
          ))}</ul> : <p className="replan-no-changes">本次建议保留原有日期。</p>}
          {selected.plan.recoveryConstraints && selected.plan.recoveryConstraints.length > 0 && <div className="replan-recovery-summary">
            <strong>本次保护的恢复约束</strong>
            <ul>{selected.plan.recoveryConstraints.map(item => <li key={`${item.goalPlanId}-${item.date}`}>{item.goalTitle} · {dateLabel(item.date)} · {item.reason}</li>)}</ul>
          </div>}
          {selected.deadlineGaps.length > 0 && <div className="replan-deadline-gaps" role="alert">
            <strong>部分安排仍有硬截止风险</strong>
            <p>系统保留硬截止和恢复约束；以下工作未能排入，不能视为已完成或已延期。请决定接受这份部分安排，或拒绝后调整容量、恢复日再生成建议。</p>
            <ul>{selected.deadlineGaps.map(gap => <li key={gap.deadline}>
              <strong>{dateLabel(gap.deadline)} 前仍有 {gap.timeGapMinutes} 分钟未排工作量</strong>
              <ul>{gap.items.map(item => <li key={item.actionId}>{item.title} · {item.minutes} 分钟 · {item.reason}</li>)}</ul>
            </li>)}</ul>
            {selected.status === 'draft' && <label className="replan-tradeoff-confirm"><input type="checkbox" checked={acknowledgedProposalId === selected.id} disabled={busy || Object.keys(edits).length > 0} onChange={event => setAcknowledgedProposalId(event.target.checked ? selected.id : '')} />我已查看未解决的硬截止事项，并决定接受这份部分安排。</label>}
          </div>}
          <details className="replan-schedule" open>
            <summary>建议安排与日期编辑</summary>
            <div className="replan-day-summaries">{selected.plan.days.map(day => {
              const oldUsed = selected.previousPlan.days.find(previous => previous.date === day.date)?.usedMinutes ?? 0;
              return <section className="replan-day-summary" key={day.date}>
                <div className="replan-day-summary-head"><strong>{dateLabel(day.date)}</strong><span>原计划 {oldUsed} → 建议 {day.usedMinutes} / {day.capacityMinutes} 分钟</span></div>
                {planEntries(selected.plan).filter(entry => entry.date === day.date).map(entry => renderTask(entry.action, entry.date, entry.reason))}
              </section>;
            })}</div>
            {planEntries(selected.plan).filter(entry => entry.date === null).map(entry => renderTask(entry.action, null, entry.reason))}
          </details>
          {selected.status === 'draft' && <div className="replan-actions">
            <button className="secondary-button" disabled={busy || !Object.keys(edits).length} onClick={() => void saveEdits()}>保存日期编辑</button>
            <button className="secondary-button" disabled={busy} onClick={() => void decide('reject')}>拒绝建议</button>
            <button className="primary-button" disabled={busy || Object.keys(edits).length > 0 || (selected.deadlineGaps.length > 0 && acknowledgedProposalId !== selected.id)} onClick={() => void decide('accept')}>接受并保存为新计划</button>
          </div>}
          {selected.status === 'draft' && Object.keys(edits).length > 0 && <small className="replan-edit-hint">保存日期编辑后，再接受或拒绝建议。</small>}
        </article>}
      </>}
    </section>
  );
}
