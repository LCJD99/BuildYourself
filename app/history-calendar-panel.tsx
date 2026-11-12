'use client';

import { useEffect, useMemo, useState } from 'react';
import type { HistoryCalendar } from '@/lib/history-calendar';
import { selectHistoryDay } from '@/lib/history-calendar-view';

const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const goalStatusLabels = { active: '活跃', completed: '已完成', paused: '已暂停', archived: '已归档', abandoned: '已放弃', draft: '草稿' };
const evaluationOutcomeLabels = { met: '达到标准', not_met: '未达到标准', insufficient: '证据不足' };
const evaluationStatusLabels = { confirmed: '已确认', pending_confirmation: '待确认', not_met: '未达标准', insufficient: '证据不足' };
const reviewPlanStatusLabels = { confirmed: '已确认', draft: '草稿', missing: '未保存计划' };
const plannedActionStatusLabels = { completed: '按计划日期完成', 'completed-earlier': '早于计划完成', 'completed-later': '晚于计划完成', pending: '待执行', overdue: '逾期未完成' };
const adjustmentKindLabels = { measure: '测量', practice: '练习', setup: '设置' };
const followupStatusLabels = { not_executed: '截至复盘时尚未执行', completed_no_evidence: '已完成但缺少关联证据', evidence_insufficient: '证据未达到门槛', result_available: '已有结果记录' };

function localDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dayLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('zh-CN', { dateStyle: 'full' });
}

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export default function HistoryCalendarPanel() {
  const today = new Date();
  const [history, setHistory] = useState<HistoryCalendar | null>(null);
  const [month, setMonth] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selectedDate, setSelectedDate] = useState(localDateKey(today.getFullYear(), today.getMonth(), today.getDate()));
  const [selectedGoalId, setSelectedGoalId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const response = await fetch(`/api/history-calendar?timeZone=${encodeURIComponent(timeZone)}`, { cache: 'no-store' });
        if (!response.ok) throw new Error('无法读取历史日历');
        const result = await response.json() as HistoryCalendar;
        if (live) {
          setHistory(result);
          setError('');
        }
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : '无法读取历史日历');
      }
    };
    void load();
    const timer = window.setInterval(load, 5000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);

  const monthDays = useMemo(() => {
    const count = new Date(month.year, month.month + 1, 0).getDate();
    const offset = (new Date(month.year, month.month, 1).getDay() + 6) % 7;
    return [...Array.from({ length: offset }, () => null), ...Array.from({ length: count }, (_, index) => index + 1)];
  }, [month]);
  const monthTitle = new Date(month.year, month.month, 1).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });
  const selectedDay = history ? selectHistoryDay(history, selectedDate, selectedGoalId) : undefined;
  const activities = selectedDay?.activities ?? [];
  const evidence = selectedDay?.evidence ?? [];
  const filteredUndated = (history?.undatedActivities ?? []).filter(activity => !selectedGoalId || activity.goalPlanId === selectedGoalId);
  const filteredUndatedEvidence = (history?.undatedEvidence ?? []).filter(evidence => !selectedGoalId || evidence.goalPlanId === selectedGoalId);
  const filteredUndatedReviews = (history?.undatedReviews ?? []).filter(item => !selectedGoalId || item.review.goals.some(goal => goal.goalPlanId === selectedGoalId));

  function moveMonth(amount: number) {
    const next = new Date(month.year, month.month + amount, 1);
    setMonth({ year: next.getFullYear(), month: next.getMonth() });
    setSelectedDate(localDateKey(next.getFullYear(), next.getMonth(), 1));
  }

  function entriesForDate(date: string) {
    return history ? selectHistoryDay(history, date, selectedGoalId) : undefined;
  }

  return (
    <section className="history-calendar" aria-labelledby="history-calendar-title">
      <div className="section-title history-calendar-heading">
        <div><span className="kicker">ACTIVITY HISTORY</span><h2 id="history-calendar-title">历史日历</h2></div>
        <span className="subtle">只读回查已记录的活动和证据</span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="history-calendar-toolbar">
        <div className="history-calendar-month"><button type="button" aria-label="上个月" onClick={() => moveMonth(-1)}>‹</button><strong>{monthTitle}</strong><button type="button" aria-label="下个月" onClick={() => moveMonth(1)}>›</button></div>
        <label>按目标筛选
          <select value={selectedGoalId} onChange={event => setSelectedGoalId(event.target.value)}>
            <option value="">全部目标</option>
            {(history?.goals ?? []).map(goal => <option key={goal.id} value={goal.id}>{goal.title}（{goalStatusLabels[goal.status]}）</option>)}
          </select>
        </label>
      </div>
      <div className="history-calendar-layout">
        <div className="history-calendar-grid" role="grid" aria-label={`${monthTitle}历史日历`}>
          {weekdays.map(day => <span className="history-calendar-weekday" role="columnheader" key={day}>{day}</span>)}
          {monthDays.map((day, index) => {
            if (day === null) return <span className="history-calendar-blank" aria-hidden="true" key={`blank-${index}`} />;
            const date = localDateKey(month.year, month.month, day);
            const entries = entriesForDate(date);
            const reviewCount = entries?.reviews.length ?? 0;
            const hasEntries = (entries?.activities.length ?? 0) > 0 || (entries?.evidence.length ?? 0) > 0 || reviewCount > 0;
            return <button type="button" role="gridcell" aria-pressed={selectedDate === date} aria-label={`${date}${hasEntries ? `，${entries!.activities.length} 项活动，${entries!.evidence.length} 项证据，${reviewCount} 份已保存复盘` : ''}`} className={`history-calendar-day${selectedDate === date ? ' selected' : ''}${hasEntries ? ' has-entry' : ''}`} key={date} onClick={() => setSelectedDate(date)}>
              <span>{day}</span>{hasEntries && <small>{entries!.activities.length + entries!.evidence.length + reviewCount} 条</small>}
            </button>;
          })}
        </div>
        <section className="history-calendar-detail" aria-live="polite" aria-label="当天历史记录">
          <h3>{dayLabel(selectedDate)}</h3>
          {activities.length || evidence.length || (selectedDay?.reviews.length ?? 0) > 0 ? <>
            {activities.length > 0 && <div><h4>已完成活动</h4><ul>{activities.map(activity => <li key={activity.id}>
              <strong>{activity.title}</strong><span>{activity.goalTitle} · {timeLabel(activity.completedAt)}</span>
              {activity.evidenceRequirement && <small>证据要求：{activity.evidenceRequirement}</small>}
            </li>)}</ul></div>}
            {evidence.length > 0 && <div><h4>证据标记</h4><ul>{evidence.map(item => <li key={item.id}>
              <strong><span className={`history-evidence-level ${item.level}`}>{item.level}</span> {item.reference || item.requirement || '目标证据'}</strong>
              <span>{item.goalTitle}{item.actionTitle ? ` · ${item.actionTitle}` : ''} · {timeLabel(item.observedAt)}</span><small>{item.source} · {item.description}</small>
            </li>)}</ul></div>}
            {(selectedDay?.reviews.length ?? 0) > 0 && <div className="history-saved-reviews"><h4>已保存复盘</h4>{selectedDay!.reviews.map(saved => {
              const correctionById = new Map(saved.corrections.map(correction => [correction.evidenceId, correction]));
              const reviewEvidence = saved.review.evidence.filter(item => item.goalPlanId);
              const visibleEvidenceIds = new Set([
                ...reviewEvidence.map(item => item.id),
                ...saved.review.followups.flatMap(trace => trace.evidence.map(item => item.id)),
              ]);
              const evaluationCitationCorrections = saved.corrections.filter(correction =>
                !visibleEvidenceIds.has(correction.evidenceId) && correction.citations.some(citation => citation.kind === 'evaluation'));
              return <article className="history-saved-review" key={`${saved.review.weekStart}-${saved.savedAt}`}>
                <strong>周复盘 · {saved.review.weekStart} 至 {saved.review.weekEnd}</strong>
                <small>保存于 {new Date(saved.savedAt).toLocaleString('zh-CN')}。以下摘要和结论保留保存时的内容。</small>
                {saved.followup && <div className="history-followup-confirmation">
                  <strong>建议追踪：{saved.followup.decision === 'accepted' ? '已接受' : '已修改并确认'} · {saved.followup.taskTitle}</strong>
                  <span>{saved.followup.goalTitle} · {saved.followup.milestoneTitle} · 契约 v{saved.followup.contractVersion}</span>
                  <small>原建议：{saved.followup.originalSuggestion.title} · 确认内容：{saved.followup.adjustment.title} · 状态：{saved.followup.state === 'confirmed' ? '已创建待排任务' : '任务创建中'}{saved.followup.actionId ? ` · 任务 ${saved.followup.actionId}` : ''}</small>
                </div>}
                {saved.review.facts.length > 0 && <div><h5>当时记录的事实</h5><ul>{saved.review.facts.map((fact, index) => <li key={`${index}-${fact}`}>{fact}</li>)}</ul></div>}
                {saved.review.hypotheses.length > 0 && <div><h5>当时记录的待验证推断</h5><ul>{saved.review.hypotheses.map((fact, index) => <li key={`${index}-${fact}`}>{fact}</li>)}</ul></div>}
                <div className="history-review-goals"><h5>保存时的目标判定</h5>{saved.review.goals.map(goal => <section key={goal.goalPlanId}>
                  <strong>{goal.title}</strong>
                  {goal.evaluations.length ? <ul>{goal.evaluations.map(evaluation => <li key={evaluation.id}>
                    <span>{evaluationOutcomeLabels[evaluation.outcome]} · {evaluationStatusLabels[evaluation.status]}</span>
                    <small>契约 v{evaluation.contractVersion} · {evaluation.summary} · 引用证据 {evaluation.evidenceIds.length} 条</small>
                  </li>)}</ul> : <small>这份复盘没有保存目标进展判定。</small>}
                  {saved.latestEvaluations.find(item => item.goalPlanId === goal.goalPlanId) && (() => {
                    const latest = saved.latestEvaluations.find(item => item.goalPlanId === goal.goalPlanId)!;
                    return <div className="history-latest-evaluation">
                      {latest.evaluation ? <><strong>最近保存判定：{evaluationOutcomeLabels[latest.evaluation.outcome]}</strong><span>{latest.evaluation.summary}</span><small>契约 v{latest.evaluation.contractVersion} · 记录于 {new Date(latest.evaluation.evaluatedAt).toLocaleString('zh-CN')}{latest.staleEvidenceIds.length ? ' · 引用证据此后已更正，这条判定仍保留原结论' : ''}</small></> : <span>尚无已保存的目标进展判定。</span>}
                      <a href={`#goal-latest-evaluation-${goal.goalPlanId}`}>打开目标最近判定</a>
                    </div>;
                  })()}
                </section>)}</div>
                {evaluationCitationCorrections.length > 0 && <div className="history-review-evidence"><h5>复盘判定引用的周外证据更正</h5><ul>{evaluationCitationCorrections.map(correction => <li key={correction.evidenceId}>
                  <strong>证据 {correction.evidenceId} 于 {new Date(correction.changedAt).toLocaleString('zh-CN')} 更正</strong>
                  <span>{correction.citations.filter(citation => citation.kind === 'evaluation').map(citation => `${citation.goalTitle}：${citation.summary}`).join('；')}</span>
                  {correction.originalUnavailable
                    ? <small>保存时的评价引用了这条证据，但原复盘和评价都没有可恢复快照，原值不可用。</small>
                    : correction.before && <small>评价保存时：{correction.before.text} · {correction.before.source} · {correction.before.reference} · {timeLabel(correction.before.observedAt)}</small>}
                  <span>当前版本：{correction.current.text} · {correction.current.source} · {correction.current.reference} · {timeLabel(correction.current.observedAt)}</span>
                </li>)}</ul></div>}
                {reviewEvidence.length > 0 && <div className="history-review-evidence"><h5>复盘保存时的目标关联证据</h5><ul>{reviewEvidence.map(item => {
                  const correction = correctionById.get(item.id);
                  return <li key={item.id}>
                    <strong>{item.level} · {item.reference || '目标证据'}</strong>
                    <span>{item.goalTitle}{item.goalActionTitle ? ` · ${item.goalActionTitle}` : ''} · {timeLabel(item.observedAt)}</span>
                    <small>{item.source} · {item.text}</small>
                    {correction && <div className="history-correction-note">
                      <strong>此证据于 {new Date(correction.changedAt).toLocaleString('zh-CN')} 更正</strong>
                      {correction.citations.some(citation => citation.kind === 'evaluation')
                        ? <small>它被保存时的目标判定引用；历史结论保持不变。</small>
                        : correction.citations.some(citation => citation.kind === 'followup')
                          ? <small>它被保存时的建议追踪结果引用；历史追踪快照保持不变。</small>
                        : <small>它出现在保存的证据清单中，但未被保存的目标判定明确引用。</small>}
                      <span>当前版本：{correction.current.text}</span>
                      <small>{correction.current.level} · {correction.current.source} · {correction.current.reference} · {timeLabel(correction.current.observedAt)} · {correction.currentGoalTitle ? `当前归属：${correction.currentGoalTitle}${correction.currentGoalActionTitle ? ` · ${correction.currentGoalActionTitle}` : ''}` : '当前未关联目标'}</small>
                    </div>}
                  </li>;
                })}</ul></div>}
                <details className="history-review-details">
                  <summary>查看保存的完整复盘记录</summary>
                  <p>计划状态：{reviewPlanStatusLabels[saved.review.executionEffort.planStatus]} · 已安排 {saved.review.executionEffort.plannedActionCount} 项 / {saved.review.executionEffort.plannedMinutes} 分钟估算 · 未排入 {saved.review.executionEffort.unplacedActionCount} 项 · 完成 {saved.review.executionEffort.completedActionCount} 项。实际工时：未记录。时区：{saved.review.timeZone}</p>
                  {saved.review.plannedActions.length > 0 && <div><h5>当周计划行动</h5><ul>{saved.review.plannedActions.map(action => <li key={action.actionId}>
                    <strong>{action.date} · {action.goalTitle}：{action.title}</strong>
                    <small>计划 {action.estimateMinutes} 分钟 · {plannedActionStatusLabels[action.status]} · 完成时间：{action.completedAt ? new Date(action.completedAt).toLocaleString('zh-CN') : '未记录'} · 关联证据 {action.evidenceCount} 条（达到 E2/E3 的 {action.qualifiedEvidenceCount} 条）</small>
                  </li>)}</ul></div>}
                  {saved.review.goals.length > 0 && <div><h5>目标和里程碑快照</h5>{saved.review.goals.map(goal => <section key={goal.goalPlanId}>
                    <strong>{goal.title} · {goalStatusLabels[goal.status]} · 契约 {goal.contractVersion === null ? '未适用' : `v${goal.contractVersion}`}</strong>
                    <small>{goal.successDescription ?? '未保存成功描述'} · 契约生效：{goal.contractEffectiveAt ? new Date(goal.contractEffectiveAt).toLocaleString('zh-CN') : '未记录'} · 版本说明：{goal.contractChangeSummary ?? '无'} · 完成时间：{goal.completedAt ? new Date(goal.completedAt).toLocaleString('zh-CN') : '未记录'} · 完成行动 {goal.completedActionCount}/{goal.plannedActionCount} · 计划 {goal.plannedMinutes} 分钟 · 关联证据 {goal.evidenceCount} 条（达到 E2/E3 的 {goal.qualifiedEvidenceCount} 条）</small>
                    {goal.milestones.length > 0 && <ul>{goal.milestones.map(milestone => <li key={milestone.milestoneId}>
                      <strong>{milestone.title} · {milestone.status}</strong>
                      <small>标准：{milestone.successCriteria ?? '未设置'} · 证据要求：{milestone.requiredEvidenceLevel}（{milestone.evidenceRequirementSource}）· 完成行动 {milestone.completedActionCount}/{milestone.associatedActionCount} · 关联证据 {milestone.evidenceCount} 条（达到门槛 {milestone.qualifiedEvidenceCount} 条，契约前 {milestone.evidenceBeforeContractCount} 条）· {milestone.gap}</small>
                    </li>)}</ul>}
                  </section>)}</div>}
                  {saved.review.followups.length > 0 && <div><h5>此前复盘建议的追踪结果</h5><ul>{saved.review.followups.map(trace => <li key={`${trace.sourceWeekStart}-${trace.actionId}`}>
                    <strong>{trace.sourceWeekStart} 周建议 · {trace.taskTitle} · {followupStatusLabels[trace.status]}</strong>
                    <small>{trace.goalTitle} · {trace.milestoneTitle} · {trace.resultSummary}</small>
                    {trace.evidence.map(item => {
                      const correction = correctionById.get(item.id);
                      return <div className="history-followup-evidence" key={item.id}>
                        <span>{item.level} · {item.source} · {item.reference} · {item.text}</span>
                        {correction && <small>此追踪证据之后已更正；保存时内容仍保留。当前版本：{correction.current.text}</small>}
                      </div>;
                    })}
                  </li>)}</ul></div>}
                  {saved.review.evidenceGaps.length > 0 && <div><h5>保存的证据缺口</h5><ul>{saved.review.evidenceGaps.map((gap, index) => <li key={`${index}-${gap}`}>{gap}</li>)}</ul></div>}
                  {saved.review.deviations.length > 0 && <div><h5>保存的计划偏差</h5><ul>{saved.review.deviations.map((deviation, index) => <li key={`${index}-${deviation}`}>{deviation}</li>)}</ul></div>}
                  <div className="history-review-adjustment"><h5>保存时的调整建议</h5>
                    <strong>{adjustmentKindLabels[saved.review.adjustment.kind]} · {saved.review.adjustment.title}</strong>
                    <span>{saved.review.adjustment.goalTitle}{saved.review.adjustment.milestoneTitle ? ` · ${saved.review.adjustment.milestoneTitle}` : ''}{saved.review.adjustment.actionTitle ? ` · ${saved.review.adjustment.actionTitle}` : ''}</span>
                    <span>依据：{saved.review.adjustment.rationale}</span>
                    <span>预期结果：{saved.review.adjustment.expectedResult}</span>
                    <small>验证日期：{saved.review.adjustment.verificationDate}{saved.review.adjustment.modifiedByUser ? ' · 保存时由用户调整' : ''}</small>
                  </div>
                </details>
              </article>;
            })}</div>}
          </> : <p className="history-calendar-empty">这一天没有已记录的目标活动或证据。</p>}
        </section>
      </div>
      {filteredUndated.length > 0 && <div className="history-undated"><strong>日期不详的旧完成记录（{filteredUndated.length}）</strong><p>这些旧记录没有保存实际完成时间，因此不会放入具体日期。</p><ul>{filteredUndated.map(item => <li key={item.id}>{item.goalTitle} · {item.title}</li>)}</ul></div>}
      {filteredUndatedEvidence.length > 0 && <div className="history-undated"><strong>未记录实际发生时间的证据（{filteredUndatedEvidence.length}）</strong><p>这些证据仍关联到目标，但缺少 observedAt，因此不会标到某一天。</p><ul>{filteredUndatedEvidence.map(item => <li key={item.id}>{item.goalTitle}{item.actionTitle ? ` · ${item.actionTitle}` : ''} · {item.reference || item.requirement || item.description}</li>)}</ul></div>}
      {filteredUndatedReviews.length > 0 && <div className="history-undated"><strong>无法定位日期的已保存复盘（{filteredUndatedReviews.length}）</strong><p>旧复盘缺少有效保存时间，因此不会猜测日期或放入某一天。</p><ul>{filteredUndatedReviews.map((item, index) => <li key={`${item.review.weekStart}-${index}`}>复盘周 {item.review.weekStart} 至 {item.review.weekEnd} · {item.savedAt || '未记录保存时间'}</li>)}</ul></div>}
      <p className="history-calendar-note">只显示明确关联到具体目标的活动和证据。未关联目标的通用证据仍可在证据区查看，不计入目标历史。</p>
      {history?.goals.length === 0 && <p className="history-calendar-empty">启用目标并记录完成行动后，这里会显示目标历史。</p>}
    </section>
  );
}
