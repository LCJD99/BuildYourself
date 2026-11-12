'use client';

import { useCallback, useEffect, useReducer, useState } from 'react';
import {
  evidenceLevels,
  nodes,
  type Evidence,
  type EvidenceAssessment,
  type EvidenceNodeId,
  type EvidenceSnapshot,
  type MinimumEvidenceLevel,
  type NodeId,
  type Result,
  type TaskExecution,
} from '@/lib/model';
import GoalPlansPanel from './goal-plans-panel';
import DailyPlanPanel from './daily-plan-panel';
import WeeklyReviewPanel from './weekly-review-panel';
import type { DailyPlanRecord } from '@/lib/daily-plan-store';
import type { WeeklyPlan } from '@/lib/daily-planner';
import CommitmentsPanel from './commitments-panel';
import ProjectNavigation from './project-navigation';
import type { GoalProject } from '@/lib/goal-plans';
import type { GoalPlanPanelDetail, GoalPlansPanelState } from './goal-plans-panel';
import GoalNavigationDetailPane from './goal-navigation-detail';
import { createGoalNavigationState, goalNavigationReducer, summarizeGoalPortfolio } from '@/lib/goal-navigation';
import type { GoalNavigationDetail, GoalNavigationState } from '@/lib/goal-navigation';
import HistoryCalendarPanel from './history-calendar-panel';
import type { GoalEvidenceTarget } from '@/lib/goal-plans';
import AgentAssistant from './agent-assistant';
import type { AgentContextSelection } from '@/lib/agent-context';

type Graph = {
  evidence: Evidence[];
  results: Array<Result & {
    method?: '规则核验' | 'Agent 汇总';
    reasoning?: string;
    confirmationRequired?: boolean;
    confirmationRequirement?: string;
    canConfirm?: boolean;
    confirmedAt?: string | null;
  }>;
  assessments: Record<EvidenceNodeId, EvidenceAssessment>;
  requirements: Record<EvidenceNodeId, MinimumEvidenceLevel>;
  taskExecution: TaskExecution;
  changes: Array<{
    id: string;
    eventType: 'milestone.confirmed' | 'evidence.corrected' | 'task.created' | 'task.updated';
    entityId: string;
    summary: string;
    createdAt: string;
    evidenceIds: string[];
    resultChanges: Array<{ nodeId: EvidenceNodeId; title: string; beforeStatus: string; afterStatus: string; beforeGap: string; afterGap: string; beforeDetail: string; afterDetail: string }>;
    confirmationInvalidated: boolean;
  }>;
  context: NodeId;
};

const navigationStorageKey = 'buildyourself.goal-navigation.v1';

function detailFromPanelState(detail: GoalNavigationDetail, state: GoalPlansPanelState): GoalPlanPanelDetail | null {
  const goal = state.plans.find(plan => plan.id === detail.goalPlanId);
  if (!goal) return null;
  if (detail.kind === 'action') {
    const action = state.actions.find(item => item.id === detail.id && item.goalPlanId === goal.id);
    return action ? {
      kind: 'action', goal, action,
      actions: state.actions.filter(item => item.goalPlanId === goal.id),
      changes: state.taskChanges.filter(change => change.entityId === action.id),
    } : null;
  }
  const evidence = state.evidence.find(item => item.id === detail.id && item.goalPlanId === goal.id);
  return evidence ? {
    kind: 'evidence', goal, evidence,
    relatedAction: state.actions.find(action => action.id === evidence.goalActionId) ?? null,
    actions: state.actions.filter(action => action.goalPlanId === goal.id),
    changes: state.taskChanges.filter(change => change.entityId === evidence.goalActionId),
  } : null;
}

function restoreNavigationState(value: unknown): GoalNavigationState | null {
  if (!value || typeof value !== 'object') return null;
  const saved = value as Partial<GoalNavigationState>;
  if (!['portfolio', 'goal', 'detail'].includes(saved.layer ?? '')) return null;
  const base = createGoalNavigationState();
  const layer = saved.layer!;
  const returnLayer = saved.returnLayer === 'goal' ? 'goal' : saved.returnLayer === 'portfolio' ? 'portfolio' : null;
  const restoreScrollTop = layer === 'goal' ? saved.goalScrollTop ?? 0
    : layer === 'detail' && returnLayer === 'goal' ? saved.goalScrollTop ?? 0
      : saved.portfolioScrollTop ?? 0;
  return {
    ...base,
    ...saved,
    layer,
    filter: saved.filter === 'attention' ? 'attention' : 'all',
    selectedGoalPlanId: typeof saved.selectedGoalPlanId === 'string' ? saved.selectedGoalPlanId : null,
    selectedNodeId: typeof saved.selectedNodeId === 'string' ? saved.selectedNodeId : null,
    detail: saved.detail && typeof saved.detail.id === 'string' && typeof saved.detail.goalPlanId === 'string'
      && (saved.detail.kind === 'action' || saved.detail.kind === 'evidence') ? saved.detail : null,
    returnLayer,
    restoreScrollTop,
  };
}

const labels: Record<NodeId, string> = { goal: '目标', task: '任务', milestone: '里程碑' };
const requirementLevels: MinimumEvidenceLevel[] = ['E0', 'E1', 'E2', 'E3'];
const revisionFields: Array<{ key: keyof EvidenceSnapshot; label: string }> = [
  { key: 'text', label: '证据原文' },
  { key: 'source', label: '来源' },
  { key: 'reference', label: '引用' },
  { key: 'observedAt', label: '证据时间' },
  { key: 'links', label: '关联对象' },
  { key: 'goalPlanId', label: '所属目标' },
  { key: 'goalActionId', label: '所属行动' },
  { key: 'level', label: '证据等级' },
  { key: 'reportSubmitted', label: '报告是否已提交' },
  { key: 'benchmarkComplete', label: '完整基准测试' },
  { key: 'latencyMs', label: '实测延迟（ms）' },
];

function date(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

function dateTimeInput(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '';
  parsed.setMinutes(parsed.getMinutes() - parsed.getTimezoneOffset());
  return parsed.toISOString().slice(0, 16);
}

function revisionValue(key: keyof EvidenceSnapshot, value: EvidenceSnapshot[keyof EvidenceSnapshot], targets: GoalEvidenceTarget[]) {
  if (value === null || value === undefined) return '未说明';
  if (key === 'goalPlanId' && typeof value === 'string') return targets.find(target => target.id === value)?.title ?? value;
  if (key === 'goalActionId' && typeof value === 'string') return targets.flatMap(target => target.actions).find(action => action.id === value)?.title ?? value;
  if (key === 'links' && Array.isArray(value)) return value.map(id => labels[id as NodeId]).join('、');
  if (key === 'reportSubmitted' || key === 'benchmarkComplete') return value ? '是' : '否';
  if (key === 'observedAt' && typeof value === 'string') return date(value);
  return String(value);
}

export default function Workspace() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [selection, setSelected] = useState<NodeId | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [editingEvidence, setEditingEvidence] = useState<string | null>(null);
  const [evidenceDraft, setEvidenceDraft] = useState<Evidence | null>(null);
  const [evidenceTargets, setEvidenceTargets] = useState<GoalEvidenceTarget[]>([]);
  const [dailyPlanRecord, setDailyPlanRecord] = useState<DailyPlanRecord>({ plan: null, status: null, confirmedAt: null, updatedAt: null });
  const [dailyPlanRevision, setDailyPlanRevision] = useState(0);
  const [focusedAction, setFocusedAction] = useState<WeeklyPlan['days'][number]['actions'][number] | null>(null);
  const [selectedGoalPlanId, setSelectedGoalPlanId] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<GoalProject | null>(null);
  const [navigation, navigate] = useReducer(goalNavigationReducer, undefined, createGoalNavigationState);
  const [navigationReady, setNavigationReady] = useState(false);
  const [goalPanelState, setGoalPanelState] = useState<GoalPlansPanelState | null>(null);
  const [goalDetail, setGoalDetail] = useState<GoalPlanPanelDetail | null>(null);
  const [legacyToolsOpen, setLegacyToolsOpen] = useState(false);
  const [legacyContextNode, setLegacyContextNode] = useState<NodeId | null>(null);

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(navigationStorageKey);
      if (saved) {
        const restored = restoreNavigationState(JSON.parse(saved));
        if (restored) navigate({ type: 'restore-state', state: restored });
      }
    } catch { /* a corrupt or unavailable session snapshot falls back to the overview */ }
    setNavigationReady(true);
  }, []);

  useEffect(() => {
    if (!navigationReady) return;
    try {
      window.sessionStorage.setItem(navigationStorageKey, JSON.stringify({ ...navigation, restoreScrollTop: null }));
    } catch { /* navigation remains usable when session storage is unavailable */ }
  }, [navigation, navigationReady]);

  useEffect(() => {
    if (!navigationReady || navigation.restoreScrollTop === null || !goalPanelState) return;
    const top = navigation.restoreScrollTop;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top, behavior: 'instant' });
      navigate({ type: 'clear-restored-scroll' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [navigation.restoreScrollTop, navigationReady, goalPanelState]);

  const refresh = useCallback(async () => {
    try {
      const [response, targetsResponse] = await Promise.all([
        fetch('/api/graph', { cache: 'no-store' }),
        fetch('/api/evidence/targets', { cache: 'no-store' }),
      ]);
      if (!response.ok || !targetsResponse.ok) throw Error();
      const data: Graph = await response.json();
      const targetsData = await targetsResponse.json() as { targets: GoalEvidenceTarget[] };
      setGraph(data);
      setEvidenceTargets(targetsData.targets);
      setError('');
    } catch {
      setError('无法读取本地图谱，请检查应用服务。');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  const select = useCallback(async (id: NodeId) => {
    setSelected(id);
    try {
      const response = await fetch('/api/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) throw Error();
    } catch {
      setError('当前对象未能同步到 pi，请重试。');
    }
  }, []);

  const focusDailyAction = useCallback((action: WeeklyPlan['days'][number]['actions'][number]) => {
    setSelectedProject(null);
    setFocusedAction(action);
    setSelectedGoalPlanId(action.goalPlanId);
    setLegacyContextNode(null);
    void select('task');
  }, [select]);

  const updateDailyPlan = useCallback((record: DailyPlanRecord) => setDailyPlanRecord(record), []);

  async function saveExecution(completed: boolean) {
    setSaving(true);
    try {
      const response = await fetch('/api/execution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || '无法保存执行状态');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存执行状态');
    } finally {
      setSaving(false);
    }
  }

  async function saveRequirement(nodeId: EvidenceNodeId, minimumEvidenceLevel: MinimumEvidenceLevel) {
    setSaving(true);
    try {
      const response = await fetch('/api/evidence-requirement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, minimumEvidenceLevel }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || '无法保存证据要求');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存证据要求');
    } finally {
      setSaving(false);
    }
  }

  function beginEvidenceEdit(evidence: Evidence) {
    setEditingEvidence(evidence.id);
    setEvidenceDraft({ ...evidence, observedAt: dateTimeInput(evidence.observedAt) });
    setError('');
  }

  function updateEvidenceDraft(update: Partial<Evidence>) {
    setEvidenceDraft(currentDraft => currentDraft ? { ...currentDraft, ...update } : currentDraft);
  }

  async function correctEvidence(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!evidenceDraft) return;
    if (!evidenceDraft.links.length) {
      setError('请至少保留一个关联对象。');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/evidence', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...evidenceDraft, observedAt: new Date(evidenceDraft.observedAt).toISOString() }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw Error(result.error || '无法更正证据');
      setEditingEvidence(null);
      setEvidenceDraft(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法更正证据');
    } finally {
      setSaving(false);
    }
  }

  function cancelEvidenceEdit() {
    setEditingEvidence(null);
    setEvidenceDraft(null);
    setError('');
  }

  async function confirmMilestone() {
    setConfirming(true);
    try {
      const response = await fetch('/api/milestone-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'milestone' }),
      });
      const result = await response.json() as { created?: boolean; error?: string };
      if (!response.ok) throw Error(result.error || '无法确认里程碑');
      if (result.created) {
        setCelebrating(true);
        window.setTimeout(() => setCelebrating(false), 1100);
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法确认里程碑');
    } finally {
      setConfirming(false);
    }
  }

  const selected = selection ?? graph?.context ?? 'task';
  const current = nodes.find(node => node.id === selected)!;
  const legacyContext = legacyContextNode ? nodes.find(node => node.id === legacyContextNode) ?? null : null;
  const results = graph?.results ?? [];
  const visible = graph?.evidence.filter(evidence => selected === 'goal' || evidence.links.includes(selected)) ?? [];
  const assessment = selected === 'task' || selected === 'milestone' ? graph?.assessments[selected] : null;
  const scheduledGoals = Array.from(new Map((dailyPlanRecord.plan?.days.flatMap(day => day.actions) ?? []).map(action => [action.goalPlanId, action])).values());
  const syncProjectDetails = useCallback((projects: GoalProject[]) => {
    setSelectedProject(current => current ? projects.find(project => project.id === current.id) ?? current : current);
  }, []);

  const activeGoalPlans = goalPanelState?.plans.filter(plan => plan.status === 'active') ?? [];
  const selectedGoal = activeGoalPlans.find(plan => plan.id === navigation.selectedGoalPlanId) ?? null;
  const selectedGoalSummary = goalPanelState && selectedGoal
    ? summarizeGoalPortfolio(goalPanelState.plans, goalPanelState.actions, goalPanelState.evidence, new Date(), goalPanelState.evaluations).find(summary => summary.goalPlanId === selectedGoal.id) ?? null
    : null;
  const agentContextSelection: AgentContextSelection = selectedProject
    ? { layer: 'project', projectId: selectedProject.id }
    : legacyContext
      ? { layer: 'graph', graphNodeId: legacyContext.id }
      : goalDetail?.kind === 'action'
        ? { layer: 'task', goalPlanId: goalDetail.goal.id, actionId: goalDetail.action.id }
        : goalDetail?.kind === 'evidence'
          ? { layer: 'evidence', goalPlanId: goalDetail.goal.id, evidenceId: goalDetail.evidence.id }
        : focusedAction
          ? { layer: 'task', goalPlanId: focusedAction.goalPlanId, actionId: focusedAction.actionId }
          : selectedGoal
            ? { layer: 'goal', goalPlanId: selectedGoal.id }
            : { layer: 'portfolio' };
  const agentContextBreadcrumb = selectedProject
    ? `目标组合 / 共享项目 / ${selectedProject.title}`
    : legacyContext
      ? `目标组合 / 证据判定图谱 / ${legacyContext.type}：${legacyContext.title}`
      : goalDetail?.kind === 'action'
        ? `目标组合 / ${goalDetail.goal.title} / ${goalDetail.action.title}`
        : goalDetail?.kind === 'evidence'
          ? `目标组合 / ${goalDetail.goal.title} / 证据 / ${goalDetail.evidence.reference}`
        : focusedAction
          ? `目标组合 / ${focusedAction.goalTitle} / ${focusedAction.title}`
          : selectedGoal
            ? `目标组合 / ${selectedGoal.title}`
            : '目标组合';

  const openPortfolio = useCallback(() => {
    setSelectedProject(null);
    setFocusedAction(null);
    setLegacyContextNode(null);
    setGoalDetail(null);
    navigate({ type: 'show-portfolio' });
    setSelected('goal');
    void select('goal');
  }, [select]);

  const openGoal = useCallback((goalPlanId: string) => {
    setSelectedProject(null);
    setFocusedAction(null);
    setLegacyContextNode(null);
    setGoalDetail(null);
    navigate({ type: 'open-goal', goalPlanId, scrollTop: window.scrollY });
    setSelected('goal');
    void select('goal');
  }, [select]);

  const openGoalDetail = useCallback((detail: GoalPlanPanelDetail) => {
    const nodeId = detail.kind === 'action' ? 'task' : detail.evidence.links.includes('task') ? 'task' : 'milestone';
    const ref: GoalNavigationDetail = {
      kind: detail.kind,
      id: detail.kind === 'action' ? detail.action.id : detail.evidence.id,
      goalPlanId: detail.goal.id,
    };
    setSelectedProject(null);
    setLegacyContextNode(null);
    setGoalDetail(detail);
    navigate({ type: 'open-detail', detail: ref, scrollTop: window.scrollY });
    setSelected(nodeId);
    void select(nodeId);
  }, [select]);

  const openWeeklyReview = useCallback(() => {
    document.getElementById('weekly-review-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  useEffect(() => {
    if (!navigationReady || !goalPanelState || !navigation.detail || navigation.layer !== 'detail') return;
    const resolved = detailFromPanelState(navigation.detail, goalPanelState);
    if (resolved) setGoalDetail(resolved);
    else {
      setGoalDetail(null);
      navigate({ type: navigation.returnLayer === 'goal' ? 'show-goal' : 'show-portfolio' });
    }
  }, [goalPanelState, navigation.layer, navigation.detail, navigation.returnLayer, navigationReady]);

  useEffect(() => {
    if (!goalPanelState || navigation.layer !== 'goal' || !navigation.selectedGoalPlanId) return;
    if (!activeGoalPlans.some(plan => plan.id === navigation.selectedGoalPlanId)) {
      setGoalDetail(null);
      navigate({ type: 'show-portfolio' });
    }
  }, [goalPanelState, navigation.layer, navigation.selectedGoalPlanId, activeGoalPlans]);

  const contentLayer = navigation.layer === 'detail' ? navigation.returnLayer ?? 'portfolio' : navigation.layer;
  const detailTitle = goalDetail?.kind === 'action' ? goalDetail.action.title
    : goalDetail?.kind === 'evidence' ? `证据 · ${goalDetail.evidence.reference}` : '详情';
  const goalDetailAction = goalDetail?.kind === 'action' ? goalDetail.action
    : goalDetail?.kind === 'evidence' ? goalDetail.relatedAction : null;
  const goalDetailConflictNotes = goalDetailAction ? (() => {
    const plan = dailyPlanRecord.plan;
    if (!plan || dailyPlanRecord.status !== 'confirmed') return ['当前没有已确认的日级计划，尚无法判断容量冲突。'];
    const unplaced = plan.unplaced.find(item => item.action.id === goalDetailAction.id);
    if (unplaced) return [`当前周计划未排入：${unplaced.reason}`];
    const scheduled = plan.days.find(day => day.actions.some(item => item.actionId === goalDetailAction.id));
    if (scheduled) return [`已安排于 ${scheduled.date}，当天占用 ${scheduled.usedMinutes}/${scheduled.capacityMinutes} 分钟。`];
    return ['此行动不在当前周计划中；现有排期数据没有显示具体时间冲突。'];
  })() : [];

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brandmark">✳</span>
          <div><strong>BuildYourself</strong><small>个人执行空间</small></div>
        </div>
        <div className="nav-label">工作空间 <span>01</span></div>
        <button className={`nav-home${navigation.layer === 'portfolio' && !selectedProject ? ' active' : ''}`} onClick={openPortfolio}>◈ <span>目标组合总览</span></button>
        <div className="tree-label">活跃目标 <span>{activeGoalPlans.length}</span></div>
        <div className="tree goal-navigation-tree">
          {activeGoalPlans.map(plan => <button key={plan.id} className={`${!selectedProject && navigation.selectedGoalPlanId === plan.id ? 'active ' : ''}child`} aria-current={!selectedProject && navigation.selectedGoalPlanId === plan.id ? 'page' : undefined} onClick={() => openGoal(plan.id)}>
            <span className="node-icon">◉</span><span>{plan.title || '未命名目标'}</span>
          </button>)}
          {goalPanelState && activeGoalPlans.length === 0 && <p className="sidebar-empty-note">暂无活跃目标</p>}
        </div>
        <details className="legacy-navigation">
          <summary>证据判定图谱</summary>
          <div className="tree">{nodes.map((node, index) => <button key={node.id} className={`${selected === node.id ? 'active ' : ''}${index ? 'child' : ''}`} onClick={() => {
            setSelectedProject(null); setFocusedAction(null); setSelectedGoalPlanId(null); setLegacyToolsOpen(true); setLegacyContextNode(node.id); void select(node.id);
            window.setTimeout(() => document.getElementById('legacy-workspace-tools')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
          }}>
            <span className="node-icon">{index === 0 ? '◉' : index === 1 ? '□' : '◇'}</span><span>{node.title}</span>
          </button>)}</div>
        </details>
        <ProjectNavigation selectedProjectId={selectedProject?.id} onSelect={project => { setSelectedProject(project); setFocusedAction(null); setLegacyContextNode(null); setSelectedGoalPlanId(null); setGoalDetail(null); }} onProjectsChange={syncProjectDetails} />
        {scheduledGoals.length > 0 && <>
          <div className="tree-label daily-plan-tree-label">本周行动归属</div>
          <div className="tree">{scheduledGoals.map(action => (
            <button key={action.goalPlanId} className={`${selectedGoalPlanId === action.goalPlanId ? 'active ' : ''}child`} onClick={() => focusDailyAction(action)}>
              <span className="node-icon">◉</span><span>{action.goalTitle}</span>
            </button>
          ))}</div>
        </>}
        <div className="sidebar-bottom"><span className="online" /> 本地个人空间 <small>数据保存在本机</small></div>
      </aside>

      <section className="center">
        <header className="topbar">
          <nav className="goal-breadcrumbs" aria-label="当前位置">
            <button type="button" onClick={openPortfolio}>目标组合</button>
            {selectedProject ? <><span>/</span><span aria-current="page">共享项目 · {selectedProject.title}</span></> : navigation.selectedGoalPlanId && <><span>/</span><button type="button" onClick={() => { setGoalDetail(null); navigate({ type: 'show-goal' }); }}>{goalPanelState?.plans.find(plan => plan.id === navigation.selectedGoalPlanId)?.title ?? '单目标工作区'}</button></>}
            {navigation.layer === 'detail' && <><span>/</span><span aria-current="page">{detailTitle}</span></>}
          </nav>
          <span className="top-right">◷ &nbsp; 本地原型</span>
        </header>
        <div className="content">
          {selectedProject ? <GoalPlansPanel selectedProjectId={selectedProject.id} onDataChange={setGoalPanelState} />
            : contentLayer === 'portfolio' ? <GoalPlansPanel
              mode="portfolio" portfolioFilter={navigation.filter} selectedGoalPlanId={navigation.selectedGoalPlanId}
              onPortfolioFilterChange={filter => navigate({ type: 'set-filter', filter })}
              onOpenGoal={openGoal} onOpenDetail={openGoalDetail} onDataChange={setGoalPanelState}
              onOpenWeeklyReview={openWeeklyReview}
            /> : <>
              <GoalPlansPanel mode="workspace" selectedGoalPlanId={navigation.selectedGoalPlanId}
                selectedNodeId={navigation.selectedNodeId} onOpenDetail={openGoalDetail}
                onDataChange={setGoalPanelState} onOpenWeeklyReview={openWeeklyReview} />
              <WeeklyReviewPanel />
            </>}
          <details id="legacy-workspace-tools" className="legacy-workspace-tools" open={legacyToolsOpen} onToggle={event => setLegacyToolsOpen(event.currentTarget.open)}>
            <summary>执行计划、承诺、历史日历与证据判定工具</summary>
            {legacyToolsOpen && <div className="legacy-workspace-content">
          <div className="eyebrow"><span className="dot" /> {selectedProject ? '共享项目' : `${current.type}概览`} <span className="muted"> / &nbsp; EXECUTION SPACE</span></div>
          <h1>{selectedProject?.title ?? current.title}</h1>
          <p className="lead">{selectedProject ? '项目记录在主要位置和所有关联目标入口间保持一致。' : current.description}</p>
          {selectedProject ? <GoalPlansPanel selectedProjectId={selectedProject.id} /> : <>
          <div className="meta">
            <span>◉ &nbsp; 活跃中</span><span>◇ &nbsp; 1 个里程碑</span><span>◷ &nbsp; {graph?.evidence.length ?? 0} 条证据</span>
          </div>

          <DailyPlanPanel onActionClick={focusDailyAction} onPlanChange={updateDailyPlan} refreshKey={dailyPlanRevision} />
          <WeeklyReviewPanel />
          <CommitmentsPanel onPlanAccepted={record => { updateDailyPlan(record); setDailyPlanRevision(value => value + 1); }} />
          <HistoryCalendarPanel />
          <GoalPlansPanel focusActionId={focusedAction?.actionId} />

          {selected === 'task' && (
            <section className="execution-panel" aria-labelledby="execution-title">
              <div className="execution-copy">
                <span className="kicker">TASK EXECUTION</span>
                <h2 id="execution-title">执行记录</h2>
                {graph?.taskExecution.completedAt ? (
                  <p><span className="execution-status complete">执行已完成</span> 记录时间：{date(graph.taskExecution.completedAt)}</p>
                ) : (
                  <p><span className="execution-status pending">尚未记录完成</span> 标记后会保存实际执行时间。</p>
                )}
                <small>执行状态与证据充足度分别记录；完成操作不会自动改变里程碑判定。</small>
              </div>
              <button className={graph?.taskExecution.completedAt ? 'secondary-button' : 'primary-button'} disabled={saving} onClick={() => void saveExecution(!graph?.taskExecution.completedAt)}>
                {saving ? '保存中…' : graph?.taskExecution.completedAt ? '撤销完成记录' : '标记已完成'}
              </button>
            </section>
          )}

          <div className="divider" />
          <div className="section-title">
            <div><span className="kicker">YOUR PROGRESS</span><h2>{selected === 'goal' ? '目标地图' : '关联对象'}</h2></div>
            <span className="subtle">选择节点查看详情 ↗</span>
          </div>
          <div className="map">
            {nodes.filter(node => node.id !== selected).map(node => (
              <button className="map-item" key={node.id} onClick={() => { setLegacyContextNode(node.id); void select(node.id); }}>
                <span className="map-icon">{node.type === '任务' ? '□' : node.type === '目标' ? '◉' : '◇'}</span>
                <span><small>{node.type}</small><strong>{node.title}</strong><em>{node.description}</em></span>
                <span className="arrow">↗</span>
              </button>
            ))}
          </div>

          <div className="section-title evidence-heading">
            <div><span className="kicker">THE EVIDENCE</span><h2>近期证据 <span className="count">{visible.length}</span></h2></div>
            <span className="subtle">按记录时间排列</span>
          </div>
          {error && <p role="alert" className="error">{error}</p>}
          {visible.length === 0 ? (
            <div className="empty"><span>✳</span><strong>还没有证据</strong><p>在 pi 中使用 /evidence 记录一次反馈。<br />你可以把它关联到任务和里程碑。</p></div>
          ) : (
            <div className="evidence-list">
              {visible.map(evidence => (
                <article key={evidence.id}>
                  {editingEvidence === evidence.id && evidenceDraft ? (
                    <form className="evidence-edit" onSubmit={event => void correctEvidence(event)}>
                      <div className="evidence-edit-heading"><strong>更正证据</strong><span>保留原记录身份，并重新判定所有关联对象。</span></div>
                      <label>证据原文<textarea required rows={4} value={evidenceDraft.text} onChange={event => updateEvidenceDraft({ text: event.target.value })} /></label>
                      <div className="evidence-edit-grid">
                        <label>来源<input required value={evidenceDraft.source} onChange={event => updateEvidenceDraft({ source: event.target.value })} /></label>
                        <label>引用<input required value={evidenceDraft.reference} onChange={event => updateEvidenceDraft({ reference: event.target.value })} /></label>
                        <label>证据时间<input required type="datetime-local" value={evidenceDraft.observedAt} onChange={event => updateEvidenceDraft({ observedAt: event.target.value })} /></label>
                        <label>证据等级<select value={evidenceDraft.level} onChange={event => updateEvidenceDraft({ level: event.target.value as Evidence['level'] })}>
                          {(['E1', 'E2', 'E3'] as const).map(level => <option key={level} value={level}>{level} · {evidenceLevels[level].title}</option>)}
                        </select></label>
                      </div>
                      <fieldset className="evidence-links"><legend>关联对象</legend>
                        {nodes.map(node => <label key={node.id}><input type="checkbox" checked={evidenceDraft.links.includes(node.id)} onChange={event => updateEvidenceDraft({ links: event.target.checked ? [...evidenceDraft.links, node.id] : evidenceDraft.links.filter(id => id !== node.id) })} />{node.type}：{node.title}</label>)}
                      </fieldset>
                      <div className="evidence-edit-grid">
                        <label>目标归属（用于目标历史）<select value={evidenceDraft.goalPlanId ?? ''} onChange={event => updateEvidenceDraft({ goalPlanId: event.target.value || null, goalActionId: null })}>
                          <option value="">不关联具体目标</option>
                          {evidenceTargets.map(target => <option key={target.id} value={target.id}>{target.title}（{target.status}）</option>)}
                        </select></label>
                        {evidenceDraft.goalPlanId && <label>行动归属（可选）<select value={evidenceDraft.goalActionId ?? ''} onChange={event => updateEvidenceDraft({ goalActionId: event.target.value || null })}>
                          <option value="">整个目标</option>
                          {evidenceTargets.find(target => target.id === evidenceDraft.goalPlanId)?.actions.map(action => <option key={action.id} value={action.id}>{action.title}（{action.status === 'done' ? '已完成' : action.status === 'scheduled' ? '已安排' : '待排'}）</option>)}
                        </select></label>}
                        <small className="evidence-association-note">只有明确关联到具体目标的证据才进入该目标的历史日历。</small>
                      </div>
                      <div className="evidence-edit-grid">
                        {evidenceDraft.links.includes('task') && <label>报告是否已提交<select value={evidenceDraft.reportSubmitted === null ? 'unknown' : evidenceDraft.reportSubmitted ? 'yes' : 'no'} onChange={event => updateEvidenceDraft({ reportSubmitted: event.target.value === 'unknown' ? null : event.target.value === 'yes' })}><option value="unknown">证据未说明</option><option value="yes">是</option><option value="no">否</option></select></label>}
                        {evidenceDraft.links.includes('milestone') && <>
                          <label>是否完成完整基准测试<select value={evidenceDraft.benchmarkComplete === null ? 'unknown' : evidenceDraft.benchmarkComplete ? 'yes' : 'no'} onChange={event => updateEvidenceDraft({ benchmarkComplete: event.target.value === 'unknown' ? null : event.target.value === 'yes' })}><option value="unknown">证据未说明</option><option value="yes">是</option><option value="no">否</option></select></label>
                          <label>实测延迟（ms）<input type="number" min="0" step="any" value={evidenceDraft.latencyMs ?? ''} onChange={event => updateEvidenceDraft({ latencyMs: event.target.value === '' ? null : Number(event.target.value) })} /></label>
                        </>}
                      </div>
                      <div className="evidence-edit-actions"><button type="button" className="secondary-button" disabled={saving} onClick={cancelEvidenceEdit}>取消</button><button type="submit" className="primary-button" disabled={saving}>{saving ? '保存中…' : '保存更正并重判'}</button></div>
                    </form>
                  ) : <>
                    <div className="evidence-top">
                      <span>{evidence.level} · {evidenceLevels[evidence.level].title} · {evidenceLevels[evidence.level].trust}{Boolean(evidence.revisionCount) && <em className="corrected-badge">已更正 {evidence.revisionCount} 次</em>}</span>
                      <div className="evidence-actions"><time>{date(evidence.observedAt)}</time><button type="button" className="edit-evidence-button" aria-label={`更正证据：${evidence.reference}`} onClick={() => beginEvidenceEdit(evidence)}>更正</button></div>
                    </div>
                    {Boolean(evidence.lastCorrectedAt) && <div className="evidence-revision-time">最近更正：{date(evidence.lastCorrectedAt!)}</div>}
                    <p>{evidence.text}</p>
                    <div className="evidence-foot">来源：{evidence.source} · 引用：{evidence.reference}</div>
                    <div className="tags">{evidence.links.map(id => <span key={id}>{labels[id]}</span>)}<span>{evidence.goalPlanId ? `目标：${evidenceTargets.find(target => target.id === evidence.goalPlanId)?.title ?? '已关联目标'}` : '未关联具体目标'}</span>{evidence.goalActionId && <span>行动：{evidenceTargets.flatMap(target => target.actions).find(action => action.id === evidence.goalActionId)?.title ?? '已关联行动'}</span>}</div>
                    {Boolean(evidence.revisions?.length) && <details className="evidence-history">
                      <summary>查看更正记录（{evidence.revisions!.length}）</summary>
                      <ol>{evidence.revisions!.map((revision, revisionIndex) => {
                        const changedFields = revisionFields.filter(({ key }) => JSON.stringify(revision.before[key]) !== JSON.stringify(revision.after[key]));
                        return <li key={`${revision.changedAt}-${revisionIndex}`}>
                          <time>{date(revision.changedAt)}</time>
                          {changedFields.map(({ key, label }) => <p key={key}><strong>{label}</strong><span>原：{revisionValue(key, revision.before[key], evidenceTargets)}</span><span>更正为：{revisionValue(key, revision.after[key], evidenceTargets)}</span></p>)}
                        </li>;
                      })}</ol>
                    </details>}
                  </>}
                </article>
              ))}
            </div>
          )}
          </>}
            </div>}
          </details>
        </div>
      </section>

      <aside className="detail">
        <div className="detail-top"><span>{navigation.layer === 'detail' ? '行动与证据详情' : selectedGoal ? '当前目标' : selectedProject ? '共享项目' : '组合状态'}</span>
          {navigation.layer === 'detail' ? <button type="button" className="detail-back" onClick={() => { setGoalDetail(null); navigate({ type: navigation.returnLayer === 'goal' ? 'show-goal' : 'show-portfolio' }); }}>返回上层</button> : <span>✳</span>}
        </div>
        <div className="detail-content">
          {navigation.layer === 'detail' ? goalDetail
            ? <GoalNavigationDetailPane detail={goalDetail} conflictNotes={goalDetailConflictNotes} />
            : <p className="goal-portfolio-loading">正在恢复所选详情…</p>
            : selectedProject ? <section className="goal-right-summary">
              <span className="kicker">SHARED PROJECT</span><h2>{selectedProject.title}</h2>
              <p>主要目标：{selectedProject.goals.find(goal => goal.goalPlanId === selectedProject.primaryGoalPlanId)?.title ?? '目标已归档'}</p>
              <p>关联目标 {selectedProject.goals.length} 个 · 里程碑 {selectedProject.milestones.length} 个 · 共享证据 {selectedProject.evidence.length} 条</p>
            </section>
            : selectedGoalSummary && selectedGoal ? <section className="goal-right-summary" aria-label="当前目标摘要">
              <span className="goal-state active-state">目标状态 · 活跃</span><h2>{selectedGoal.title}</h2>
              <div className="result-label"><span>下一里程碑</span><span>{selectedGoalSummary.nextMilestone?.stage === 'near' ? '近期' : selectedGoalSummary.nextMilestone ? '远期' : '待设置'}</span></div>
              <p>{selectedGoalSummary.nextMilestone?.title ?? (selectedGoalSummary.milestoneCount ? '已确认全部里程碑' : '尚未设置里程碑')}{selectedGoalSummary.nextMilestone?.successCriteria ? ` · ${selectedGoalSummary.nextMilestone.successCriteria}` : ''}</p>
              <div className="detail-divider" />
              <div className="result-label"><span>执行记录</span><span>{selectedGoalSummary.completedActionCount}/{selectedGoalSummary.actionCount}</span></div>
              <p>已完成行动数只描述执行状态，不表示目标达成。</p>
              {selectedGoalSummary.latestEvidence ? <button type="button" className="goal-portfolio-link" onClick={() => {
                const detail = goalPanelState && detailFromPanelState({ kind: 'evidence', id: selectedGoalSummary.latestEvidence!.id, goalPlanId: selectedGoal.id }, goalPanelState);
                if (detail) openGoalDetail(detail);
              }}>最近证据：{selectedGoalSummary.latestEvidence.reference} · {selectedGoalSummary.latestEvidence.level}</button> : <p>尚无关联目标的证据。</p>}
              <div className="goal-portfolio-risk"><strong>风险提示</strong>{selectedGoalSummary.riskSignals.length ? <ul>{selectedGoalSummary.riskSignals.map(signal => <li key={signal}>{signal}</li>)}</ul> : <p>当前记录未显示风险提示。</p>}</div>
              <button type="button" className="secondary-button" onClick={() => navigate({ type: 'show-goal' })}>打开目标工作区</button>
            </section>
            : <section className="goal-right-summary" aria-label="目标组合说明">
              <span className="kicker">GOAL PORTFOLIO</span><h2>实际目标与记录</h2>
              <p>活跃目标 {activeGoalPlans.length} 个。选择目标查看里程碑、行动、证据和复盘；摘要只读取本地保存的真实记录。</p>
              {navigation.selectedNodeId && <small>最近选中节点：{goalPanelState?.plans.find(plan => plan.id === navigation.selectedNodeId)?.title ?? navigation.selectedNodeId}</small>}
            </section>}
          {legacyToolsOpen && <div className="legacy-detail-panel">
          <div className="detail-overline">CURRENT VIEW</div>
          <h2>{selectedProject?.title ?? current.title}</h2>
          <p className="detail-intro">执行记录、证据充足度和结果判定分别展示。</p>
          {selectedProject ? <section className="project-detail-summary" aria-label="共享项目概览">
            <div className="result-label"><span>关联目标</span><span>{selectedProject.goals.length}</span></div>
            <ul>{selectedProject.goals.map(goal => <li key={goal.goalPlanId}>{goal.goalPlanId === selectedProject.primaryGoalPlanId ? '主要位置 · ' : '关联入口 · '}{goal.title}</li>)}</ul>
            <div className="detail-divider" />
            <div className="result-label"><span>关联里程碑</span><span>{selectedProject.milestones.length}</span></div>
            {selectedProject.milestones.map(({ goalPlanId, goalTitle, milestone }) => <article key={`${goalPlanId}-${milestone.id}`}>
              <small>{goalTitle}</small><strong>{milestone.title || '未命名里程碑'}</strong><p>{milestone.successCriteria || '标准待细化'}</p>
            </article>)}
            <div className="detail-divider" />
            <div className="result-label"><span>共享证据</span><span>{selectedProject.evidence.length}</span></div>
            {selectedProject.evidence.map(item => <p className="project-detail-evidence" key={item.id}>{item.reference} · {item.level} · {item.text}</p>)}
          </section> : <>
          {focusedAction && <section className="focused-action-context" aria-labelledby="focused-action-title">
            <span className="kicker">SELECTED ACTION</span>
            <h3 id="focused-action-title">{focusedAction.title}</h3>
            <p>归属：{focusedAction.goalTitle}</p>
            <div className="detail-divider" />
            <span className="kicker">关联里程碑</span>
            {focusedAction.milestoneTitle ? <>
              <strong>{focusedAction.milestoneTitle}</strong>
              <p>{focusedAction.milestoneCriteria || '尚未填写验收标准。'}</p>
            </> : <p>此行动尚未关联里程碑。</p>}
          </section>}
          <div className="detail-divider" />

          {!focusedAction && assessment && (
            <section className="assessment-card" aria-labelledby="assessment-title">
              <div className="result-label"><span>证据要求</span><span>◈</span></div>
              <label htmlFor="minimum-evidence" id="assessment-title">最低证据等级</label>
              <select id="minimum-evidence" value={graph?.requirements[selected as EvidenceNodeId] ?? 'E1'} disabled={saving} onChange={event => void saveRequirement(selected as EvidenceNodeId, event.target.value as MinimumEvidenceLevel)}>
                {requirementLevels.map(level => <option key={level} value={level}>{level} · {evidenceLevels[level].title}</option>)}
              </select>
              <div className={`status ${assessment.status === '证据充足' || assessment.status === '无需证据' ? 'success' : 'neutral'}`}><span>●</span> {assessment.status}</div>
              <p>{assessment.summary}</p>
              <dl>
                <dt>最低要求</dt><dd>{assessment.requiredLevel} · {evidenceLevels[assessment.requiredLevel].title}（{evidenceLevels[assessment.requiredLevel].trust}）</dd>
                <dt>当前最高</dt><dd>{assessment.highestLevel ? `${assessment.highestLevel} · ${evidenceLevels[assessment.highestLevel].title}（${evidenceLevels[assessment.highestLevel].trust}）` : '暂无关联证据'}</dd>
                <dt>证据缺口</dt><dd>{assessment.gap}</dd>
              </dl>
            </section>
          )}

          {!focusedAction && results.map((result, index) => {
            const isMilestone = index === 1;
            return (
              <article className={`result${isMilestone && celebrating ? ' celebrating' : ''}`} key={result.title}>
                <div className="result-label"><span>{index === 0 ? '01' : '02'} / {result.title}</span><span>{index === 0 ? '□' : '◇'}</span></div>
                <div className={`status ${result.tone}`} aria-live="polite"><span>●</span> {result.status}</div>
                <p>{result.detail}</p>
                <dl>
                  <dt>判定标准</dt><dd>{result.standard}</dd>
                  <dt>证据来源</dt><dd>{result.evidence.length ? result.evidence.map(evidence => `${evidence.level} ${evidence.source}（${evidence.reference}）`).join('；') : '暂无关联证据'}</dd>
                  <dt>判定缺口</dt><dd>{result.gap}</dd>
                  {isMilestone && <><dt>判定方式</dt><dd>{result.method ?? '规则核验'}</dd><dt>判定理由</dt><dd>{result.reasoning ?? result.detail}</dd><dt>确认要求</dt><dd>{result.confirmationRequirement ?? '达到标准后由用户核对并确认。'}</dd></>}
                </dl>
                {isMilestone && selected === 'milestone' && result.canConfirm && (
                  <button className="primary-button confirm-button" disabled={confirming} onClick={() => void confirmMilestone()}>
                    {confirming ? '保存确认…' : '确认里程碑达成'}
                  </button>
                )}
                {isMilestone && result.status === '已确认达成' && result.confirmedAt && (
                  <p className="confirmed-at">已于 {date(result.confirmedAt)} 确认达成</p>
                )}
              </article>
            );
          })}
          {!focusedAction && <section className="change-log" aria-labelledby="change-log-title">
            <div className="result-label"><h3 id="change-log-title">变更记录</h3><span>{graph?.changes.length ?? 0}</span></div>
            {graph?.changes.length ? (
              <ul>{graph.changes.map(change => <li key={change.id}>
                <span>{change.summary}</span>
                {change.resultChanges.map(result => <div className="change-outcome" key={result.nodeId}>
                  <strong>{result.title}：{result.beforeStatus} → {result.afterStatus}</strong>
                  {result.beforeDetail !== result.afterDetail && <span>判定说明：{result.beforeDetail} → {result.afterDetail}</span>}
                  {result.beforeGap !== result.afterGap && <span>判定缺口：{result.beforeGap} → {result.afterGap}</span>}
                  {result.beforeGap === result.afterGap && <span>判定缺口：{result.afterGap}</span>}
                </div>)}
                {change.eventType === 'evidence.corrected' && !change.resultChanges.length && <span className="change-outcome">关联对象的结论与缺口没有变化。</span>}
                {change.confirmationInvalidated && <span className="confirmation-reset">原里程碑确认已撤销，请重新核对并确认。</span>}
                <time>{date(change.createdAt)}</time>
              </li>)}</ul>
            ) : <p>尚无目标、任务或证据变更记录。</p>}
          </section>}
          {!focusedAction && <div className="hint"><span>✳</span><p><strong>执行完成与目标进展分开判断</strong><br />保存行动完成不会自动提高能力或里程碑判定。</p></div>}
          </>}
          </div>}
        </div>
      </aside>
      <AgentAssistant selection={agentContextSelection} breadcrumb={agentContextBreadcrumb} />
    </main>
  );
}
