'use client';

import type { GoalPlanPanelDetail } from './goal-plans-panel';

function date(value: string | null) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString('zh-CN') : '未设置';
}

function dateTime(value: string) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString('zh-CN') : value;
}

export default function GoalNavigationDetailPane({ detail, conflictNotes = [] }: {
  detail: GoalPlanPanelDetail;
  conflictNotes?: string[];
}) {
  if (detail.kind === 'action') {
    const { goal, action, actions } = detail;
    const unfinishedDependencies = action.dependencyIds.map(id => actions.find(item => item.id === id))
      .filter(item => item && item.status !== 'done');
    return <section className="goal-navigation-detail" aria-labelledby="goal-navigation-detail-title">
      <span className="kicker">ACTION DETAIL</span><h2 id="goal-navigation-detail-title">{action.title}</h2>
      <p className="detail-intro">当前节点：{goal.title} / {action.title}</p>
      <dl className="goal-detail-facts">
        <dt>归属</dt><dd>{goal.title}{action.projectName ? ` · ${action.projectName}` : ''}</dd>
        <dt>状态</dt><dd>{action.status === 'done' ? '已完成' : action.status === 'scheduled' ? '已安排' : '待排'}{action.decomposedAt ? ' · 已拆分' : ''}</dd>
        <dt>截止</dt><dd>{date(action.deadline)}</dd>
        <dt>预计耗时</dt><dd>{action.estimateMinutes === null ? '未设置' : `${action.estimateMinutes} 分钟`}</dd>
        <dt>依赖</dt><dd>{action.dependencyIds.length ? action.dependencyIds.map(id => {
          const dependency = actions.find(item => item.id === id);
          return dependency ? `${dependency.title}（${dependency.status === 'done' ? '已完成' : dependency.status === 'scheduled' ? '已安排' : '待排'}）` : '关联任务已不在当前列表';
        }).join('；') : '无'}</dd>
        <dt>完成标准</dt><dd>{action.successCriteria || '未设置'}</dd>
        <dt>证据要求</dt><dd>{action.evidenceRequirement || '未设置'}</dd>
      </dl>
      <section className="goal-detail-section"><h3>冲突与安排</h3>
        {unfinishedDependencies.length ? <p>前置任务尚未完成：{unfinishedDependencies.map(item => item!.title).join('、')}。</p> : null}
        {conflictNotes.length ? <ul>{conflictNotes.map(note => <li key={note}>{note}</li>)}</ul> : <p>当前日级计划没有提供此行动的排期冲突记录。</p>}
      </section>
      <section className="goal-detail-section"><h3>最近变更</h3>
        {detail.changes.length ? <ol>{detail.changes.slice(0, 5).map(change => <li key={change.id}><time>{dateTime(change.createdAt)}</time><span>{change.summary}</span>
          {change.details.fieldChanges?.map((field, index) => <small key={`${change.id}-${index}`}>{field.field}：{String(field.before ?? '未设置')} → {String(field.after ?? '未设置')}</small>)}
        </li>)}</ol> : <p>暂无任务变更记录。</p>}
      </section>
      <section className="goal-detail-agent"><h3>适用的 Agent 建议</h3>
        <p>{unfinishedDependencies.length
          ? `先完成前置任务「${unfinishedDependencies[0]!.title}」，再安排本行动。`
          : action.status === 'pending_schedule'
            ? `核对 ${action.estimateMinutes === null ? '预计耗时' : `${action.estimateMinutes} 分钟预计耗时`}、${action.deadline ? `${action.deadline} 截止日期` : '截止日期'}与日级容量后，再将此行动排入计划。`
            : action.status === 'done'
              ? `将符合“${action.evidenceRequirement || '完成标准'}”的证据关联到此行动，再按里程碑标准核对结果。`
              : `执行后保存符合“${action.evidenceRequirement || '完成标准'}”的证据，并根据里程碑“${action.milestoneCriteria || '尚未配置'}”核对结果。`}</p>
        <small>依据：当前目标依赖、行动状态与用户确认的完成标准。</small>
      </section>
    </section>;
  }

  const { goal, evidence, relatedAction, actions } = detail;
  const linkedMilestone = goal.milestones.find(milestone => evidence.links.includes('milestone'));
  return <section className="goal-navigation-detail" aria-labelledby="goal-navigation-detail-title">
    <span className="kicker">EVIDENCE DETAIL</span><h2 id="goal-navigation-detail-title">{evidence.reference}</h2>
    <p className="detail-intro">当前节点：{goal.title} / 证据 · {evidence.reference}</p>
    <dl className="goal-detail-facts">
      <dt>所属目标</dt><dd>{goal.title}</dd>
      <dt>关联行动</dt><dd>{relatedAction?.title ?? '未关联目标行动'}</dd>
      <dt>来源与引用</dt><dd>{evidence.source} · {evidence.reference}</dd>
      <dt>证据等级</dt><dd>{evidence.level}</dd>
      <dt>发生时间</dt><dd>{dateTime(evidence.observedAt)}</dd>
      <dt>最近更正</dt><dd>{evidence.lastCorrectedAt ? dateTime(evidence.lastCorrectedAt) : '未更正'}{evidence.revisionCount ? ` · ${evidence.revisionCount} 次` : ''}</dd>
      <dt>关联对象</dt><dd>{evidence.links.join('、') || '无'}</dd>
      {relatedAction && <>
        <dt>行动截止</dt><dd>{date(relatedAction.deadline)}</dd>
        <dt>预计耗时</dt><dd>{relatedAction.estimateMinutes === null ? '未设置' : `${relatedAction.estimateMinutes} 分钟`}</dd>
        <dt>行动依赖</dt><dd>{relatedAction.dependencyIds.length ? relatedAction.dependencyIds.map(id => actions.find(action => action.id === id)?.title ?? '关联任务已不在当前列表').join('、') : '无'}</dd>
      </>}
    </dl>
    <section className="goal-detail-section"><h3>证据内容</h3><p className="goal-detail-evidence-text">{evidence.text}</p>
      {evidence.reportSubmitted !== null && <small>报告已提交：{evidence.reportSubmitted ? '是' : '否'}</small>}
      {evidence.benchmarkComplete !== null && <small>完整基准测试：{evidence.benchmarkComplete ? '是' : '否'}</small>}
      {evidence.latencyMs !== null && <small>实测延迟：{evidence.latencyMs} ms</small>}
      {evidence.revisions?.length ? <ol>{evidence.revisions.slice(-3).map((revision, index) => <li key={`${revision.changedAt}-${index}`}><time>{dateTime(revision.changedAt)}</time><span>证据记录已更正；当前内容保留在上方。</span></li>)}</ol> : null}
    </section>
    <section className="goal-detail-section"><h3>完成标准与证据要求</h3>
      <p>{linkedMilestone ? `里程碑「${linkedMilestone.title}」：${linkedMilestone.successCriteria || '未设置成功标准'}；${linkedMilestone.evidenceRequirement || '尚未设置专门证据要求'}。` : relatedAction ? `行动完成标准：${relatedAction.successCriteria || '未设置'}；证据要求：${relatedAction.evidenceRequirement || '未设置'}。` : '当前证据未关联可核对的里程碑或行动标准。'}</p>
    </section>
    {relatedAction && <section className="goal-detail-section"><h3>行动冲突与最近变更</h3>
      {conflictNotes.length ? <ul>{conflictNotes.map(note => <li key={note}>{note}</li>)}</ul> : <p>当前日级计划没有此行动的排期冲突记录。</p>}
      {detail.changes.length ? <ol>{detail.changes.slice(0, 3).map(change => <li key={change.id}><time>{dateTime(change.createdAt)}</time><span>{change.summary}</span></li>)}</ol> : <small>没有关联行动变更记录。</small>}
    </section>}
    <section className="goal-detail-agent"><h3>适用的 Agent 建议</h3>
      <p>{linkedMilestone
        ? `按里程碑「${linkedMilestone.title}」的成功标准核对证据内容，并确认 ${linkedMilestone.evidenceRequirement || '所需证据等级'}。证据等级本身不代表标准已达成。`
        : relatedAction
          ? `核对证据是否满足行动「${relatedAction.title}」的完成标准和证据要求。`
          : '先将证据关联到实际目标行动或里程碑，再进行目标进展判定。'}</p>
      <small>依据：证据关联关系与当前目标契约；建议仅作核对提示。</small>
    </section>
  </section>;
}
