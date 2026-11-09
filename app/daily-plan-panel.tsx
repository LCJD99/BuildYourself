'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PlannerAction, WeeklyPlan } from '@/lib/daily-planner';
import type { DailyPlanRecord } from '@/lib/daily-plan-store';

type DailyPlanAction = WeeklyPlan['days'][number]['actions'][number];
type DailyPlanResponse = { dailyPlan: DailyPlanRecord; pendingActions: PlannerAction[]; error?: string };

const defaultCapacityMinutes = 240;
const priorityLabels = { high: '高', medium: '中', low: '低' } as const;

function localDateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function thisWeekStart() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  today.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return localDateString(today);
}

function dateLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
}

function defaultCapacities(weekStart: string) {
  const start = new Date(`${weekStart}T00:00:00`);
  return Object.fromEntries(Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    return [localDateString(date), defaultCapacityMinutes];
  }));
}

export default function DailyPlanPanel({
  onActionClick,
  onPlanChange,
}: {
  onActionClick: (action: DailyPlanAction) => void;
  onPlanChange: (record: DailyPlanRecord) => void;
}) {
  const weekStart = useMemo(thisWeekStart, []);
  const [record, setRecord] = useState<DailyPlanRecord>({ plan: null, status: null, confirmedAt: null, updatedAt: null });
  const [capacities, setCapacities] = useState<Record<string, number>>(() => defaultCapacities(weekStart));
  const [pendingActions, setPendingActions] = useState<PlannerAction[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const applyResponse = useCallback((data: DailyPlanResponse) => {
    setRecord(data.dailyPlan);
    setPendingActions(data.pendingActions);
    if (data.dailyPlan.plan) {
      setCapacities(Object.fromEntries(data.dailyPlan.plan.days.map(day => [day.date, day.capacityMinutes])));
    }
    onPlanChange(data.dailyPlan);
  }, [onPlanChange]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/daily-plan?weekStart=${encodeURIComponent(weekStart)}`, { cache: 'no-store' });
      const data = await response.json() as DailyPlanResponse;
      if (!response.ok) throw new Error(data.error || '无法读取本周安排');
      applyResponse(data);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取本周安排');
    }
  }, [applyResponse, weekStart]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function generate() {
    setBusy(true);
    try {
      const response = await fetch('/api/daily-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStart, capacities }),
      });
      const data = await response.json() as DailyPlanResponse;
      if (!response.ok) throw new Error(data.error || '无法生成本周安排');
      applyResponse(data);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法生成本周安排');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      const response = await fetch('/api/daily-plan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStart }),
      });
      const data = await response.json() as DailyPlanResponse;
      if (!response.ok) throw new Error(data.error || '无法确认本周安排');
      applyResponse(data);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法确认本周安排');
    } finally {
      setBusy(false);
    }
  }

  const plan = record.plan;
  const today = localDateString(new Date());
  const todayActions = record.status === 'confirmed' ? plan?.days.find(day => day.date === today)?.actions ?? [] : [];
  const availableCapacities = { ...defaultCapacities(weekStart), ...capacities };

  function actionButton(action: DailyPlanAction, className = '') {
    return (
      <button className={`daily-action ${className}`} key={action.actionId} onClick={() => onActionClick(action)}>
        <span className={`daily-priority priority-${action.priority}`}>P{priorityLabels[action.priority]}</span>
        <span className="daily-action-main">
          <strong>{action.title}</strong>
          <small>{action.goalTitle} · {action.estimateMinutes} 分钟{action.estimateIsDefault ? '（默认估算）' : ''}</small>
          {action.hardDeadline && <small>硬截止：{action.hardDeadline}</small>}
          {action.dependsOn.length > 0 && <small>需先完成 {action.dependsOn.length} 项依赖行动</small>}
          {action.milestoneTitle && <small>里程碑：{action.milestoneTitle}</small>}
        </span>
        <span className="daily-action-arrow">↗</span>
      </button>
    );
  }

  return (
    <section className="daily-planner" aria-labelledby="daily-plan-title">
      <div className="daily-planner-head">
        <div><span className="kicker">THIS WEEK</span><h2 id="daily-plan-title">日级安排</h2></div>
        <span className={`daily-plan-state ${record.status === 'confirmed' ? 'confirmed' : ''}`}>
          {record.status === 'confirmed' ? '已确认' : record.status === 'draft' ? '待确认' : '未生成'}
        </span>
      </div>
      <p className="daily-plan-note">本周从 {dateLabel(weekStart)} 开始。默认每天 4 小时（240 分钟），可按天调整；具体执行时刻由你决定。</p>
      {error && <p role="alert" className="error">{error}</p>}

      <section className="today-actions" aria-labelledby="today-actions-title">
        <div className="today-actions-heading"><div><span className="kicker">START HERE</span><h3 id="today-actions-title">今日关键行动</h3></div><span className="count">{todayActions.length}</span></div>
        {todayActions.length ? <div className="daily-actions-list">{todayActions.map(action => actionButton(action, 'today-daily-action'))}</div> : (
          <p className="today-actions-empty">{record.status === 'draft' ? '确认周安排后，这里会显示今天的关键行动。' : plan ? '今天没有已安排行动。' : '生成并确认周安排后，这里会显示今天的行动。'}</p>
        )}
      </section>

      <details className="weekly-plan-details" open={Boolean(plan)}>
        <summary>{plan ? '查看本周安排与每日容量' : '设置每日容量并生成周安排'}</summary>
        <div className="daily-capacity-grid">
          {Object.entries(availableCapacities).map(([date, minutes]) => (
            <label key={date}>{dateLabel(date)}
              <span><input type="number" min="0" max="1440" step="15" value={minutes} disabled={record.status === 'confirmed' || busy} onChange={event => setCapacities(current => ({ ...current, [date]: Number(event.target.value) }))} /> 分钟</span>
            </label>
          ))}
        </div>
        <div className="daily-plan-controls">
          {record.status !== 'confirmed' ? (
            <>
              <button className="primary-button" disabled={busy || !pendingActions.length} onClick={() => void generate()}>{busy ? '生成中…' : plan ? '按当前容量重新生成' : '生成周安排'}</button>
              {record.status === 'draft' && <button className="secondary-button" disabled={busy} onClick={() => void confirm()}>{busy ? '保存中…' : '确认并保存安排'}</button>}
              {!pendingActions.length && !plan && <small>当前没有已确认的待排行动。</small>}
            </>
          ) : <p>已确认的安排会保存在本机，重新打开时继续使用。</p>}
        </div>

        {plan && <div className="weekly-plan-days">
          {plan.days.map(day => (
            <article className="weekly-plan-day" key={day.date}>
              <div className="weekly-plan-day-head"><strong>{dateLabel(day.date)}</strong><span>{day.usedMinutes}/{day.capacityMinutes} 分钟</span></div>
              <div className="capacity-meter" role="progressbar" aria-label={`${dateLabel(day.date)}容量使用`} aria-valuemin={0} aria-valuemax={day.capacityMinutes || 1} aria-valuenow={day.usedMinutes}>
                <span style={{ width: `${day.capacityMinutes ? Math.min(day.usedMinutes / day.capacityMinutes * 100, 100) : 0}%` }} />
              </div>
              {day.capacityIsDefault && <small className="capacity-source">按默认容量估算</small>}
              {day.actions.length ? <div className="daily-actions-list">{day.actions.map(action => actionButton(action))}</div> : <p className="day-empty">暂无安排</p>}
            </article>
          ))}
        </div>}
        {plan?.unplaced.length ? <section className="unplaced-actions"><h3>尚未排入</h3><ul>{plan.unplaced.map(item => <li key={item.action.id}><strong>{item.action.title}</strong><span>{item.reason}</span></li>)}</ul></section> : null}
      </details>
    </section>
  );
}
