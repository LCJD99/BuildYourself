'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { CompletionEvidence, GoalPlan, GoalPlanAction, GoalPlanEventAction, GoalPlanStatus, GoalProject, PendingGoalAction, ProposedGoalAction, TaskDecompositionProposal } from '@/lib/goal-plans';
import type { Evidence } from '@/lib/model';
import type { TaskChangeEvent } from '@/lib/milestone-store';

type GoalPlansState = { plans: GoalPlan[]; pendingActions: PendingGoalAction[]; actions: GoalPlanAction[]; taskChanges: TaskChangeEvent[]; taskProposals: TaskDecompositionProposal[]; projects: GoalProject[]; evidence: Evidence[] };
type LifecycleAction = 'pause' | 'resume' | 'archive' | 'abandon' | 'request_completion' | 'cancel_completion' | 'confirm_completion';
type TaskDraft = {
  title: string;
  projectId: string;
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
  contract_changed: '更新目标契约', progress_confirmed: '确认进展评价',
};

function emptyTaskDraft(): TaskDraft {
  return { title: '', projectId: '', details: '', deadline: '', estimateMinutes: '', dependencyIds: [], successCriteria: '', evidenceRequirement: '' };
}

function formatDate(value: string | null) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString('zh-CN') : '未设置';
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

function dateTimeInput(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '';
  parsed.setMinutes(parsed.getMinutes() - parsed.getTimezoneOffset());
  return parsed.toISOString().slice(0, 16);
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

export default function GoalPlansPanel({ focusActionId, selectedProjectId }: { focusActionId?: string | null; selectedProjectId?: string | null }) {
  const [state, setState] = useState<GoalPlansState>({ plans: [], pendingActions: [], actions: [], taskChanges: [], taskProposals: [], projects: [], evidence: [] });
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [completionPlanId, setCompletionPlanId] = useState<string | null>(null);
  const [completionEvidence, setCompletionEvidence] = useState<CompletionEvidence[]>([]);
  const [taskGoalPlanId, setTaskGoalPlanId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
  const [savingTask, setSavingTask] = useState(false);
  const [editingProposalId, setEditingProposalId] = useState<string | null>(null);
  const [proposalDraft, setProposalDraft] = useState<ProposedGoalAction[] | null>(null);
  const [savingProposal, setSavingProposal] = useState(false);
  const [projectTitleDraft, setProjectTitleDraft] = useState('');
  const [projectSelection, setProjectSelection] = useState('');
  const [milestoneSelection, setMilestoneSelection] = useState('');
  const [evidenceSelection, setEvidenceSelection] = useState('');
  const [editingProjectEvidenceId, setEditingProjectEvidenceId] = useState<string | null>(null);
  const [projectEvidenceDraft, setProjectEvidenceDraft] = useState<Evidence | null>(null);
  const [savingProjectLink, setSavingProjectLink] = useState(false);
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
      observedAt: new Date().toISOString(),
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
            <label>证据实际发生时间
              <input required type="datetime-local" value={dateTimeInput(completionEvidence[index]?.observedAt ?? '')} onChange={event => updateCompletionEvidence(index, { observedAt: event.target.value ? new Date(event.target.value).toISOString() : '' })} />
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

  function beginTaskCreate(goalPlanId: string, projectId = '') {
    setTaskGoalPlanId(goalPlanId);
    setEditingTaskId(null);
    setTaskDraft({ ...emptyTaskDraft(), projectId });
    setError('');
  }

  function beginTaskEdit(task: GoalPlanAction) {
    setTaskGoalPlanId(task.goalPlanId);
    setEditingTaskId(task.id);
    setTaskDraft({
      title: task.title,
      projectId: task.projectId ?? '',
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

  async function linkProjectToGoal(goalPlanId: string, title: string) {
    setSavingProjectLink(true);
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, goalPlanId }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '无法关联项目');
      setProjectTitleDraft('');
      setProjectSelection('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法关联项目');
    } finally {
      setSavingProjectLink(false);
    }
  }

  async function linkExistingProjectToGoal(goalPlanId: string, projectId: string) {
    setSavingProjectLink(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goalPlanId }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '无法关联项目');
      setProjectSelection('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法关联项目');
    } finally {
      setSavingProjectLink(false);
    }
  }

  async function linkMilestoneToProject(projectId: string) {
    const [goalPlanId, milestoneId] = milestoneSelection.split(':');
    if (!goalPlanId || !milestoneId) return;
    setSavingProjectLink(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goalPlanId, milestoneId }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '无法关联里程碑');
      setMilestoneSelection('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法关联里程碑');
    } finally {
      setSavingProjectLink(false);
    }
  }

  async function linkEvidenceToProject(projectId: string) {
    if (!evidenceSelection) return;
    setSavingProjectLink(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/evidence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ evidenceId: evidenceSelection }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '无法关联证据');
      setEvidenceSelection('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法关联证据');
    } finally {
      setSavingProjectLink(false);
    }
  }

  function beginProjectEvidenceEdit(evidence: Evidence) {
    const parsed = new Date(evidence.observedAt);
    parsed.setMinutes(parsed.getMinutes() - parsed.getTimezoneOffset());
    setEditingProjectEvidenceId(evidence.id);
    setProjectEvidenceDraft({ ...evidence, observedAt: parsed.toISOString().slice(0, 16) });
  }

  async function saveProjectEvidence(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectEvidenceDraft) return;
    setSavingProjectLink(true);
    try {
      const response = await fetch('/api/evidence', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...projectEvidenceDraft, observedAt: new Date(projectEvidenceDraft.observedAt).toISOString() }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '无法更正证据');
      setEditingProjectEvidenceId(null);
      setProjectEvidenceDraft(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法更正证据');
    } finally {
      setSavingProjectLink(false);
    }
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
          projectId: taskDraft.projectId || null,
          projectName: state.projects.find(project => project.id === taskDraft.projectId)?.title ?? null,
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

  function beginProposalEdit(proposal: TaskDecompositionProposal) {
    setEditingProposalId(proposal.id);
    setProposalDraft(proposal.tasks.map(task => ({ ...task, dependencyIds: [...task.dependencyIds] })));
    setError('');
  }

  function updateProposalTask(index: number, patch: Partial<ProposedGoalAction>) {
    setProposalDraft(current => current ? current.map((task, taskIndex) => taskIndex === index ? { ...task, ...patch } : task) : current);
  }

  async function saveProposalEdit(event: FormEvent<HTMLFormElement>, proposalId: string) {
    event.preventDefault();
    if (!proposalDraft) return;
    setSavingProposal(true);
    try {
      const response = await fetch(`/api/task-decompositions/${encodeURIComponent(proposalId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'edit', tasks: proposalDraft }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '无法保存拆分修改');
      setEditingProposalId(null);
      setProposalDraft(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存拆分修改');
    } finally {
      setSavingProposal(false);
    }
  }

  async function resolveProposal(proposal: TaskDecompositionProposal, action: 'confirm' | 'reject') {
    const parentTask = state.actions.find(task => task.id === proposal.parentActionId);
    const taskSummary = proposal.tasks.map(task => {
      const dependencies = task.dependencyIds.map(id => proposal.tasks.find(candidate => candidate.id === id)?.title ?? id).join('、') || '无';
      const deadline = task.deadline ? formatDate(task.deadline) : `沿用父任务（${formatDate(parentTask?.deadline ?? null)}）`;
      return `· ${task.title}（${task.estimateMinutes} 分钟，截止 ${deadline}，依赖 ${dependencies}）：${task.successCriteria}`;
    }).join('\n');
    const summary = action === 'confirm'
      ? `确认后「${state.actions.find(task => task.id === proposal.parentActionId)?.title || '父任务'}」会退出待排池，子任务进入待排池：\n${taskSummary}`
      : `拒绝后父任务保持原样，提议会记录为已拒绝：\n${taskSummary}`;
    if (!window.confirm(`${action === 'confirm' ? '确认' : '拒绝'}这份拆分提议？\n\n${summary}`)) return;
    setSavingProposal(true);
    try {
      const response = await fetch(`/api/task-decompositions/${encodeURIComponent(proposal.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '无法处理拆分提议');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法处理拆分提议');
    } finally {
      setSavingProposal(false);
    }
  }

  function renderTaskEditor(plan: GoalPlan, actions: GoalPlanAction[]) {
    if (taskGoalPlanId !== plan.id || !taskDraft) return null;
    return <form className="task-editor" onSubmit={event => void saveTask(event)}>
      <div className="task-editor-heading"><strong>{editingTaskId ? '编辑任务' : '新增任务'}</strong><span>任务归属：{plan.title}</span></div>
      <div className="task-editor-grid">
        <label>任务名称<input required maxLength={240} value={taskDraft.title} onChange={event => updateTaskDraft({ title: event.target.value })} /></label>
        <label>关联共享项目（可选）<select value={taskDraft.projectId} onChange={event => updateTaskDraft({ projectId: event.target.value })}>
          <option value="">不关联项目</option>
          {state.projects.map(project => <option key={project.id} value={project.id}>{project.title} · {project.goals.find(goal => goal.goalPlanId === project.primaryGoalPlanId)?.title || '无目标'} · {project.id.slice(0, 6)}</option>)}
        </select></label>
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
    </form>;
  }

  async function markTaskDone(action: GoalPlanAction) {
    setBusyId(action.id);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(action.id)}/completion`, { method: 'POST' });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '无法记录行动完成时间');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法记录行动完成时间');
    } finally {
      setBusyId(null);
    }
  }
  const active = state.plans.filter(plan => plan.status === 'active');
  const paused = state.plans.filter(plan => plan.status === 'paused');
  const ended = state.plans.filter(plan => ['completed', 'archived', 'abandoned'].includes(plan.status));
  const drafts = state.plans.filter(plan => plan.status === 'draft');
  const selectedProject = state.projects.find(project => project.id === selectedProjectId);

  if (selectedProjectId) {
    const project = selectedProject;
    if (!project) return <section className="project-workspace"><p>正在读取共享项目…</p></section>;
    const linkedPlanIds = new Set(project.goals.map(goal => goal.goalPlanId));
    const projectActions = state.actions.filter(action => action.projectId === project.id);
    const projectPlans = state.plans.filter(plan => linkedPlanIds.has(plan.id));
    const createTaskPlan = projectPlans.find(plan => plan.id === project.primaryGoalPlanId && plan.status === 'active')
      ?? projectPlans.find(plan => plan.status === 'active');
    const editorPlan = taskGoalPlanId ? projectPlans.find(plan => plan.id === taskGoalPlanId) : undefined;
    const linkedEvidenceIds = new Set(project.evidence.map(item => item.id));
    const availableEvidence = state.evidence.filter(item => !linkedEvidenceIds.has(item.id));
    const linkedMilestoneKeys = new Set(project.milestones.map(({ goalPlanId, milestone }) => `${goalPlanId}:${milestone.id}`));
    const availableMilestones = projectPlans.flatMap(plan => plan.milestones
      .filter(milestone => !linkedMilestoneKeys.has(`${plan.id}:${milestone.id}`))
      .map(milestone => ({ goalPlanId: plan.id, goalTitle: plan.title, milestone })));
    return <section className="project-workspace" aria-labelledby="project-workspace-title">
      <div className="project-workspace-heading">
        <div><span className="kicker">SHARED PROJECT</span><h2 id="project-workspace-title">{project.title}</h2><small className="project-id">项目 ID · {project.id}</small></div>
        <span className="subtle">多个入口共用同一份项目记录</span>
      </div>
      <div className="project-workspace-section">
        <h3>关联目标</h3>
        <div className="project-goal-links">{project.goals.map(goal => <span key={goal.goalPlanId} className={goal.goalPlanId === project.primaryGoalPlanId ? 'primary-project-goal' : ''}>
          {goal.goalPlanId === project.primaryGoalPlanId ? '主要位置 · ' : '关联入口 · '}{goal.title} · {statusLabels[goal.status]}
        </span>)}</div>
      </div>
      <div className="project-workspace-section">
        <div className="project-section-heading"><h3>共享任务 <span className="count">{projectActions.length}</span></h3>
          {createTaskPlan && <button type="button" className="secondary-button" onClick={() => beginTaskCreate(createTaskPlan.id, project.id)}>新增任务</button>}
        </div>
        {projectActions.length ? <div className="goal-task-list">{projectActions.map(action => (
          <article className="goal-task-card" key={action.id}>
            <div className="goal-task-card-head"><div><span className={`goal-task-status ${action.status}`}>{action.status === 'pending_schedule' ? '待排' : action.status === 'scheduled' ? '已安排' : '已完成'}</span><strong>{action.title}</strong></div>
              <button type="button" className="edit-evidence-button" onClick={() => beginTaskEdit(action)}>编辑</button>
            </div>
            {action.details && <p className="goal-task-description">{action.details}</p>}
            <dl className="goal-task-details"><dt>归属目标</dt><dd>{action.goalTitle}</dd><dt>截止日期</dt><dd>{formatDate(action.deadline)}</dd><dt>预计耗时</dt><dd>{action.estimateMinutes === null ? '未设置' : `${action.estimateMinutes} 分钟`}</dd><dt>完成标准</dt><dd>{action.successCriteria || '未设置'}</dd><dt>证据要求</dt><dd>{action.evidenceRequirement || '未设置'}</dd></dl>
          </article>
        ))}</div> : <p className="goal-empty-inline">项目还没有任务。可以从关联目标添加，任务会保存在此共享项目中。</p>}
        {editorPlan && renderTaskEditor(editorPlan, state.actions.filter(action => action.goalPlanId === editorPlan.id))}
        {!editorPlan && taskGoalPlanId === createTaskPlan?.id && createTaskPlan && renderTaskEditor(createTaskPlan, state.actions.filter(action => action.goalPlanId === createTaskPlan.id))}
      </div>
      <div className="project-workspace-section">
        <div className="project-section-heading"><h3>关联里程碑 <span className="count">{project.milestones.length}</span></h3>
          <div className="project-evidence-link">
            <select aria-label="选择要关联的目标里程碑" value={milestoneSelection} disabled={savingProjectLink || !availableMilestones.length} onChange={event => setMilestoneSelection(event.target.value)}>
              <option value="">{availableMilestones.length ? '选择目标里程碑' : '没有未关联的里程碑'}</option>
              {availableMilestones.map(({ goalPlanId, goalTitle, milestone }) => <option key={`${goalPlanId}:${milestone.id}`} value={`${goalPlanId}:${milestone.id}`}>{goalTitle} · {milestone.title || '未命名里程碑'}</option>)}
            </select>
            <button type="button" className="secondary-button" disabled={!milestoneSelection || savingProjectLink} onClick={() => void linkMilestoneToProject(project.id)}>关联里程碑</button>
          </div>
        </div>
        {project.milestones.length ? <div className="project-milestones">{project.milestones.map(({ goalPlanId, goalTitle, milestone }) => <article className="goal-milestone" key={`${goalPlanId}-${milestone.id}`}>
          <div><span>{goalTitle} · {milestone.stage === 'near' ? '近期' : '远期'}</span><strong>{milestone.title || '未命名里程碑'}</strong></div>
          {milestone.successCriteria && <p>{milestone.successCriteria}</p>}
          {milestone.reviewNote && <small className="goal-review-note">评估：{milestone.reviewNote}</small>}
          {milestone.evidenceRequirement && <small>证据要求：{milestone.evidenceRequirement}</small>}
        </article>)}</div> : <p className="goal-empty-inline">关联目标尚未记录里程碑。</p>}
      </div>
      <div className="project-workspace-section">
        <div className="project-section-heading"><h3>共享证据 <span className="count">{project.evidence.length}</span></h3>
          <div className="project-evidence-link">
            <select aria-label="选择要关联的证据" value={evidenceSelection} disabled={savingProjectLink || !availableEvidence.length} onChange={event => setEvidenceSelection(event.target.value)}>
              <option value="">{availableEvidence.length ? '选择已有证据' : '没有可关联的证据'}</option>
              {availableEvidence.map(item => <option key={item.id} value={item.id}>{item.reference} · {item.text.slice(0, 50)}</option>)}
            </select>
            <button type="button" className="secondary-button" disabled={!evidenceSelection || savingProjectLink} onClick={() => void linkEvidenceToProject(project.id)}>关联证据</button>
          </div>
        </div>
        {project.evidence.length ? <div className="project-evidence-list">{project.evidence.map(item => <article key={item.id}>
          {editingProjectEvidenceId === item.id && projectEvidenceDraft ? <form className="project-evidence-editor" onSubmit={event => void saveProjectEvidence(event)}>
            <label>证据原文<textarea required rows={3} value={projectEvidenceDraft.text} onChange={event => setProjectEvidenceDraft(current => current ? { ...current, text: event.target.value } : current)} /></label>
            <div><label>来源<input required value={projectEvidenceDraft.source} onChange={event => setProjectEvidenceDraft(current => current ? { ...current, source: event.target.value } : current)} /></label>
              <label>引用<input required value={projectEvidenceDraft.reference} onChange={event => setProjectEvidenceDraft(current => current ? { ...current, reference: event.target.value } : current)} /></label>
              <label>证据时间<input required type="datetime-local" value={projectEvidenceDraft.observedAt} onChange={event => setProjectEvidenceDraft(current => current ? { ...current, observedAt: event.target.value } : current)} /></label></div>
            <p>更改会更新这份证据的所有关联结果。</p>
            <div className="task-editor-actions"><button type="button" className="secondary-button" disabled={savingProjectLink} onClick={() => { setEditingProjectEvidenceId(null); setProjectEvidenceDraft(null); }}>取消</button><button type="submit" className="primary-button" disabled={savingProjectLink}>{savingProjectLink ? '保存中…' : '保存更正'}</button></div>
          </form> : <>
            <div><strong>{item.reference}</strong><span>{item.level} · {item.source} · {formatDateTime(item.observedAt)}</span></div><p>{item.text}</p>
            <button type="button" className="edit-evidence-button" onClick={() => beginProjectEvidenceEdit(item)}>更正证据</button>
          </>}
        </article>)}</div> : <p className="goal-empty-inline">将已有证据关联到项目后，任一入口都会显示同一条记录。</p>}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
    </section>;
  }

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
              <div><span className="goal-state active-state">活跃 · {plan.domain === 'learning' ? '学习目标' : plan.domain === 'fitness' ? '健身目标' : plan.domain === 'project' ? '项目目标' : '通用目标'} · 契约 v{plan.contractVersion ?? 1}</span><h3>{plan.title}</h3></div>
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
              <h4>共享项目入口</h4>
              {state.projects.filter(project => project.goals.some(goal => goal.goalPlanId === plan.id)).length ? <ul className="goal-evidence-requirements">
                {state.projects.filter(project => project.goals.some(goal => goal.goalPlanId === plan.id)).map(project => <li key={project.id}><strong>{project.title}</strong> · ID {project.id.slice(0, 6)} · {project.goals.length} 个关联目标</li>)}
              </ul> : <p className="goal-empty-inline">还没有关联共享项目。</p>}
              <div className="goal-project-link-controls">
                <form onSubmit={event => { event.preventDefault(); if (projectTitleDraft.trim()) void linkProjectToGoal(plan.id, projectTitleDraft); }}>
                  <input aria-label={`为 ${plan.title} 创建或关联项目`} maxLength={240} placeholder="输入项目名称" value={projectTitleDraft} onChange={event => setProjectTitleDraft(event.target.value)} />
                  <button className="secondary-button" type="submit" disabled={savingProjectLink || !projectTitleDraft.trim()}>{savingProjectLink ? '保存中…' : '新建项目'}</button>
                </form>
                {state.projects.some(project => !project.goals.some(goal => goal.goalPlanId === plan.id)) && <div>
                  <select aria-label={`选择要关联到 ${plan.title} 的项目`} value={projectSelection} onChange={event => setProjectSelection(event.target.value)}>
                    <option value="">关联已有项目</option>
                    {state.projects.filter(project => !project.goals.some(goal => goal.goalPlanId === plan.id)).map(project => <option key={project.id} value={project.id}>{project.title} · {project.goals.find(goal => goal.goalPlanId === project.primaryGoalPlanId)?.title || '无目标'} · {project.id.slice(0, 6)}</option>)}
                  </select>
                  <button className="text-button" type="button" disabled={!projectSelection || savingProjectLink} onClick={() => void linkExistingProjectToGoal(plan.id, projectSelection)}>关联</button>
                </div>}
              </div>
            </div>
            <div className="goal-subsection">
              <h4>证据要求</h4>
              <ul className="goal-evidence-requirements">{plan.evidenceRequirements.map(requirement => <li key={requirement.id}><strong>{requirement.minimumLevel}</strong> {requirement.item}：{requirement.description}</li>)}</ul>
            </div>
            <div className="goal-subsection">
              <div className="task-section-heading">
                <h4>任务与待排池 <span className="count">{actions.length} 项 · {actions.filter(action => action.status === 'pending_schedule' && !action.decomposedAt).length} 项待排</span></h4>
                <button type="button" className="secondary-button" onClick={() => beginTaskCreate(plan.id)}>新增任务</button>
              </div>
              {actions.length ? <div className="goal-task-list">{actions.map(action => (
                <article className="goal-task-card" id={`goal-action-${action.id}`} key={action.id}>
                  <div className="goal-task-card-head">
                    <div><span className={`goal-task-status ${action.decomposedAt ? 'decomposed' : action.status}`}>{action.decomposedAt ? '已拆分' : action.status === 'pending_schedule' ? '待排' : action.status === 'scheduled' ? '已安排' : '已完成'}</span><strong>{action.title}</strong></div>
                    <div className="goal-task-actions">
                      {action.status !== 'done' && !action.decomposedAt && <button type="button" className="edit-evidence-button" disabled={busyId === action.id} onClick={() => void markTaskDone(action)}>{busyId === action.id ? '记录中…' : '记录完成'}</button>}
                      <button type="button" className="edit-evidence-button" disabled={!!action.decomposedAt} onClick={() => beginTaskEdit(action)}>{action.decomposedAt ? '已拆分' : '编辑'}</button>
                    </div>
                  </div>
                  {action.status === 'done' && <p className="goal-task-completed-at">实际完成时间：{action.completedAt ? formatDateTime(action.completedAt) : '日期不详（旧记录未保存完成时间）'}</p>}
                  {action.details && <p className="goal-task-description">{action.details}</p>}
                  {action.parentActionId && <p className="goal-task-description">子任务 · 父任务：{actions.find(parent => parent.id === action.parentActionId)?.title || '已拆分任务'}</p>}
                  {action.decomposedAt && <p className="goal-task-description">已由确认的子任务替代，父任务本身不会进入日级计划。</p>}
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

              {state.taskProposals.filter(proposal => proposal.goalPlanId === plan.id && proposal.status === 'pending_review').map(proposal => (
                <section className="task-proposal-review" key={proposal.id} aria-label="待核对的任务拆分提议">
                  <div className="task-editor-heading"><strong>待核对的任务拆分</strong><span>父任务：{actions.find(action => action.id === proposal.parentActionId)?.title || '未知任务'}</span></div>
                  <p>提议中的子任务尚未进入待排池。核对完成条件、耗时、截止和依赖后再确认。</p>
                  {editingProposalId === proposal.id && proposalDraft ? (
                    <form className="task-editor" onSubmit={event => void saveProposalEdit(event, proposal.id)}>
                      {proposalDraft.map((task, index) => (
                        <div className="task-proposal-item" key={task.id}>
                          <strong>子任务 {index + 1}</strong>
                          <div className="task-editor-grid">
                            <label>任务名称<input required maxLength={240} value={task.title} onChange={event => updateProposalTask(index, { title: event.target.value })} /></label>
                            <label>预计耗时（分钟）<input required type="number" min="1" max="10080" value={task.estimateMinutes ?? ''} onChange={event => updateProposalTask(index, { estimateMinutes: event.target.value === '' ? null : Number(event.target.value) })} /></label>
                            <label>截止日期（可选）<input type="date" value={task.deadline ?? ''} onChange={event => updateProposalTask(index, { deadline: event.target.value || null })} /></label>
                            <label className="task-editor-wide">任务说明<textarea rows={2} value={task.details ?? ''} onChange={event => updateProposalTask(index, { details: event.target.value })} /></label>
                            <label className="task-editor-wide">完成标准<textarea required rows={2} value={task.successCriteria ?? ''} onChange={event => updateProposalTask(index, { successCriteria: event.target.value })} /></label>
                          </div>
                          <fieldset className="task-dependencies">
                            <legend>依赖的子任务</legend>
                            {proposalDraft.filter(candidate => candidate.id !== task.id).map(candidate => (
                              <label key={candidate.id}><input type="checkbox" checked={task.dependencyIds.includes(candidate.id)} onChange={event => updateProposalTask(index, { dependencyIds: event.target.checked ? [...task.dependencyIds, candidate.id] : task.dependencyIds.filter(id => id !== candidate.id) })} />{candidate.title}</label>
                            ))}
                          </fieldset>
                        </div>
                      ))}
                      <div className="task-editor-actions">
                        <button type="button" className="secondary-button" disabled={savingProposal} onClick={() => { setEditingProposalId(null); setProposalDraft(null); }}>取消编辑</button>
                        <button type="submit" className="primary-button" disabled={savingProposal}>{savingProposal ? '保存中…' : '保存修改'}</button>
                      </div>
                    </form>
                  ) : (
                    <ol className="task-proposal-list">{proposal.tasks.map(task => (
                      <li key={task.id}>
                        <strong>{task.title}</strong>
                        <span>{task.estimateMinutes} 分钟 · 截止 {task.deadline ? formatDate(task.deadline) : `沿用父任务（${formatDate(actions.find(action => action.id === proposal.parentActionId)?.deadline ?? null)}）`} · 依赖 {task.dependencyIds.map(id => proposal.tasks.find(candidate => candidate.id === id)?.title ?? id).join('、') || '无'}</span>
                        <p>{task.successCriteria}</p>
                      </li>
                    ))}</ol>
                  )}
                  {editingProposalId !== proposal.id && <div className="task-editor-actions">
                    <button type="button" className="secondary-button" disabled={savingProposal} onClick={() => beginProposalEdit(proposal)}>编辑提议</button>
                    <button type="button" className="secondary-button" disabled={savingProposal} onClick={() => void resolveProposal(proposal, 'reject')}>拒绝拆分</button>
                    <button type="button" className="primary-button" disabled={savingProposal} onClick={() => void resolveProposal(proposal, 'confirm')}>确认并进入待排池</button>
                  </div>}
                </section>
              ))}
              {editingHere && renderTaskEditor(plan, actions)}

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
                <div><span className={`goal-state ${plan.status === 'paused' ? 'paused-state' : 'ended-state'}`}>{statusLabels[plan.status]} · 契约 v{plan.contractVersion ?? 1}</span><h3>{plan.title || '未命名目标'}</h3></div>
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
