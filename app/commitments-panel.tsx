'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CommitmentField, ExternalCommitment } from '@/lib/commitments';
import ReplanPanel from './replan-panel';
import GoalRelationsPanel from './goal-relations-panel';
import type { DailyPlanRecord } from '@/lib/daily-plan-store';

type CommitmentState = { commitments: ExternalCommitment[]; goals: Array<{ id: string; title: string }> };

const fieldLabels: Record<CommitmentField, string> = {
  deliverable: '交付物',
  deadline: '截止时间',
  tasks: '任务拆分',
  estimateMinutes: '预计耗时',
  dependencies: '依赖',
  acceptanceCriteria: '验收要求',
  goalPlanId: '所属目标',
};

function date(value: string | null) {
  if (!value) return '未设置';
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString('zh-CN') : value;
}

function uncertaintyLabel(field: CommitmentField, taskIndex: number | null) {
  const label = fieldLabels[field];
  return taskIndex === null ? label : `任务 ${taskIndex + 1} · ${label}`;
}

export default function CommitmentsPanel({ onPlanAccepted }: { onPlanAccepted: (record: DailyPlanRecord) => void }) {
  const [state, setState] = useState<CommitmentState>({ commitments: [], goals: [] });
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/commitments', { cache: 'no-store' });
      if (!response.ok) throw new Error('无法读取外部承诺');
      const data = await response.json() as CommitmentState;
      setState(data);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取外部承诺');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const groups = new Map<string, { title: string; commitments: ExternalCommitment[] }>();
  for (const commitment of state.commitments) {
    const key = commitment.goalPlanId ?? 'misc';
    const group = groups.get(key) ?? { title: commitment.goalTitle || '杂项', commitments: [] };
    group.commitments.push(commitment);
    groups.set(key, group);
  }

  return (
    <section className="commitments-panel" aria-labelledby="commitments-title">
      <div className="section-title commitments-heading">
        <div><span className="kicker">EXTERNAL COMMITMENTS</span><h2 id="commitments-title">外部承诺</h2></div>
        <span className="subtle">事实确认与排期分开处理</span>
      </div>
      <p className="commitments-intro">在 pi 中核对并保存的通知会显示在这里。保存承诺不会直接改动既有计划；重排建议由你单独核对和决定。</p>
      {error && <p className="commitment-error" role="alert">{error}</p>}
      {state.commitments.length === 0 ? (
        <div className="commitment-empty"><strong>暂无已确认的外部承诺</strong><p>在 pi 中使用 <code>/commitment</code> 并粘贴通知，核对字段后再保存。</p></div>
      ) : [...groups.entries()].map(([key, group]) => (
        <div className="commitment-group" key={key}>
          <h3>{group.title}</h3>
          {group.commitments.map(commitment => (
            <article className="commitment-card" key={commitment.id}>
              <div className="commitment-card-head">
                <span className={`commitment-state ${commitment.status === 'scheduled' ? 'scheduled' : ''}`}>
                  {commitment.status === 'scheduled' ? '已排入' : commitment.status === 'partially_scheduled' ? '部分已排入 · 尚有未排入' : '已确认 · 尚未排入'}
                </span>
                <time>{new Date(commitment.createdAt).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })}</time>
              </div>
              <h4>{commitment.deliverable}</h4>
              <dl className="commitment-facts">
                <dt>归属</dt><dd>{commitment.goalTitle || '杂项'}</dd>
                <dt>整体截止</dt><dd>{commitment.deadline ? date(commitment.deadline) : '按各任务截止'}</dd>
              </dl>
              <div className="commitment-tasks">
                <h5>任务与验收要求</h5>
                <ol>{commitment.tasks.map((task, index) => (
                  <li key={`${commitment.id}-${index}`}>
                    <strong>{task.title}</strong>
                    <span>截止：{date(task.deadline)} · 预计耗时：{task.estimateMinutes === null ? '未说明' : `${task.estimateMinutes} 分钟`}</span>
                    <span>依赖：{task.dependencies.length ? task.dependencies.join('、') : '无'}</span>
                    <span>验收：{task.acceptanceCriteria || '未说明'}</span>
                    {task.details && <p>{task.details}</p>}
                  </li>
                ))}</ol>
              </div>
              {commitment.uncertainFields.length > 0 && (
                <div className="commitment-uncertainties">
                  <strong>仍待补充或确认</strong>
                  <ul>{commitment.uncertainFields.map((item, index) => (
                    <li key={`${commitment.id}-uncertain-${index}`}>
                      {uncertaintyLabel(item.field, item.taskIndex)}：{item.reason}
                    </li>
                  ))}</ul>
                </div>
              )}
              <details className="commitment-source">
                <summary>查看原始通知</summary>
                <p>{commitment.sourceText}</p>
              </details>
            </article>
          ))}
        </div>
      ))}
      <ReplanPanel goals={state.goals} onAccepted={onPlanAccepted} />
      <GoalRelationsPanel />
    </section>
  );
}
