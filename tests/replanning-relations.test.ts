import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activateGoalPlan, listGoalPlanActions, saveGoalPlanDraft } from '../lib/goal-plans';
import { createGoalRelation, resolveGoalRelation } from '../lib/goal-relations';
import { createReplanProposal, decideReplanProposal, editReplanProposal } from '../lib/replanning';

const dir = mkdtempSync(join(tmpdir(), 'buildyourself-replan-relations-'));
beforeEach(() => { process.env.BUILDYOURSELF_DB = join(dir, `${randomUUID()}.sqlite`); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function activeGoal(title: string) {
  const draft = saveGoalPlanDraft({
    sourceIntent: title, title, domain: 'general', successDescription: `${title}结果`, observableResult: `${title}交付`,
    baselineStatus: 'known', constraints: { status: 'confirmed', items: [] },
    milestones: [{ title: `${title}阶段`, stage: 'near', successCriteria: `${title}完成`, standardAssessment: 'reasonable', evidenceAvailability: 'available', reviewNote: '可核对', evidenceRequirement: '提交记录' }],
    nextActions: [{ id: 'action', title: `${title}行动`, estimateMinutes: 60, hardDeadline: null, specificity: 'concrete' }],
    evidenceRequirements: [{ item: '提交记录', description: '保存记录', minimumLevel: 'E2' }], reviewCycleDays: 7,
  });
  activateGoalPlan(draft.id);
  return listGoalPlanActions(draft.id)[0];
}

describe('关系对重排的影响与解释', () => {
  it('候选时间冲突不影响建议；确认后才分开安排并保留关系引用', () => {
    const left = activeGoal('课程项目');
    const right = activeGoal('体能训练');
    const candidate = createGoalRelation({
      type: 'time_conflict', sourceActionId: left.id, targetActionId: right.id,
      sourceType: 'ai_inference', sourceLabel: 'AI 推断', confidence: 'medium', impact: '两项行动不能放在同一天。',
    });
    const draft = createReplanProposal({ weekStart: '2026-11-09', trigger: 'constraint_change', reason: '核对跨目标关系' });
    const draftDates = draft.plan.days.flatMap(day => day.actions.map(action => ({ id: action.actionId, date: day.date })));
    expect(draftDates.find(item => item.id === left.id)?.date).toBe(draftDates.find(item => item.id === right.id)?.date);
    expect(draft.plan.relationExplanations).toMatchObject([{ relation: { id: candidate.id, status: 'candidate' }, effect: 'unconfirmed' }]);

    resolveGoalRelation(candidate.id, { action: 'confirm', confirmed: true, version: 1, reason: '已核对训练后需要空出当天。' });
    expect(() => decideReplanProposal(draft.id, 'accept')).toThrow('已发生变化');
    const confirmed = createReplanProposal({ weekStart: '2026-11-09', trigger: 'constraint_change', reason: '按已确认关系再次重排' });
    const confirmedDates = confirmed.plan.days.flatMap(day => day.actions.map(action => ({ id: action.actionId, date: day.date })));
    expect(confirmedDates.find(item => item.id === left.id)?.date).not.toBe(confirmedDates.find(item => item.id === right.id)?.date);
    expect(confirmed.plan.relationExplanations).toMatchObject([{ relation: { id: candidate.id, version: 2, status: 'confirmed' }, effect: 'schedule' }]);
    expect(confirmed.changes.some(change => change.reason.includes(`关系 ${candidate.id}`))).toBe(true);
  });

  it('确认的前置依赖和完整恢复日按跨目标关系排程', () => {
    const left = activeGoal('课程项目');
    const right = activeGoal('体能训练');
    const relation = createGoalRelation({
      type: 'recovery_conflict', sourceActionId: left.id, targetActionId: right.id,
      sourceType: 'user', sourceLabel: '用户确认', confidence: 'high', minimumRestDays: 1,
      impact: '课程项目行动之后，体能训练前需留出一个完整恢复日。',
    });
    resolveGoalRelation(relation.id, { action: 'confirm', confirmed: true, version: 1, reason: '已明确确认恢复需求。' });

    const proposal = createReplanProposal({ weekStart: '2026-11-09', trigger: 'constraint_change', reason: '按已确认恢复关系重排' });
    const dates = new Map(proposal.plan.days.flatMap(day => day.actions.map(action => [action.actionId, day.date] as const)));
    const sourceDate = dates.get(left.id)!;
    const targetDate = dates.get(right.id)!;
    const earliestTargetDate = new Date(`${sourceDate}T00:00:00.000Z`);
    earliestTargetDate.setUTCDate(earliestTargetDate.getUTCDate() + 2);

    expect(targetDate).toBe(earliestTargetDate.toISOString().slice(0, 10));
    expect(proposal.plan.relationExplanations).toMatchObject([{ relation: { id: relation.id, type: 'recovery_conflict' }, effect: 'schedule' }]);
    expect(proposal.changes.find(change => change.actionId === right.id)?.reason).toContain(relation.id);
  });

  it('确认的跨目标前置依赖要求关联行动在后续日期进行', () => {
    const prerequisite = activeGoal('前置项目');
    const dependent = activeGoal('后续目标');
    const relation = createGoalRelation({
      type: 'prerequisite', sourceActionId: prerequisite.id, targetActionId: dependent.id,
      sourceType: 'user', sourceLabel: '用户确认', confidence: 'high', impact: '先完成项目准备，再开展后续目标行动。',
    });
    resolveGoalRelation(relation.id, { action: 'confirm', confirmed: true, version: 1, reason: '已确认前置顺序。' });

    const proposal = createReplanProposal({ weekStart: '2026-11-09', trigger: 'constraint_change', reason: '按前置关系重排' });
    const dates = new Map(proposal.plan.days.flatMap(day => day.actions.map(action => [action.actionId, day.date] as const)));
    expect(dates.get(prerequisite.id)).toBe('2026-11-09');
    expect(dates.get(dependent.id)).toBe('2026-11-10');
  });

  it('手动编辑不能把已确认的时间冲突行动放在同一天', () => {
    const left = activeGoal('课程项目');
    const right = activeGoal('体能训练');
    const relation = createGoalRelation({
      type: 'time_conflict', sourceActionId: left.id, targetActionId: right.id,
      sourceType: 'user', sourceLabel: '用户确认', confidence: 'high', impact: '两项行动不能安排在同一天。',
    });
    resolveGoalRelation(relation.id, { action: 'confirm', confirmed: true, version: 1, reason: '已确认存在同日冲突。' });
    const proposal = createReplanProposal({ weekStart: '2026-11-09', trigger: 'constraint_change', reason: '检查手动编辑约束' });

    expect(() => editReplanProposal(proposal.id, { [right.id]: '2026-11-09' }))
      .toThrow(`已确认的同日冲突（关系 ${relation.id}）`);
  });

  it('手动编辑不能缩短已确认的完整恢复间隔', () => {
    const source = activeGoal('课程项目');
    const target = activeGoal('体能训练');
    const relation = createGoalRelation({
      type: 'recovery_conflict', sourceActionId: source.id, targetActionId: target.id,
      sourceType: 'user', sourceLabel: '用户确认', confidence: 'high', minimumRestDays: 1,
      impact: '课程项目行动之后需要一个完整恢复日。',
    });
    resolveGoalRelation(relation.id, { action: 'confirm', confirmed: true, version: 1, reason: '已确认需要一个完整恢复日。' });
    const proposal = createReplanProposal({ weekStart: '2026-11-09', trigger: 'constraint_change', reason: '检查手动编辑约束' });

    expect(() => editReplanProposal(proposal.id, { [target.id]: '2026-11-10' }))
      .toThrow(`关系 ${relation.id} 要求的完整恢复间隔`);
  });
});
