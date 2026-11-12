import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activateGoalPlan, createGoalPlanAction, createOrLinkGoalProject, linkGoalProjectEvidence, listGoalPlanActions, listGoalProjects, saveGoalPlanDraft, updateGoalPlanAction } from '../lib/goal-plans';
import { saveEvidence } from '../lib/store';
import { correctEvidence } from '../lib/milestone-store';

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
  it('同名项目跨目标复用同一记录，并显示同一任务 ID 和更新', () => {
    const first = activePlan('项目目标 A');
    const second = activePlan('项目目标 B');
    const project = createOrLinkGoalProject({ title: '年度报告', goalPlanId: first.id });
    const shared = createOrLinkGoalProject({ title: ' 年度报告 ', goalPlanId: second.id });
    const task = createGoalPlanAction({ goalPlanId: first.id, title: '起草报告', projectName: '年度报告' });

    expect(shared.id).toBe(project.id);
    expect(shared.goals.map(goal => goal.goalPlanId)).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(task.projectId).toBe(project.id);
    expect(listGoalPlanActions().filter(action => action.projectId === shared.id).map(action => action.id)).toEqual([task.id]);

    updateGoalPlanAction(task.id, { title: '核对并提交报告' });
    expect(listGoalPlanActions().find(action => action.projectId === project.id)).toMatchObject({ id: task.id, title: '核对并提交报告' });
    expect(listGoalProjects().find(item => item.id === project.id)?.goals).toHaveLength(2);
  });

  it('项目能关联同一份证据记录', () => {
    const plan = activePlan('项目目标');
    const project = createOrLinkGoalProject({ title: '验收项目', goalPlanId: plan.id });
    const evidence = saveEvidence({
      text: '提交了验收材料。', source: '测试', reference: 'case-1', observedAt: new Date().toISOString(),
      links: ['task'], level: 'E2', reportSubmitted: true, latencyMs: null, benchmarkComplete: null,
    });

    const updated = linkGoalProjectEvidence(project.id, evidence.id);

    expect(updated.evidence).toMatchObject([{ id: evidence.id, text: evidence.text }]);
    correctEvidence(evidence.id, { ...evidence, text: '更正后的验收材料。' });
    expect(listGoalProjects().find(item => item.id === project.id)?.evidence[0]).toMatchObject({ id: evidence.id, text: '更正后的验收材料。' });
  });

  it('迁移已有任务上的项目名称并生成共享项目关联', () => {
    const plan = activePlan('迁移目标');
    const task = createGoalPlanAction({ goalPlanId: plan.id, title: '整理材料' });
    const database = new DatabaseSync(process.env.BUILDYOURSELF_DB!);
    database.prepare('UPDATE goal_plan_actions SET project_name=?,project_id=NULL WHERE id=?').run('迁移项目', task.id);
    database.close();

    const migratedTask = listGoalPlanActions().find(action => action.id === task.id)!;
    const project = listGoalProjects().find(item => item.id === migratedTask.projectId);

    expect(migratedTask.projectName).toBe('迁移项目');
    expect(project).toMatchObject({ title: '迁移项目', goals: [{ goalPlanId: plan.id, title: '迁移目标' }] });
  });
});
