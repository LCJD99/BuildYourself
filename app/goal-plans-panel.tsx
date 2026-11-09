'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { CompletionEvidence, GoalPlan, GoalPlanAction, GoalPlanEventAction, GoalPlanStatus, PendingGoalAction } from '@/lib/goal-plans';
import type { TaskChangeEvent } from '@/lib/milestone-store';

type GoalPlansState = { plans: GoalPlan[]; pendingActions: PendingGoalAction[]; actions: GoalPlanAction[]; taskChanges: TaskChangeEvent[] };
type LifecycleAction = 'pause' | 'resume' | 'archive' | 'abandon' | 'request_completion' | 'cancel_completion' | 'confirm_completion';
type TaskDraft = {
  title: string;
  projectName: string;
  details: string;
  deadline: string;
  estimateMinutes: string;
  dependencyIds: string[];
  successCriteria: string;
  evidenceRequirement: string;
};

const statusLabels: Record<GoalPlanStatus, string> = {
  draft: '草稿', active: '活跃', paused: '已暂停', completed: '已完成', archived: '已归档', abandoned: '已放弃',
};
const eventLabels: Record<GoalPlanEventAction, string> = {
  created: '创建草稿', activated: '启用目标', paused: '暂停目标', resumed: '恢复目标',
  completion_requested: '提交完成申请', completion_cancelled: '撤回完成申请', completion_confirmed: '确认完成',
  archived: '归档目标', abandoned: '放弃目标', imported: '迁移时记录已有状态',
};

function emptyTaskDraft(): TaskDraft {
  return { title: '', projectName: '', details: '', deadline: '', estimateMinutes: '', dependencyIds: [], successCriteria: '', evidenceRequirement: '' };
}

function formatDate(value: string | null) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString('zh-CN') : '未设置';
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatTaskChangeValue(value: unknown, actions: GoalPlanAction[]) {
  if (value === null || value === undefined || value === '') return '未设置';
  if (Array.isArray(value)) {
    const names = value.map(id => actions.find(action => action.id === id)?.title ?? String(id));
    return names.length ? names.join('、') : '无';
  }
  if (typeof value === 'number') return `${value} 分钟`;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export default function GoalPlansPanel({ focusActionId }: { focusActionId?: string | null }) {
  const [state, setState] = useState<GoalPlansState>({ plans: [], pendingActions: [], actions: [], taskChanges: [] });
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [completionPlanId, setCompletionPlanId] = useState<string | null>(null);
  const [completionEvidence, setCompletionEvidence] = useState<CompletionEvidence[]>([]);
  const [taskGoalPlanId, setTaskGoalPlanId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
  const [savingTask, setSavingTask] = useState(false);
  const lastScrolledFocus = useRef<string | null>(null);

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

  useEffect(() => {
    if (!focusActionId || lastScrolledFocus.current === focusActionId) return;
    const target = document.getElementById(`goal-action-${focusActionId}`)
      ?? document.getElementById(`goal-plan-${focusActionId.split(':', 1)[0]}`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      lastScrolledFocus.current = focusActionId;
    }
  }, [focusActionId, state.plans, state.pendingActions, state.actions]);

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

  function beginTaskCreate(goalPlanId: string) {
    setTaskGoalPlanId(goalPlanId);
    setEditingTaskId(null);
    setTaskDraft(emptyTaskDraft());
    setError('');
  }

  function beginTaskEdit(task: GoalPlanAction) {
    setTaskGoalPlanId(task.goalPlanId);
    setEditingTaskId(task.id);
    setTaskDraft({
      title: task.title,
      projectName: task.projectName ?? '',
      details: task.details ?? '',
      deadline: task.deadline ?? '',
      estimateMinutes: task.estimateMinutes?.toString() ?? '',
      dependencyIds: task.dependencyIds,
      successCriteria: task.successCriteria ?? '',
      evidenceRequirement: task.evidenceRequirement ?? '',
    });
    setError('');
  }

  function updateTaskDraft(update: Partial<TaskDraft>) {
    setTaskDraft(current => current ? { ...current, ...update } : current);
  }

  function cancelTaskEdit() {
    setTaskGoalPlanId(null);
    setEditingTaskId(null);
    setTaskDraft(null);
    setError('');
  }

  async function saveTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!taskDraft || !taskGoalPlanId) return;
    setSavingTask(true);
    try {
      const url = editingTaskId ? `/api/tasks/${encodeURIComponent(editingTaskId)}` : '/api/tasks';
      const response = await fetch(url, {
        method: editingTaskId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goalPlanId: taskGoalPlanId,
          title: taskDraft.title,
          projectName: taskDraft.projectName,
          details: taskDraft.details,
          deadline: taskDraft.deadline || null,
          estimateMinutes: taskDraft.estimateMinutes === '' ? null : Number(taskDraft.estimateMinutes),
          dependencyIds: taskDraft.dependencyIds,
          successCriteria: taskDraft.successCriteria,
          evidenceRequirement: taskDraft.evidenceRequirement,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '无法保存任务');
      setTaskGoalPlanId(null);
      setEditingTaskId(null);
      setTaskDraft(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存任务');
    } finally {
      setSavingTask(false);
    }
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
        const actions = state.actions.filter(action => action.goalPlanId === plan.id);
        const taskChanges = state.taskChanges.filter(change => change.details.goalPlanId === plan.id).slice(0, 5);
        const editingHere = taskGoalPlanId === plan.id && taskDraft !== null;
        return (
          <article className="goal-card active-goal" id={`goal-plan-${plan.id}`} key={plan.id}>
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
              <div className="task-section-heading">
                <h4>任务与待排池 <span className="count">{actions.length} 项 · {actions.filter(action => action.status === 'pending_schedule').length} 项待排</span></h4>
                <button type="button" className="secondary-button" onClick={() => beginTaskCreate(plan.id)}>新增任务</button>
              </div>
              {actions.length ? <div className="goal-task-list">{actions.map(action => (
                <article className="goal-task-card" id={`goal-action-${action.id}`} key={action.id}>
                  <div className="goal-task-card-head">
                    <div><span className={`goal-task-status ${action.status}`}>{action.status === 'pending_schedule' ? '待排' : action.status === 'scheduled' ? '已安排' : '已完成'}</span><strong>{action.title}</strong></div>
                    <button type="button" className="edit-evidence-button" onClick={() => beginTaskEdit(action)}>编辑</button>
                  </div>
                  {action.details && <p className="goal-task-description">{action.details}</p>}
                  <dl className="goal-task-details">
                    <dt>归属</dt><dd>{action.projectName ? `${plan.title} · ${action.projectName}` : plan.title}</dd>
                    <dt>截止日期</dt><dd>{formatDate(action.deadline)}</dd>
                    <dt>预计耗时</dt><dd>{action.estimateMinutes === null ? '未设置' : `${action.estimateMinutes} 分钟`}</dd>
                    <dt>依赖</dt><dd>{action.dependencyIds.length ? action.dependencyIds.map(id => actions.find(candidate => candidate.id === id)?.title ?? '未知任务').join('、') : '无'}</dd>
                    <dt>完成标准</dt><dd>{action.successCriteria || '未设置'}</dd>
                    <dt>证据要求</dt><dd>{action.evidenceRequirement || '未设置'}</dd>
                  </dl>
                </article>
              ))}</div> : <p className="goal-empty-inline">当前没有任务。新增后可在待排池中查看和安排。</p>}

              {editingHere && taskDraft && <form className="task-editor" onSubmit={event => void saveTask(event)}>
                <div className="task-editor-heading"><strong>{editingTaskId ? '编辑任务' : '新增任务'}</strong><span>任务归属：{plan.title}</span></div>
                <div className="task-editor-grid">
                  <label>任务名称<input required maxLength={240} value={taskDraft.title} onChange={event => updateTaskDraft({ title: event.target.value })} /></label>
                  <label>所属项目（可选）<input maxLength={240} value={taskDraft.projectName} onChange={event => updateTaskDraft({ projectName: event.target.value })} /></label>
                  <label>截止日期<input type="date" value={taskDraft.deadline} onChange={event => updateTaskDraft({ deadline: event.target.value })} /></label>
                  <label>预计耗时（分钟）<input type="number" min="1" max="10080" step="1" value={taskDraft.estimateMinutes} onChange={event => updateTaskDraft({ estimateMinutes: event.target.value })} /></label>
                  <label className="task-editor-wide">任务说明<textarea rows={2} value={taskDraft.details} onChange={event => updateTaskDraft({ details: event.target.value })} /></label>
                  <label className="task-editor-wide">完成标准<textarea rows={2} value={taskDraft.successCriteria} onChange={event => updateTaskDraft({ successCriteria: event.target.value })} /></label>
                  <label className="task-editor-wide">证据要求<textarea rows={2} value={taskDraft.evidenceRequirement} onChange={event => updateTaskDraft({ evidenceRequirement: event.target.value })} /></label>
                </div>
                <fieldset className="task-dependencies">
                  <legend>前置任务（可选）</legend>
                  {actions.filter(action => action.id !== editingTaskId).length ? actions.filter(action => action.id !== editingTaskId).map(action => (
                    <label key={action.id}><input type="checkbox" checked={taskDraft.dependencyIds.includes(action.id)} onChange={event => updateTaskDraft({ dependencyIds: event.target.checked ? [...taskDraft.dependencyIds, action.id] : taskDraft.dependencyIds.filter(id => id !== action.id) })} />{action.title}</label>
                  )) : <span>该目标下还没有其他任务。</span>}
                </fieldset>
                <div className="task-editor-actions">
                  <button type="button" className="secondary-button" disabled={savingTask} onClick={cancelTaskEdit}>取消</button>
                  <button type="submit" className="primary-button" disabled={savingTask}>{savingTask ? '保存中…' : '保存任务'}</button>
                </div>
              </form>}

              <div className="task-change-log">
                <h4>最近变更</h4>
                {taskChanges.length ? <ol>{taskChanges.map(change => <li key={change.id}>
                  <time>{formatDateTime(change.createdAt)}</time><span>{change.summary}</span>
                  {change.details.fieldChanges?.length ? <details className="task-change-details"><summary>查看字段变化</summary><ul>{change.details.fieldChanges.map((fieldChange, index) => <li key={`${change.id}-${index}`}><strong>{fieldChange.field}</strong><span>原：{formatTaskChangeValue(fieldChange.before, actions)}</span><span>现：{formatTaskChangeValue(fieldChange.after, actions)}</span></li>)}</ul></details> : null}
                </li>)}</ol> : <p>暂无任务变更记录。</p>}
              </div>
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
