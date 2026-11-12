'use client';

import { useEffect, useState } from 'react';
import type { WeeklyGoalEvaluation, WeeklyReviewAdjustment, WeeklyReviewRecord } from '@/lib/weekly-review-store';

function localDateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function currentWeekStart() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  today.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return localDateString(today);
}

function readableDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

function evaluationStatusLabel(evaluation: WeeklyGoalEvaluation) {
  if (evaluation.status === 'confirmed') return '已确认';
  if (evaluation.status === 'pending_confirmation') return '待确认';
  return evaluation.status === 'insufficient' ? '证据不足' : '待复核';
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + amount);
  return localDateString(date);
}

function timeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export default function WeeklyReviewPanel() {
  const [weekStart, setWeekStart] = useState('');
  const [record, setRecord] = useState<WeeklyReviewRecord | null>(null);
  const [adjustment, setAdjustment] = useState<WeeklyReviewAdjustment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const lastWeek = window.localStorage.getItem('weeklyReviewWeekStart');
    setWeekStart(lastWeek ?? currentWeekStart());
  }, []);

  useEffect(() => {
    if (!weekStart) return;
    window.localStorage.setItem('weeklyReviewWeekStart', weekStart);
    let active = true;
    setRecord(null);
    setAdjustment(null);
    void fetch(`/api/weekly-review?weekStart=${encodeURIComponent(weekStart)}&timeZone=${encodeURIComponent(timeZone())}`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json() as WeeklyReviewRecord & { error?: string };
        if (!response.ok) throw new Error(data.error || '无法读取周复盘');
        if (active) {
          setRecord(data);
          setAdjustment(data.review.adjustment);
          setError('');
        }
      })
      .catch(cause => {
        if (active) setError(cause instanceof Error ? cause.message : '无法读取周复盘');
      });
    return () => { active = false; };
  }, [weekStart]);

  async function save() {
    if (!weekStart || !adjustment) return;
    setBusy(true);
    try {
      const response = await fetch('/api/weekly-review', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStart, timeZone: timeZone(), adjustment }),
      });
      const data = await response.json() as WeeklyReviewRecord & { error?: string };
      if (!response.ok) throw new Error(data.error || '无法保存周复盘');
      setRecord(data);
      setAdjustment(data.review.adjustment);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存周复盘');
    } finally {
      setBusy(false);
    }
  }

  const saved = record?.status === 'saved';
  const review = record?.review;

  return (
    <section className="weekly-review" aria-labelledby="weekly-review-title">
      <div className="weekly-review-head">
        <div><span className="kicker">WEEKLY REFLECTION</span><h2 id="weekly-review-title">周复盘</h2></div>
        <span className={`weekly-review-state ${saved ? 'saved' : ''}`}>{saved ? '已保存' : '待核对'}</span>
      </div>
      <label className="weekly-review-week">复盘周一
        <input type="date" value={weekStart} onChange={event => setWeekStart(event.target.value)} />
      </label>
      <p className="weekly-review-intro">查看 {weekStart ? `${readableDate(weekStart)} 至 ${readableDate(review?.weekEnd ?? weekStart)}` : '本周'} 实际目标的行动、证据和里程碑。计划时长是估算；完成记录不包含实际工时。</p>
      {error && <p role="alert" className="error">{error} 复盘日期需要选择周一。</p>}
      {!review && !error && <p className="weekly-review-empty">正在读取本周记录…</p>}
      {review && adjustment && <>
        <div className="weekly-review-summary">
          <article><span>计划投入</span><strong>{review.executionEffort.plannedMinutes} 分钟估算</strong><small>{review.executionEffort.plannedActionCount} 项已安排 · {review.executionEffort.unplacedActionCount} 项未排入</small></article>
          <article><span>本周行动</span><strong>完成 {review.executionEffort.completedActionCount} 项</strong><small>按目标行动完成记录统计</small></article>
          <article><span>目标与证据</span><strong>{review.goals.length} 个目标 · {review.evidence.filter(item => item.goalPlanId).length} 条关联证据</strong><small>未关联目标的证据不参与目标判定</small></article>
        </div>
        <details className="weekly-review-sources">
          <summary>本周计划安排与证据记录</summary>
          {review.plannedActions.length ? <ul>{review.plannedActions.map(action => <li key={action.actionId}>{action.date} · {action.goalTitle}：{action.title}（计划 {action.estimateMinutes} 分钟，{action.status === 'completed' ? '按计划日期完成' : action.status === 'completed-earlier' ? '早于原计划完成' : action.status === 'completed-later' ? '晚于原计划完成' : action.status === 'overdue' ? '尚无完成记录' : '待执行'}）</li>)}</ul> : <p>没有已安排的行动。</p>}
          {review.evidence.length ? <ul className="weekly-review-evidence">{review.evidence.map(item => <li key={item.id}><strong>{item.goalTitle ? `目标：${item.goalTitle}` : '未关联目标'}{item.goalActionTitle ? ` · 行动：${item.goalActionTitle}` : ''} · ${item.level} · ${item.source}</strong><span>{item.text}</span><small>{item.reference} · {new Date(item.observedAt).toLocaleString('zh-CN')}</small></li>)}</ul> : <p>本周没有证据记录。</p>}
        </details>
        <div className="weekly-review-columns">
          <section><h3>事实</h3><ul>{review.facts.map((fact, index) => <li key={`${index}-${fact}`}>{fact}</li>)}</ul></section>
          <section><h3>待验证推断</h3><ul>{review.hypotheses.map((hypothesis, index) => <li key={`${index}-${hypothesis}`}>{hypothesis}</li>)}</ul></section>
        </div>
        <section className="weekly-review-goals"><h3>实际目标与里程碑</h3>
          {review.goals.length ? review.goals.map(goal => <article className="weekly-review-goal" key={goal.goalPlanId}>
            <div><strong>{goal.title}</strong><span>目标状态：{goal.status}</span></div>
            <p>{goal.contractVersion === null
              ? '该复盘周没有已生效的历史目标契约；系统未套用当前标准评价过去的进展。'
              : `本周评价规则采用契约 v${goal.contractVersion}（${new Date(goal.contractEffectiveAt!).toLocaleString('zh-CN')} 生效）：${goal.contractChangeSummary ?? '目标初始契约'}`}</p>
            <p>目标标准：{goal.successDescription ?? '尚未填写'} · 本周完成 {goal.completedActionCount} 项行动，计划 {goal.plannedActionCount} 项 / {goal.plannedMinutes} 分钟估算，关联证据 {goal.evidenceCount} 条（E2/E3 {goal.qualifiedEvidenceCount} 条，为目标关联证据等级统计）。</p>
            {goal.milestones.length ? <ul>{goal.milestones.map(milestone => <li key={milestone.milestoneId}><strong>能力进展：{milestone.title}</strong><span>{milestone.status}</span><small>成功标准：{milestone.successCriteria ?? '尚无成功标准'} · 证据门槛：{milestone.requiredEvidenceLevel}（{milestone.evidenceRequirementSource}）· 关联行动完成 {milestone.completedActionCount}/{milestone.associatedActionCount} · 达到门槛的关联证据 {milestone.qualifiedEvidenceCount} 条{milestone.evidenceBeforeContractCount ? ` · ${milestone.evidenceBeforeContractCount} 条契约生效前证据仅作历史记录` : ''}{milestone.gap !== '证据需要与成功标准一同核对。' ? ` · ${milestone.gap}` : ''}</small></li>)}</ul> : goal.contractVersion === null ? <p>该周没有可依据的历史里程碑标准，因此不自动判定能力进展。</p> : <p>该目标在本周适用的契约中没有配置里程碑。</p>}
            {goal.evaluations.length ? <ul>{goal.evaluations.map(evaluation => <li key={evaluation.id}><strong>已记录进展评价 · 契约 v{evaluation.contractVersion} · {evaluation.outcome === 'met' ? '达到标准' : evaluation.outcome === 'not_met' ? '未达标准' : '证据不足'}</strong><span>{evaluationStatusLabel(evaluation)}</span><small>规则快照：{evaluation.ruleSnapshot.milestone?.successCriteria ?? evaluation.ruleSnapshot.successDescription ?? '未设置'} · {evaluation.summary} · 证据 {evaluation.evidenceIds.length} 条</small></li>)}</ul> : null}
          </article>) : <p>本周没有活跃目标或目标活动记录；系统不会用示例图谱替代真实目标复盘。</p>}
        </section>
        <section className="weekly-review-gaps"><h3>证据缺口与计划偏差</h3>
          {review.evidenceGaps.length ? <ul>{review.evidenceGaps.map(gap => <li key={gap}>{gap}</li>)}</ul> : <p>本周记录没有显示证据缺口。</p>}
          {review.deviations.length ? <ul>{review.deviations.map((deviation, index) => <li key={`${index}-${deviation}`}>{deviation}</li>)}</ul> : <p>没有已记录的未排入事项或重排变化。</p>}
        </section>
        <section className="weekly-review-adjustment" aria-labelledby="weekly-review-adjustment-title">
          <div><span className="kicker">ONE VERIFIABLE CHANGE</span><h3 id="weekly-review-adjustment-title">下周只做一项调整</h3></div>
          <p className="weekly-review-milestone">目标：{adjustment.goalTitle}{adjustment.milestoneTitle ? ` · 关联里程碑：${adjustment.milestoneTitle}` : ' · 尚无可关联里程碑'}{adjustment.actionTitle ? ` · 关联行动：${adjustment.actionTitle}` : ''}</p>
          <label>调整建议<input value={adjustment.title} disabled={saved || busy} onChange={event => setAdjustment({ ...adjustment, title: event.target.value })} /></label>
          <label>依据<textarea value={adjustment.rationale} disabled={saved || busy} rows={2} onChange={event => setAdjustment({ ...adjustment, rationale: event.target.value })} /></label>
          <label>预期结果<textarea value={adjustment.expectedResult} disabled={saved || busy} rows={2} onChange={event => setAdjustment({ ...adjustment, expectedResult: event.target.value })} /></label>
          <label>验证日期<input type="date" min={addDays(review.weekEnd, 1)} value={adjustment.verificationDate} disabled={saved || busy} onChange={event => setAdjustment({ ...adjustment, verificationDate: event.target.value })} /></label>
          {saved ? <p className="weekly-review-saved-at">已于 {new Date(record.savedAt!).toLocaleString('zh-CN')} 核对保存{adjustment.modifiedByUser ? '，并记录了你的调整' : ''}；再次打开该周会恢复同一份复盘。</p> : <button className="primary-button" disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : '核对并保存本周复盘'}</button>}
        </section>
      </>}
    </section>
  );
}
