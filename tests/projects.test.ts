import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activateGoalPlan, createGoalPlanAction, createGoalProject, linkGoalProjectEvidence, linkGoalProjectMilestone, linkGoalProjectToGoal, listGoalPlanActions, listGoalProjects, saveGoalPlanDraft, updateGoalPlanAction } from '../lib/goal-plans';
import { saveEvidence } from '../lib/store';
import { correctEvidence } from '../lib/milestone-store';
import { createProjectDeliverable, listProjectDeliverables, updateProjectDeliverable } from '../lib/project-deliverables';
import { deriveProjectProgress } from '../lib/project-progress';
import { assignProjectEvidenceToSeries, createProjectMeasurementSeries, listProjectMeasurementSeries } from '../lib/project-measurement-series';

const dir = mkdtempSync(join(tmpdir(), 'buildyourself-projects-'));
beforeEach(() => { process.env.BUILDYOURSELF_DB = join(dir, `${randomUUID()}.sqlite`); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function activePlan(title: string) {
  const plan = saveGoalPlanDraft({
    sourceIntent: title,
    title,
    domain: 'project',
    context: null,
    successDescription: '交付一项可核验成果。',
    observableResult: '提交并核对成果。',
    baselineStatus: 'known',
    baselineAction: null,
    milestones: [{ title: '完成交付', stage: 'near', successCriteria: '成果通过核对。', standardAssessment: 'reasonable', evidenceAvailability: 'available', reviewNote: '标准可核对。', evidenceRequirement: '可验证成果（E2）。' }],
    nextActions: [{ title: '开始工作', details: null, estimateMinutes: 30, priority: 'medium', hardDeadline: null, milestoneId: null, dependsOn: [], specificity: 'concrete' }],
    constraints: { status: 'confirmed', items: [] },
    evidenceRequirements: [{ id: randomUUID(), item: '成果', description: '提交可核验材料。', minimumLevel: 'E2' }],
    reviewCycleDays: 7,
  });
  activateGoalPlan(plan.id);
  return plan;
}

describe('共享项目', () => {
  it('同名项目默认使用不同 ID，只有显式 ID 关联后才共享任务', () => {
    const first = activePlan('项目目标 A');
    const second = activePlan('项目目标 B');
    const project = createGoalProject({ title: '年度报告', goalPlanId: first.id });
    const sameNameProject = createGoalProject({ title: '年度报告', goalPlanId: second.id });

    expect(sameNameProject.id).not.toBe(project.id);
    expect(sameNameProject.goals.map(goal => goal.goalPlanId)).toEqual([second.id]);

    const shared = linkGoalProjectToGoal(project.id, { goalPlanId: second.id });
    const task = createGoalPlanAction({ goalPlanId: first.id, title: '起草报告', projectId: project.id });
    const sharedTask = createGoalPlanAction({ goalPlanId: second.id, title: '核对交付', projectId: project.id });

    expect(shared.id).toBe(project.id);
    expect(shared.goals.map(goal => goal.goalPlanId)).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(task.projectId).toBe(project.id);
    expect(listGoalPlanActions().filter(action => action.projectId === shared.id).map(action => action.id)).toEqual([task.id, sharedTask.id]);

    updateGoalPlanAction(task.id, { title: '核对并提交报告' });
    expect(listGoalPlanActions().find(action => action.projectId === project.id)).toMatchObject({ id: task.id, title: '核对并提交报告' });
    expect(listGoalProjects().find(item => item.id === project.id)?.goals).toHaveLength(2);
  });

  it('项目页只显示明确关联到项目的里程碑', () => {
    const first = activePlan('项目目标 A');
    const second = activePlan('项目目标 B');
    const project = createGoalProject({ title: '共同交付', goalPlanId: first.id });
    linkGoalProjectToGoal(project.id, { goalPlanId: second.id });

    expect(listGoalProjects().find(item => item.id === project.id)?.milestones).toEqual([]);

    const milestone = first.milestones[0];
    const linked = linkGoalProjectMilestone(project.id, { goalPlanId: first.id, milestoneId: milestone.id });

    expect(linked.milestones).toMatchObject([{ goalPlanId: first.id, goalTitle: first.title, milestone: { id: milestone.id, title: milestone.title } }]);
    expect(linked.milestones.some(item => item.goalPlanId === second.id)).toBe(false);
  });

  it('项目能关联同一份证据记录', () => {
    const plan = activePlan('项目目标');
    const project = createGoalProject({ title: '验收项目', goalPlanId: plan.id });
    const evidence = saveEvidence({
      text: '提交了验收材料。', source: '测试', reference: 'case-1', observedAt: new Date().toISOString(),
      links: ['task'], level: 'E2', reportSubmitted: true, latencyMs: null, benchmarkComplete: null,
    });

    const updated = linkGoalProjectEvidence(project.id, evidence.id);

    expect(updated.evidence).toMatchObject([{ id: evidence.id, text: evidence.text }]);
    correctEvidence(evidence.id, { ...evidence, text: '更正后的验收材料。' });
    expect(listGoalProjects().find(item => item.id === project.id)?.evidence[0]).toMatchObject({ id: evidence.id, text: '更正后的验收材料。' });
  });

  it('项目固定交付清单持久化为进度分母，证据更正会刷新趋势与证据来源', () => {
    const plan = activePlan('进展视图目标');
    const project = createGoalProject({ title: '显式交付项目', goalPlanId: plan.id });
    linkGoalProjectMilestone(project.id, { goalPlanId: plan.id, milestoneId: plan.milestones[0].id });
    const initialAction = listGoalPlanActions(plan.id)[0];
    updateGoalPlanAction(initialAction.id, { projectId: project.id });
    const action = listGoalPlanActions(plan.id)[0];
    const evidence = saveEvidence({
      text: '一次完整基准观测', source: '基准测试', reference: 'run-before', observedAt: '2026-11-01T10:00:00.000Z',
      links: ['milestone'], goalPlanId: plan.id, goalActionId: action.id, level: 'E2', reportSubmitted: null, latencyMs: 350, benchmarkComplete: true,
    });
    linkGoalProjectEvidence(project.id, evidence.id);
    const [latencySeries] = createProjectMeasurementSeries(project.id, {
      name: '同一 staging 基准', basis: '相同工作负载、staging 环境和延迟字段。', confirmedComparable: true,
    });
    assignProjectEvidenceToSeries(project.id, latencySeries.id, evidence.id);

    const [sourceDeliverable] = createProjectDeliverable(project.id, { title: '源代码' });
    createProjectDeliverable(project.id, { title: '验收报告' });
    expect(() => createProjectDeliverable(project.id, { title: '源代码' })).toThrow('同名交付物');
    let linkedProject = listGoalProjects().find(item => item.id === project.id)!;
    let model = deriveProjectProgress(linkedProject, listGoalPlanActions(), listProjectDeliverables(project.id), listProjectMeasurementSeries(project.id));
    expect(model.deliverables).toMatchObject({ available: true, total: 2, completed: 0, percent: 0 });
    expect(model.trend.series[0].observations).toEqual([expect.objectContaining({ id: evidence.id, value: 350 })]);
    expect(model.trend.series[0].firstToLastDeltaMs).toBeNull();
    expect(model.trend.applicableRule).toBeNull();

    updateProjectDeliverable(project.id, sourceDeliverable.id, { completed: true });
    expect(listProjectDeliverables(project.id)).toHaveLength(2);
    model = deriveProjectProgress(linkedProject, listGoalPlanActions(), listProjectDeliverables(project.id), listProjectMeasurementSeries(project.id));
    expect(model.deliverables).toMatchObject({ completed: 1, total: 2, percent: 50 });

    correctEvidence(evidence.id, {
      ...evidence, text: '修正后的观测', source: '修订基准', reference: 'run-corrected',
      observedAt: '2026-11-04T10:00:00.000Z', level: 'E1', latencyMs: 299,
    });
    linkedProject = listGoalProjects().find(item => item.id === project.id)!;
    model = deriveProjectProgress(linkedProject, listGoalPlanActions(), listProjectDeliverables(project.id), listProjectMeasurementSeries(project.id));
    expect(model.trend.series[0].observations).toEqual([]);
    expect(model.trend.series[0].excludedEvidence).toEqual([expect.objectContaining({ id: evidence.id, canReconfirm: true })]);
    assignProjectEvidenceToSeries(project.id, latencySeries.id, evidence.id);
    linkedProject = listGoalProjects().find(item => item.id === project.id)!;
    model = deriveProjectProgress(linkedProject, listGoalPlanActions(), listProjectDeliverables(project.id), listProjectMeasurementSeries(project.id));
    expect(model.trend.series[0].observations).toEqual([expect.objectContaining({ id: evidence.id, value: 299, source: '修订基准', reference: 'run-corrected', level: 'E1', observedAt: '2026-11-04T10:00:00.000Z' })]);
    expect(model.evidence.sources).toEqual(['修订基准']);
    expect(model.milestones[0].evidenceIds).toEqual([evidence.id]);
  });

  it('只有用户确认口径并选入同一测量序列的证据才能形成趋势', () => {
    const plan = activePlan('可比较测量目标');
    const project = createGoalProject({ title: '同口径比较项目', goalPlanId: plan.id });
    linkGoalProjectMilestone(project.id, { goalPlanId: plan.id, milestoneId: plan.milestones[0].id });
    const initialAction = listGoalPlanActions(plan.id)[0];
    updateGoalPlanAction(initialAction.id, { projectId: project.id });
    const action = listGoalPlanActions(plan.id)[0];
    const saveMeasurement = (source: string, reference: string, observedAt: string, latencyMs: number, text: string) => saveEvidence({
      text, source, reference, observedAt, links: ['milestone'], goalPlanId: plan.id, goalActionId: action.id,
      level: 'E2', reportSubmitted: null, latencyMs, benchmarkComplete: true,
    });
    const ciRun = saveMeasurement('CI', 'ci-run-1', '2026-11-01T10:00:00.000Z', 350, '工作负载 A；staging；版本 v1');
    const manualRun = saveMeasurement('手工测试', 'manual-run-1', '2026-11-03T10:00:00.000Z', 324, '工作负载 A；staging；版本 v1');
    const unrelatedRun = saveMeasurement('性能平台', 'perf-run-2', '2026-11-02T10:00:00.000Z', 120, '工作负载 B；本地环境；版本 v2');
    for (const item of [ciRun, manualRun, unrelatedRun]) linkGoalProjectEvidence(project.id, item.id);

    let linkedProject = listGoalProjects().find(item => item.id === project.id)!;
    let model = deriveProjectProgress(linkedProject, listGoalPlanActions(), listProjectDeliverables(project.id), listProjectMeasurementSeries(project.id));
    expect(model.trend.unassignedObservations.map(item => item.id)).toHaveLength(3);
    expect(model.trend.series).toEqual([]);
    expect(() => createProjectMeasurementSeries(project.id, { name: '未确认序列', basis: '不确定', confirmedComparable: false })).toThrow('请确认');

    const [comparisonSeries] = createProjectMeasurementSeries(project.id, {
      name: '工作负载 A / staging / v1',
      basis: '两条记录均使用工作负载 A、staging 环境及 v1 指标口径；数据来源不同但测试条件相同。',
      confirmedComparable: true,
    });
    assignProjectEvidenceToSeries(project.id, comparisonSeries.id, ciRun.id);
    assignProjectEvidenceToSeries(project.id, comparisonSeries.id, manualRun.id);
    linkedProject = listGoalProjects().find(item => item.id === project.id)!;
    model = deriveProjectProgress(linkedProject, listGoalPlanActions(), listProjectDeliverables(project.id), listProjectMeasurementSeries(project.id));

    expect(model.trend.series[0]).toMatchObject({
      name: '工作负载 A / staging / v1',
      basis: '两条记录均使用工作负载 A、staging 环境及 v1 指标口径；数据来源不同但测试条件相同。',
      evidenceIds: [ciRun.id, manualRun.id], firstToLastDeltaMs: -26,
    });
    expect(model.trend.unassignedObservations).toEqual([expect.objectContaining({ id: unrelatedRun.id, value: 120 })]);
  });

  it('迁移同名旧任务时按行创建独立项目，不跨目标按名称合并', () => {
    const first = activePlan('迁移目标 A');
    const second = activePlan('迁移目标 B');
    const firstTask = createGoalPlanAction({ goalPlanId: first.id, title: '整理材料' });
    const secondTask = createGoalPlanAction({ goalPlanId: second.id, title: '整理材料' });
    const database = new DatabaseSync(process.env.BUILDYOURSELF_DB!);
    database.prepare('UPDATE goal_plan_actions SET project_name=?,project_id=NULL WHERE id IN (?,?)').run('迁移项目', firstTask.id, secondTask.id);
    database.prepare("DELETE FROM settings WHERE key='projectIdentityVersion'").run();
    database.close();

    const migratedTasks = listGoalPlanActions().filter(action => [firstTask.id, secondTask.id].includes(action.id));
    const projects = listGoalProjects().filter(item => migratedTasks.some(action => action.projectId === item.id));

    expect(migratedTasks).toHaveLength(2);
    expect(migratedTasks.every(action => action.projectName === '迁移项目' && action.projectId)).toBe(true);
    expect(new Set(migratedTasks.map(action => action.projectId)).size).toBe(2);
    expect(projects.map(project => project.goals[0].goalPlanId).sort()).toEqual([first.id, second.id].sort());
  });

  it('拆分首版按名称误合并的项目时保留每个目标自己的项目副本', () => {
    const first = activePlan('历史目标 A');
    const second = activePlan('历史目标 B');
    const project = createGoalProject({ title: '旧版共享项目', goalPlanId: first.id });
    linkGoalProjectToGoal(project.id, { goalPlanId: second.id });
    const firstTask = createGoalPlanAction({ goalPlanId: first.id, title: '目标 A 工作', projectId: project.id });
    const secondTask = createGoalPlanAction({ goalPlanId: second.id, title: '目标 B 工作', projectId: project.id });
    const database = new DatabaseSync(process.env.BUILDYOURSELF_DB!);
    database.prepare("DELETE FROM settings WHERE key='projectIdentityVersion'").run();
    database.close();

    const tasks = listGoalPlanActions().filter(action => [firstTask.id, secondTask.id].includes(action.id));
    const projects = listGoalProjects().filter(item => tasks.some(action => action.projectId === item.id));

    expect(tasks.map(task => task.projectId)).toHaveLength(2);
    expect(tasks[0].projectId).not.toBe(tasks[1].projectId);
    expect(projects).toHaveLength(2);
    expect(projects.map(item => item.goals[0].goalPlanId).sort()).toEqual([first.id, second.id].sort());
  });
});
