'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { CompletionEvidence, GoalPlan, GoalPlanEventAction, GoalPlanStatus, PendingGoalAction } from '@/lib/goal-plans';

type GoalPlansState = { plans: GoalPlan[]; pendingActions: PendingGoalAction[] };
type LifecycleAction = 'pause' | 'resume' | 'archive' | 'abandon' | 'request_completion' | 'cancel_completion' | 'confirm_completion';

const statusLabels: Record<GoalPlanStatus, string> = {
  draft: '草稿', active: '活跃', paused: '已暂停', completed: '已完成', archived: '已归档', abandoned: '已放弃',
};
const eventLabels: Record<GoalPlanEventAction, string> = {
  created: '创建草稿', activated: '启用目标', paused: '暂停目标', resumed: '恢复目标',
  completion_requested: '提交完成申请', completion_cancelled: '撤回完成申请', completion_confirmed: '确认完成',
  archived: '归档目标', abandoned: '放弃目标', imported: '迁移时记录已有状态',
};

export default function GoalPlansPanel() {
  const [state, setState] = useState<GoalPlansState>({ plans: [], pendingActions: [] });
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [completionPlanId, setCompletionPlanId] = useState<string | null>(null);
  const [completionEvidence, setCompletionEvidence] = useState<CompletionEvidence[]>([]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/goal-plans', { cache: 'no-store' });
      if (!response.ok) throw new Error('无法读取目标计划');
      setState(await response.json() as GoalPlansState);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取目标计划');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function postLifecycle(plan: GoalPlan, action: LifecycleAction, extra: Record<string, unknown> = {}) {
    let reason: string | null = null;
    if (action === 'pause') {
      reason = window.prompt('暂停原因（可选）')?.trim() ?? null;
      if (reason === null) return;
    }
    if (action === 'archive' || action === 'abandon') {
      reason = window.prompt(action === 'archive' ? '请填写归档原因' : '请填写放弃原因')?.trim() ?? null;
      if (reason === null) return;
      if (!reason) {
        setError('归档或放弃目标时需要填写原因。');
        return;
      }
      if (!window.confirm(`确认${action === 'archive' ? '归档' : '放弃'}「${plan.title || '未命名目标'}」？该操作会结束目标。`)) return;
    }
    if (action === 'resume' && !window.confirm(`恢复「${plan.title || '未命名目标'}」？它会重新进入活跃目标名额和待排池。`)) return;
    if (action === 'confirm_completion' && !window.confirm(`确认「${plan.title || '未命名目标'}」已满足完成条件？`)) return;

    setBusyId(plan.id);
    try {
      const response = await fetch(`/api/goal-plans/${encodeURIComponent(plan.id)}/lifecycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(reason ? { reason } : {}), ...extra, ...(action === 'confirm_completion' ? { confirmed: true } : {}) }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '无法变更目标状态');
      if (action === 'request_completion') {
        setCompletionPlanId(null);
        setCompletionEvidence([]);
      }
      if (action === 'archive' || action === 'abandon' || action === 'confirm_completion') {
        setCompletionPlanId(null);
        setCompletionEvidence([]);
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法变更目标状态');
    } finally {
      setBusyId(null);
    }
  }

  async function activate(plan: GoalPlan) {
    if (!window.confirm(`确认启用「${plan.title}」？启用后，具体近期行动将进入待排池。`)) return;
    setBusyId(plan.id);
    try {
      const response = await fetch(`/api/goal-plans/${encodeURIComponent(plan.id)}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '无法启用目标');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法启用目标');
    } finally {
      setBusyId(null);
    }
  }

  function beginCompletionRequest(plan: GoalPlan) {
    setCompletionPlanId(plan.id);
    setCompletionEvidence(plan.evidenceRequirements.map(requirement => ({
      requirementId: requirement.id,
      description: '',
      level: requirement.minimumLevel ?? 'E1',
    })));
  }

  function updateCompletionEvidence(index: number, patch: Partial<CompletionEvidence>) {
    setCompletionEvidence(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  async function submitCompletionRequest(event: FormEvent<HTMLFormElement>, plan: GoalPlan) {
    event.preventDefault();
    await postLifecycle(plan, 'request_completion', { evidence: completionEvidence });
  }

  function renderCompletion(plan: GoalPlan) {
    if (plan.pendingCompletion) {
      return (
        <div className="goal-completion-review">
          <strong>完成条件已核对，等待你确认</strong>
          <ul>{plan.pendingCompletion.evidence.map(item => {
            const requirement = plan.evidenceRequirements.find(entry => entry.id === item.requirementId);
            return <li key={item.requirementId}>{requirement?.item || '证据'}：{item.description}（{item.level}）</li>;
          })}</ul>
          <div className="goal-lifecycle-actions">
            <button className="primary-button" disabled={busyId === plan.id} onClick={() => void postLifecycle(plan, 'confirm_completion')}>确认完成</button>
            <button className="secondary-button" disabled={busyId === plan.id} onClick={() => void postLifecycle(plan, 'cancel_completion')}>撤回申请</button>
          </div>
        </div>
      );
    }
    if (!['active', 'paused'].includes(plan.status)) return null;
    if (completionPlanId !== plan.id) return null;
    return (
      <form className="goal-completion-form" onSubmit={event => void submitCompletionRequest(event, plan)}>
        <strong>逐项提交完成证据</strong>
        <p>系统会核对每项证据是否达到目标契约中的最低等级，再等待你单独确认完成。</p>
        {plan.evidenceRequirements.map((requirement, index) => (
          <fieldset key={requirement.id}>
            <legend>{requirement.item || '证据要求'} · 最低 {requirement.minimumLevel || '未设置'}</legend>
            <p>{requirement.description}</p>
            <label>证据内容或位置
              <textarea required maxLength={2000} rows={2} value={completionEvidence[index]?.description ?? ''} onChange={event => updateCompletionEvidence(index, { description: event.target.value })} />
            </label>
            <label>证据等级
              <select value={completionEvidence[index]?.level ?? 'E1'} onChange={event => updateCompletionEvidence(index, { level: event.target.value as CompletionEvidence['level'] })}>
                <option value="E1">E1 · 用户自报</option><option value="E2">E2 · 可验证产出</option><option value="E3">E3 · 外部专业反馈</option>
              </select>
            </label>
          </fieldset>
        ))}
        <div className="goal-lifecycle-actions">
          <button className="primary-button" disabled={busyId === plan.id}>提交证据并申请完成</button>
          <button type="button" className="secondary-button" onClick={() => { setCompletionPlanId(null); setCompletionEvidence([]); }}>取消</button>
        </div>
      </form>
    );
  }

  function renderHistory(plan: GoalPlan) {
    return (
      <details className="goal-lifecycle-history">
        <summary>状态记录（{plan.lifecycleEvents.length}）</summary>
        <ol>{plan.lifecycleEvents.map(event => (
          <li key={event.id}>
            <span>{eventLabels[event.action]}</span>
            <time>{new Date(event.createdAt).toLocaleString()}</time>
            {event.reason && <p>{event.reason}</p>}
            {event.evidence?.map(item => {
              const requirement = plan.evidenceRequirements.find(entry => entry.id === item.requirementId);
              return <p key={item.requirementId}>{requirement?.item || '证据'}：{item.description}（{item.level}）</p>;
            })}
          </li>
        ))}</ol>
      </details>
    );
  }

  const active = state.plans.filter(plan => plan.status === 'active');
  const paused = state.plans.filter(plan => plan.status === 'paused');
  const ended = state.plans.filter(plan => ['completed', 'archived', 'abandoned'].includes(plan.status));
  const drafts = state.plans.filter(plan => plan.status === 'draft');

  return (
    <section className="goal-plans" aria-labelledby="goal-plans-title">
      <div className="section-title goal-plans-heading">
        <div><span className="kicker">GOAL CONTRACTS</span><h2 id="goal-plans-title">自然语言目标计划</h2></div>
        <span className="subtle">Pi 对话生成 · 用户确认状态变更</span>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {!state.plans.length && (
        <div className="goal-empty">
          <strong>从一句目标意图开始</strong>
          <p>在 pi 中输入“我想学英语”，Agent 会先澄清影响计划的场景、结果、基础和限制，再生成可编辑草稿。</p>
        </div>
      )}

      {drafts.map(plan => (
        <article className="goal-card draft-goal" key={plan.id}>
          <div className="goal-card-head">
            <div><span className="goal-state draft-state">草稿 · 不进入自动规划</span><h3>{plan.title || '未命名目标'}</h3></div>
            <button className="primary-button" disabled={!plan.validation.ready || busyId === plan.id} onClick={() => void activate(plan)}>
              {busyId === plan.id ? '启用中…' : '核对并启用'}
            </button>
          </div>
          <p className="goal-intent">原始意图：{plan.sourceIntent || '尚未记录'}</p>
          {!plan.validation.ready && (
            <div className="goal-validation"><strong>还需要补充或核对</strong><ul>{plan.validation.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>
          )}
          <dl className="goal-contract">
            <dt>成功描述</dt><dd>{plan.successDescription || '待补充'}</dd>
            <dt>可观察结果</dt><dd>{plan.observableResult || '待补充'}</dd>
            {plan.context && <><dt>使用场景</dt><dd>{plan.context}</dd></>}
            <dt>当前基础</dt><dd>{plan.baselineStatus === 'known' ? '已知' : plan.baselineStatus === 'not_applicable' ? '不适用' : '未知或待测'}{plan.baselineAction ? ` · 基线行动：${plan.baselineAction}` : ''}</dd>
            <dt>关键限制</dt><dd>{plan.constraints.status === 'confirmed' ? (plan.constraints.items.length ? plan.constraints.items.join('；') : '已确认无额外限制') : '待确认'} </dd>
            <dt>复盘周期</dt><dd>{plan.reviewCycleDays ? `每 ${plan.reviewCycleDays} 天` : '待补充'}</dd>
          </dl>
          <div className="goal-subsection">
            <h4>里程碑与评估</h4>
            {plan.milestones.length ? plan.milestones.map(milestone => (
              <div className="goal-milestone" key={milestone.id}>
                <div><span>{milestone.stage === 'near' ? '近期' : '远期'}</span><strong>{milestone.title || '未命名里程碑'}</strong></div>
                <p>{milestone.successCriteria || '标准待细化'}</p>
                <small>标准：{milestone.standardAssessment === 'reasonable' ? '已核对合理' : milestone.standardAssessment === 'provisional' ? '暂定' : '需调整'} · 证据：{milestone.evidenceAvailability === 'available' ? '可获得' : milestone.evidenceAvailability === 'future' ? '进入近期阶段后细化' : milestone.evidenceAvailability === 'unavailable' ? '不可获得' : '待确认'}</small>
                {milestone.reviewNote && <small className="goal-review-note">评估：{milestone.reviewNote}</small>}
                {milestone.evidenceRequirement && <small>证据要求：{milestone.evidenceRequirement}</small>}
              </div>
            )) : <p className="goal-empty-inline">尚未添加里程碑。</p>}
          </div>
          <div className="goal-subsection">
            <h4>证据要求</h4>
            {plan.evidenceRequirements.length ? <ul className="goal-evidence-requirements">
              {plan.evidenceRequirements.map(requirement => <li key={requirement.id}><strong>{requirement.minimumLevel || '未设置等级'}</strong> {requirement.item || '未命名对象'}：{requirement.description || '待补充'}</li>)}
            </ul> : <p className="goal-empty-inline">尚未添加证据要求。</p>}
          </div>
          <div className="goal-subsection">
            <h4>近期行动</h4>
            {plan.nextActions.length ? <ul className="goal-actions">{plan.nextActions.map(action => <li key={action.id}><span>{action.specificity === 'concrete' ? '具体' : '待细化'}</span><div><strong>{action.title || '未命名行动'}</strong>{action.details && <small>{action.details}</small>}</div>{action.estimateMinutes && <em>{action.estimateMinutes} 分钟</em>}</li>)}</ul> : <p className="goal-empty-inline">尚未添加近期行动。</p>}
          </div>
          <p className="goal-edit-hint">可在 pi 中继续对话修改这份草稿；确认前不会安排行动。</p>
          {renderHistory(plan)}
        </article>
      ))}

      {active.map(plan => {
        const actions = state.pendingActions.filter(action => action.goalPlanId === plan.id);
        return (
          <article className="goal-card active-goal" key={plan.id}>
            <div className="goal-card-head">
              <div><span className="goal-state active-state">活跃 · {plan.domain === 'learning' ? '学习目标' : plan.domain === 'fitness' ? '健身目标' : plan.domain === 'project' ? '项目目标' : '通用目标'}</span><h3>{plan.title}</h3></div>
              <span className="goal-review">每 {plan.reviewCycleDays} 天复盘</span>
            </div>
            <div className="goal-lifecycle-actions">
              <button className="secondary-button" disabled={busyId === plan.id} onClick={() => void postLifecycle(plan, 'pause')}>暂停</button>
              <button className="secondary-button" disabled={busyId === plan.id || !!plan.pendingCompletion} onClick={() => beginCompletionRequest(plan)}>申请完成</button>
              <button className="text-button" disabled={busyId === plan.id} onClick={() => void postLifecycle(plan, 'archive')}>归档</button>
              <button className="text-button" disabled={busyId === plan.id} onClick={() => void postLifecycle(plan, 'abandon')}>放弃</button>
            </div>
            {renderCompletion(plan)}
            <dl className="goal-contract">
              <dt>成功描述</dt><dd>{plan.successDescription}</dd>
              <dt>可观察结果</dt><dd>{plan.observableResult}</dd>
              {plan.context && <><dt>使用场景</dt><dd>{plan.context}</dd></>}
              {plan.baselineAction && <><dt>基线行动</dt><dd>{plan.baselineAction}</dd></>}
              <dt>关键限制</dt><dd>{plan.constraints.items.length ? plan.constraints.items.join('；') : '已确认无额外限制'}</dd>
            </dl>
            <div className="goal-subsection">
              <h4>里程碑与证据核对</h4>
              {plan.milestones.map(milestone => (
                <div className="goal-milestone" key={milestone.id}>
                  <div><span>{milestone.stage === 'near' ? '近期' : '远期'}</span><strong>{milestone.title}</strong></div>
                  {milestone.successCriteria && <p>{milestone.successCriteria}</p>}
                  <small>标准：{milestone.standardAssessment === 'reasonable' ? '已核对' : '暂定'} · 证据：{milestone.evidenceAvailability === 'available' ? '可获得' : milestone.evidenceAvailability === 'future' ? '进入近期阶段后细化' : '待确认'}</small>
                  {milestone.reviewNote && <small className="goal-review-note">评估：{milestone.reviewNote}</small>}
                  {milestone.evidenceRequirement && <small>要求：{milestone.evidenceRequirement}</small>}
                </div>
              ))}
            </div>
            <div className="goal-subsection">
              <h4>证据要求</h4>
              <ul className="goal-evidence-requirements">{plan.evidenceRequirements.map(requirement => <li key={requirement.id}><strong>{requirement.minimumLevel}</strong> {requirement.item}：{requirement.description}</li>)}</ul>
            </div>
            <div className="goal-subsection">
              <h4>近期行动 <span className="count">{actions.length} 项待排</span></h4>
              {actions.length ? <ul className="goal-actions">{actions.map(action => <li key={action.id}><span>待排</span><div><strong>{action.title}</strong>{action.details && <small>{action.details}</small>}</div>{action.estimateMinutes && <em>{action.estimateMinutes} 分钟</em>}</li>)}</ul> : <p className="goal-empty-inline">当前没有待排行动。</p>}
            </div>
            {renderHistory(plan)}
          </article>
        );
      })}
      {active.length > 0 && <p className="goal-capacity-note">活跃目标 {active.length}/10。待排行动还没有进入日级计划。</p>}

      {(paused.length > 0 || ended.length > 0) && (
        <section className="goal-history-section" aria-labelledby="goal-history-title">
          <div className="section-title"><div><span className="kicker">GOAL HISTORY</span><h2 id="goal-history-title">已暂停与历史目标</h2></div><span className="subtle">保留状态、原因和变更记录</span></div>
          {[...paused, ...ended].map(plan => (
            <article className="goal-card historical-goal" key={plan.id}>
              <div className="goal-card-head">
                <div><span className={`goal-state ${plan.status === 'paused' ? 'paused-state' : 'ended-state'}`}>{statusLabels[plan.status]}</span><h3>{plan.title || '未命名目标'}</h3></div>
                {plan.status === 'paused' && <div className="goal-lifecycle-actions">
                  <button className="primary-button" disabled={busyId === plan.id} onClick={() => void postLifecycle(plan, 'resume')}>恢复目标</button>
                  <button className="secondary-button" disabled={busyId === plan.id || !!plan.pendingCompletion} onClick={() => beginCompletionRequest(plan)}>申请完成</button>
                  <button className="text-button" disabled={busyId === plan.id} onClick={() => void postLifecycle(plan, 'archive')}>归档</button>
                  <button className="text-button" disabled={busyId === plan.id} onClick={() => void postLifecycle(plan, 'abandon')}>放弃</button>
                </div>}
              </div>
              {plan.lifecycleReason && <p className="goal-lifecycle-reason">原因：{plan.lifecycleReason}</p>}
              {plan.status === 'completed' && plan.completedAt && <p className="goal-lifecycle-reason">完成时间：{new Date(plan.completedAt).toLocaleString()}</p>}
              {renderCompletion(plan)}
              {renderHistory(plan)}
            </article>
          ))}
        </section>
      )}
      <p className="goal-capacity-note">当前活跃目标 {active.length}/10。暂停、完成、归档和放弃的目标保留在历史中。</p>
    </section>
  );
}
