import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activateGoalPlan, listPendingGoalActions, saveGoalPlanDraft } from '../lib/goal-plans';
import { confirmDailyPlan, generateAndSaveDailyPlan, getDailyPlan } from '../lib/daily-plan-store';

const dir = mkdtempSync(join(tmpdir(), 'buildyourself-daily-plan-'));
beforeEach(() => { process.env.BUILDYOURSELF_DB = join(dir, `${randomUUID()}.sqlite`); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function completePlan() {
  return {
    sourceIntent: '完成项目测试',
    title: '交付项目测试',
    domain: 'project',
    successDescription: '完成并提交测试报告。',
    observableResult: '有一份可复核的报告。',
    baselineStatus: 'known',
    milestones: [{
      id: 'report-milestone', title: '提交报告', stage: 'near', successCriteria: '报告提交成功。',
      standardAssessment: 'reasonable', evidenceAvailability: 'available', reviewNote: '可以获取提交记录。', evidenceRequirement: '提交记录。',
    }],
    nextActions: [
      { id: 'prepare', title: '准备测试', specificity: 'concrete', estimateMinutes: 60, priority: 'high', hardDeadline: '2026-11-10', milestoneId: 'report-milestone' },
      { id: 'submit', title: '提交报告', specificity: 'concrete', estimateMinutes: 30, priority: 'medium', dependsOn: ['prepare'], milestoneId: 'report-milestone' },
    ],
    constraints: { status: 'confirmed', items: [] },
    evidenceRequirements: [{ item: '报告', description: '保存报告链接。', minimumLevel: 'E2' }],
    reviewCycleDays: 7,
  };
}

describe('周计划持久化', () => {
  it('保存行动元数据、容量草稿，并在确认后恢复同一计划', () => {
    const draft = saveGoalPlanDraft(completePlan());
    activateGoalPlan(draft.id);

    const generated = generateAndSaveDailyPlan('2026-11-09', { '2026-11-09': 60, '2026-11-10': 60 });
    expect(generated.days[0].actions[0]).toMatchObject({
      title: '准备测试', priority: 'high', hardDeadline: '2026-11-10', milestoneTitle: '提交报告',
    });
    expect(generated.days[1].actions[0]).toMatchObject({ title: '提交报告', dependsOn: [`${draft.id}:prepare`] });
    expect(getDailyPlan('2026-11-09')).toMatchObject({ status: 'draft', plan: generated });

    const confirmed = confirmDailyPlan('2026-11-09');
    expect(confirmed).toMatchObject({ status: 'confirmed', plan: generated });
    expect(confirmed.confirmedAt).toBeTruthy();
    expect(getDailyPlan('2026-11-09')).toEqual(confirmed);
    expect(listPendingGoalActions()).toEqual([]);
    expect(() => generateAndSaveDailyPlan('2026-11-09')).toThrow('已经确认');
  });

  it('只接受周一作为周计划起始日期', () => {
    expect(() => getDailyPlan('2026-11-10')).toThrow('星期一');
  });
});
