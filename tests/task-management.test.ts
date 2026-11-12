import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGoalPlanAction, activateGoalPlan, listGoalPlanActions, saveGoalPlanDraft, updateGoalPlanAction } from '../lib/goal-plans';
import { listChangeEvents } from '../lib/milestone-store';

const dir = mkdtempSync(join(tmpdir(), 'buildyourself-task-management-'));
beforeEach(() => { process.env.BUILDYOURSELF_DB = join(dir, `${randomUUID()}.sqlite`); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function completePlan(title = '英语表达目标') {
  return {
    sourceIntent: `我想完成${title}`,
    title,
    domain: 'learning',
    domainTemplate: { id: 'learning', version: '1.0.0' },
    context: '工作会议',
    successDescription: '能独立主持一次英文同步。',
    observableResult: '保存一段会议录音并获得导师反馈。',
    baselineStatus: 'known',
    baselineAction: null,
    milestones: [{ title: '完成基线', stage: 'near', successCriteria: '录制一段三分钟介绍。', standardAssessment: 'reasonable', evidenceAvailability: 'available', reviewNote: '可保存录音并按同一标准复听。', evidenceRequirement: '录音（E2）' }],
    nextActions: [{ title: '录制英文介绍', details: '准备并录音。', estimateMinutes: 20, specificity: 'concrete' }],
    constraints: { status: 'confirmed', items: [] },
    evidenceRequirements: [{ item: '英文表达', description: '保留录音', minimumLevel: 'E2' }],
    reviewCycleDays: 7,
  };
}

function activePlan(title?: string) {
  const draft = saveGoalPlanDraft(completePlan(title));
  activateGoalPlan(draft.id, { confirmed: true, reviewedAt: draft.updatedAt });
  return draft.id;
}

describe('手动维护目标任务', () => {
  it('把任务保存到活跃目标的待排池并记录完整字段', () => {
    const goalPlanId = activePlan();
    const existing = listGoalPlanActions(goalPlanId)[0];
    const task = createGoalPlanAction({
      goalPlanId,
      title: '完成项目演示稿',
      projectName: '季度演示项目',
      details: '准备 5 页演示稿。',
      deadline: '2026-12-01',
      estimateMinutes: 90,
      dependencyIds: [existing.id],
      successCriteria: '演示稿包含目标、进展和下一步。',
      evidenceRequirement: '保存最终 PDF（E2）。',
    });

    expect(task).toMatchObject({
      goalPlanId,
      goalTitle: '英语表达目标',
      title: '完成项目演示稿',
      projectName: '季度演示项目',
      deadline: '2026-12-01',
      estimateMinutes: 90,
      dependencyIds: [existing.id],
      successCriteria: '演示稿包含目标、进展和下一步。',
      evidenceRequirement: '保存最终 PDF（E2）。',
      status: 'pending_schedule',
    });
    expect(listGoalPlanActions(goalPlanId)).toHaveLength(2);
    expect(listChangeEvents()[0]).toMatchObject({ eventType: 'task.created', entityId: task.id, summary: expect.stringContaining(task.title) });
  });

  it('拒绝给草稿目标添加任务', () => {
    const draft = saveGoalPlanDraft(completePlan());

    expect(() => createGoalPlanAction({ goalPlanId: draft.id, title: '不应进入待排池' })).toThrow('活跃目标');
    expect(listGoalPlanActions()).toEqual([]);
    expect(listChangeEvents()).toEqual([]);
  });

  it('拒绝无效、跨目标或会形成循环的依赖', () => {
    const firstGoal = activePlan('目标一');
    const secondGoal = activePlan('目标二');
    const firstTask = listGoalPlanActions(firstGoal)[0];
    const secondTask = listGoalPlanActions(secondGoal)[0];

    expect(() => createGoalPlanAction({ goalPlanId: firstGoal, title: '无效依赖', dependencyIds: ['missing'] })).toThrow('依赖');
    expect(() => createGoalPlanAction({ goalPlanId: firstGoal, title: '跨目标依赖', dependencyIds: [secondTask.id] })).toThrow('依赖');
    expect(() => updateGoalPlanAction(firstTask.id, { goalPlanId: secondGoal })).toThrow('归属');
    const child = createGoalPlanAction({ goalPlanId: firstGoal, title: '子任务', dependencyIds: [firstTask.id] });
    expect(() => updateGoalPlanAction(firstTask.id, { dependencyIds: [child.id] })).toThrow('循环');
    expect(listChangeEvents().filter(event => event.eventType === 'task.updated')).toEqual([]);
  });

  it('编辑任务时保留未提交字段并记录变更', () => {
    const goalPlanId = activePlan();
    const [task] = listGoalPlanActions(goalPlanId);
    const updated = updateGoalPlanAction(task.id, { title: '录制基线介绍', deadline: '2026-11-20' });

    expect(updated).toMatchObject({
      id: task.id,
      title: '录制基线介绍',
      deadline: '2026-11-20',
      details: '准备并录音。',
      estimateMinutes: 20,
      status: 'pending_schedule',
    });
    expect(listChangeEvents()[0]).toMatchObject({ eventType: 'task.updated', entityId: task.id, summary: expect.stringContaining('录制基线介绍') });
    expect(listChangeEvents()[0].details).toMatchObject({
      goalPlanId,
      changedFields: expect.arrayContaining(['任务名称', '截止日期']),
      fieldChanges: expect.arrayContaining([
        expect.objectContaining({ field: '任务名称', before: '录制英文介绍', after: '录制基线介绍' }),
        expect.objectContaining({ field: '截止日期', before: null, after: '2026-11-20' }),
      ]),
    });
  });

  it('重复保存相同任务字段时不制造虚假变更记录', () => {
    const goalPlanId = activePlan();
    const [task] = listGoalPlanActions(goalPlanId);
    updateGoalPlanAction(task.id, { title: task.title });

    expect(listChangeEvents()).toEqual([]);
  });

  it('拒绝不合法的截止时间和预计耗时', () => {
    const goalPlanId = activePlan();
    expect(() => createGoalPlanAction({ goalPlanId, title: '无效日期', deadline: '2026-02-30' })).toThrow('截止');
    expect(() => createGoalPlanAction({ goalPlanId, title: '无效时长', estimateMinutes: 0 })).toThrow('预计耗时');
  });

  it('为已有目标行动表补齐任务字段并保留旧记录', () => {
    const database = new DatabaseSync(process.env.BUILDYOURSELF_DB!);
    database.exec(`CREATE TABLE goal_plans (
      id TEXT PRIMARY KEY, source_intent TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
      plan_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, activated_at TEXT
    );
    CREATE TABLE goal_plan_actions (
      id TEXT PRIMARY KEY, goal_plan_id TEXT NOT NULL REFERENCES goal_plans(id) ON DELETE CASCADE,
      title TEXT NOT NULL, details TEXT, estimate_minutes INTEGER,
      status TEXT NOT NULL, created_at TEXT NOT NULL
    );
    INSERT INTO goal_plans VALUES ('legacy-goal', '', 'active', '{"title":"旧目标"}', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');
    INSERT INTO goal_plan_actions VALUES ('legacy-task', 'legacy-goal', '旧行动', '保留原说明', 15, 'pending_schedule', '2026-11-01T00:00:00.000Z');`);
    database.close();

    expect(listGoalPlanActions('legacy-goal')).toMatchObject([{
      id: 'legacy-task',
      title: '旧行动',
      details: '保留原说明',
      estimateMinutes: 15,
      projectName: null,
      deadline: null,
      dependencyIds: [],
      successCriteria: null,
      evidenceRequirement: null,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    }]);
  });
});
