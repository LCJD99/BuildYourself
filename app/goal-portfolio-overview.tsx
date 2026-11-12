'use client';

import type { GoalPortfolioFilter, GoalPortfolioSummary, GoalNavigationDetail } from '@/lib/goal-navigation';

const domainLabels = { learning: '学习', fitness: '健身', project: '项目', general: '通用' } as const;

export default function GoalPortfolioOverview({
  summaries, filter, selectedGoalPlanId, onFilterChange, onOpenGoal, onOpenDetail,
  loading = false,
}: {
  summaries: GoalPortfolioSummary[];
  filter: GoalPortfolioFilter;
  selectedGoalPlanId: string | null;
  onFilterChange: (filter: GoalPortfolioFilter) => void;
  onOpenGoal: (goalPlanId: string) => void;
  onOpenDetail: (detail: GoalNavigationDetail) => void;
  loading?: boolean;
}) {
  return <section className="goal-portfolio" aria-labelledby="goal-portfolio-title">
    <div className="goal-portfolio-heading">
      <div><span className="kicker">ACTIVE GOALS</span><h2 id="goal-portfolio-title">目标组合总览</h2></div>
      <label>筛选目标
        <select aria-label="筛选目标" value={filter} onChange={event => onFilterChange(event.target.value as GoalPortfolioFilter)}>
          <option value="all">全部活跃目标</option><option value="attention">需要关注</option>
        </select>
      </label>
    </div>
    <p className="goal-portfolio-intro">以实际目标、行动、里程碑和关联证据比较目标状态。行动完成数只代表执行记录，不等于目标达成。</p>
    {loading ? <p className="goal-portfolio-loading">正在读取真实目标、行动和证据…</p> : summaries.length ? <div className="goal-portfolio-grid">{summaries.map(summary => <article className={`goal-portfolio-card${summary.goalPlanId === selectedGoalPlanId ? ' selected' : ''}`} key={summary.goalPlanId}>
      <button type="button" className="goal-portfolio-open" onClick={() => onOpenGoal(summary.goalPlanId)}>
        <span className="goal-state active-state">活跃 · {domainLabels[summary.domain]}</span>
        <strong>{summary.title}</strong>
        <span>下一里程碑：{summary.nextMilestone?.title || (summary.milestoneCount ? '已确认全部里程碑' : '尚未设置')}</span>
        <span>行动完成 {summary.completedActionCount}/{summary.actionCount} · 关联近期证据 {summary.recentEvidence.length} 条</span>
      </button>
      {summary.nextAction && <button type="button" className="goal-portfolio-link" onClick={() => onOpenDetail({ kind: 'action', id: summary.nextAction!.id, goalPlanId: summary.goalPlanId })}>
        下一行动详情：{summary.nextAction.title}
      </button>}
      {summary.latestEvidence && <button type="button" className="goal-portfolio-link" onClick={() => onOpenDetail({ kind: 'evidence', id: summary.latestEvidence!.id, goalPlanId: summary.goalPlanId })}>
        最近证据：{summary.latestEvidence.reference} · {summary.latestEvidence.level} · {new Date(summary.latestEvidence.observedAt).toLocaleDateString('zh-CN')}
      </button>}
      <div className="goal-portfolio-risk"><strong>风险提示</strong>
        {summary.riskSignals.length ? <ul>{summary.riskSignals.map(signal => <li key={signal}>{signal}</li>)}</ul> : <p>当前记录未显示逾期行动、里程碑或近期证据缺口。</p>}
      </div>
    </article>)}</div> : <div className="goal-empty"><strong>{filter === 'attention' ? '没有需要关注的活跃目标' : '暂无活跃目标'}</strong><p>{filter === 'attention' ? '当前真实记录未触发里程碑、行动截止或近 30 天证据缺口提示。' : '在 pi 中建立并确认目标后，组合总览会展示目标状态、下一里程碑、近期证据和风险。'}</p></div>}
  </section>;
}
