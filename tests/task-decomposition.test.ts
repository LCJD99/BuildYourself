import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateWeeklyPlan } from '../lib/daily-planner';
import {
  activateGoalPlan,
  createGoalPlanAction,
  createTaskDecompositionProposal,
  listGoalPlanActions,
  listPendingGoalActions,
  listTaskDecompositionProposals,
  resolveTaskDecompositionProposal,
  saveGoalPlanDraft,
} from '../lib/goal-plans';
import { confirmDailyPlan, generateAndSaveDailyPlan } from '../lib/daily-plan-store';

const dir = mkdtempSync(join(tmpdir(), 'buildyourself-task-decomposition-'));
beforeEach(() => { process.env.BUILDYOURSELF_DB = join(dir, `${randomUUID()}.sqlite`); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function activeGoal() {
  const draft = saveGoalPlanDraft({
    sourceIntent: '完成项目', title: '完成项目', domain: 'project', context: '工作项目',
    successDescription: '完成项目交付。', observableResult: '通过验收的交付物。', baselineStatus: 'known',
    milestones: [{ title: '完成交付', stage: 'near', successCriteria: '交付物通过验收。', standardAssessment: 'reasonable', evidenceAvailability: 'available', reviewNote: '验收记录可查。', evidenceRequirement: '验收记录' }],
    nextActions: [{ title: '准备交付', details: '完成并提交项目材料。', estimateMinutes: 180, specificity: 'concrete' }],
    constraints: { status: 'confirmed', items: [] },
    evidenceRequirements: [{ item: '交付验收', description: '保存验收结果。', minimumLevel: 'E2' }], reviewCycleDays: 7,
  });
  activateGoalPlan(draft.id);
  return draft.id;
}

const proposal = () => ({
  tasks: [
    { id: 'outline', title: '整理交付大纲', details: '列出交付范围。', estimateMinutes: 60, successCriteria: '形成包含全部交付项的大纲。', dependencyIds: [] },
    { id: 'draft', title: '撰写交付初稿', details: '根据大纲撰写。', estimateMinutes: 120, successCriteria: '初稿覆盖大纲中的全部交付项。', dependencyIds: ['outline'] },
  ],
});

describe('任务拆分提议', () => {
  it('将提议保留为待核对草稿，列出时长、依赖和完成标准且不进入待排池', () => {
    const goalPlanId = activeGoal();
    const [parent] = listGoalPlanActions(goalPlanId);
    const created = createGoalPlanAction({ goalPlanId, title: '完成项目交付', deadline: '2026-12-01', estimateMinutes: 180 });
    const saved = createTaskDecompositionProposal(created.id, proposal());

    expect(saved).toMatchObject({ status: 'pending_review', parentActionId: created.id, goalPlanId });
    expect(saved.tasks).toMatchObject([
      { id: 'outline', estimateMinutes: 60, successCriteria: '形成包含全部交付项的大纲。', dependencyIds: [] },
      { id: 'draft', estimateMinutes: 120, successCriteria: '初稿覆盖大纲中的全部交付项。', dependencyIds: ['outline'] },
    ]);
    expect(listTaskDecompositionProposals(goalPlanId)).toHaveLength(1);
    expect(listPendingGoalActions().map(action => action.id)).toEqual([parent.id, created.id]);
  });

  it('允许编辑待核对提议，并拒绝循环依赖', () => {
    const goalPlanId = activeGoal();
    const [parent] = listGoalPlanActions(goalPlanId);
    const saved = createTaskDecompositionProposal(parent.id, proposal());

    expect(() => resolveTaskDecompositionProposal(saved.id, { action: 'edit', tasks: [
      { id: 'a', title: 'A', estimateMinutes: 30, successCriteria: 'A完成', dependencyIds: ['b'] },
      { id: 'b', title: 'B', estimateMinutes: 30, successCriteria: 'B完成', dependencyIds: ['a'] },
    ] })).toThrow('循环');
    const edited = resolveTaskDecompositionProposal(saved.id, { action: 'edit', tasks: [
      { id: 'outline', title: '修订大纲', estimateMinutes: 45, successCriteria: '修订后的大纲完整', dependencyIds: [] },
      { id: 'draft', title: '撰写初稿', estimateMinutes: 90, successCriteria: '初稿覆盖所有交付项', dependencyIds: ['outline'] },
    ] });
    expect(edited.status).toBe('pending_review');
    expect(edited.tasks[0]).toMatchObject({ title: '修订大纲', estimateMinutes: 45 });
    expect(listPendingGoalActions().map(action => action.id)).toContain(parent.id);
  });

  it('确认后替换父任务并创建保留截止、依赖和完成标准的待排子任务', () => {
    const goalPlanId = activeGoal();
    const parent = createGoalPlanAction({ goalPlanId, title: '完成项目交付', deadline: '2026-12-01', estimateMinutes: 180 });
    const saved = createTaskDecompositionProposal(parent.id, proposal());

    const accepted = resolveTaskDecompositionProposal(saved.id, { action: 'confirm' });

    expect(accepted.status).toBe('accepted');
    const actions = listGoalPlanActions(goalPlanId);
    const parentAfter = actions.find(action => action.id === parent.id)!;
    const children = actions.filter(action => action.parentActionId === parent.id);
    const outline = children.find(action => action.title === '整理交付大纲')!;
    const draft = children.find(action => action.title === '撰写交付初稿')!;
    expect(parentAfter.decomposedAt).toBeTruthy();
    expect(children).toHaveLength(2);
    expect(outline).toMatchObject({ status: 'pending_schedule', deadline: '2026-12-01', successCriteria: '形成包含全部交付项的大纲。' });
    expect(draft).toMatchObject({ status: 'pending_schedule', deadline: '2026-12-01', successCriteria: '初稿覆盖大纲中的全部交付项。' });
    expect(draft.dependencyIds).toEqual([outline.id]);
    const pending = listPendingGoalActions();
    expect(pending.map(action => action.id)).not.toContain(parent.id);
    expect(pending.map(action => action.id)).toEqual(expect.arrayContaining(children.map(action => action.id)));
    const planned = generateWeeklyPlan({
      weekStart: '2026-11-09',
      actions: pending,
      capacities: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`2026-11-${String(9 + index).padStart(2, '0')}`, 120])),
    });
    const outlineDate = planned.days.find(day => day.actions.some(action => action.actionId === outline.id))?.date;
    const draftDate = planned.days.find(day => day.actions.some(action => action.actionId === draft.id))?.date;
    expect(outlineDate).toBe('2026-11-09');
    expect(draftDate).toBe('2026-11-10');
  });

  it('拒绝后保留提议记录且父任务仍待排', () => {
    const goalPlanId = activeGoal();
    const [parent] = listGoalPlanActions(goalPlanId);
    const saved = createTaskDecompositionProposal(parent.id, proposal());

    expect(resolveTaskDecompositionProposal(saved.id, { action: 'reject' }).status).toBe('rejected');
    expect(listPendingGoalActions().map(action => action.id)).toContain(parent.id);
  });

  it('拆分确认后阻止确认已过期的周计划，并允许重新生成包含子任务的安排', () => {
    const goalPlanId = activeGoal();
    const [parent] = listGoalPlanActions(goalPlanId);
    generateAndSaveDailyPlan('2026-11-09');
    const saved = createTaskDecompositionProposal(parent.id, proposal());
    resolveTaskDecompositionProposal(saved.id, { action: 'confirm' });

    expect(() => confirmDailyPlan('2026-11-09')).toThrow('待排行动已发生变化');
    const refreshed = generateAndSaveDailyPlan('2026-11-09');
    expect(refreshed.days.flatMap(day => day.actions).map(action => action.actionId)).not.toContain(parent.id);
    expect(refreshed.days.flatMap(day => day.actions).map(action => action.actionId)).toEqual(expect.arrayContaining(listGoalPlanActions(goalPlanId).filter(action => action.parentActionId === parent.id).map(action => action.id)));
  });

  it('父任务先被已生成的计划安排后仍允许拒绝过期的拆分提议', () => {
    const goalPlanId = activeGoal();
    const [parent] = listGoalPlanActions(goalPlanId);
    generateAndSaveDailyPlan('2026-11-09');
    const saved = createTaskDecompositionProposal(parent.id, proposal());
    confirmDailyPlan('2026-11-09');

    expect(resolveTaskDecompositionProposal(saved.id, { action: 'reject' }).status).toBe('rejected');
    expect(listGoalPlanActions(goalPlanId).find(action => action.id === parent.id)?.status).toBe('scheduled');
  });
});
