import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activateGoalPlan, listGoalPlanActions, saveGoalPlanDraft } from '../lib/goal-plans';
import { createGoalRelation, listGoalRelations, listPlanningGoalRelations, resolveGoalRelation } from '../lib/goal-relations';

const dir = mkdtempSync(join(tmpdir(), 'buildyourself-relations-'));
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

describe('跨目标关系', () => {
  it('候选关系经确认后才进入规划规则，修正后回到待核对并保留事件历史', () => {
    const left = activeGoal('课程项目');
    const right = activeGoal('健身训练');
    const candidate = createGoalRelation({
      type: 'time_conflict', sourceActionId: left.id, targetActionId: right.id,
      sourceType: 'ai_inference', sourceLabel: 'AI 推断', sourceReference: '聊天记录 2026-11-12',
      confidence: 'medium', impact: '两项任务可能在同一天争用可用时间。',
      evidenceReferences: [{ kind: 'reference', id: 'week:2026-11-09', label: '本周计划' }],
    });

    expect(candidate).toMatchObject({ status: 'candidate', version: 1, type: 'time_conflict', sourceType: 'ai_inference', confidence: 'medium' });
    expect(candidate.evidenceReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'action', id: left.id }),
      expect.objectContaining({ kind: 'action', id: right.id }),
      expect.objectContaining({ kind: 'reference', id: 'week:2026-11-09' }),
    ]));
    expect(listPlanningGoalRelations()).toEqual([]);

    const confirmed = resolveGoalRelation(candidate.id, { action: 'confirm', confirmed: true, version: 1, reason: '我确认两项任务不能同日进行。' });
    expect(confirmed).toMatchObject({ status: 'confirmed', version: 2 });
    expect(listPlanningGoalRelations().map(relation => relation.id)).toEqual([candidate.id]);

    const corrected = resolveGoalRelation(candidate.id, {
      action: 'correct', version: 2, reason: '实际是训练后需要完整休息一天。',
      relation: {
        type: 'recovery_conflict', sourceActionId: left.id, targetActionId: right.id,
        sourceType: 'user', sourceLabel: '用户确认', sourceReference: null,
        confidence: 'high', impact: '课程项目之后需要留出一个完整恢复日。', minimumRestDays: 1,
        evidenceReferences: [{ kind: 'reference', id: 'user-note:1', label: '用户说明' }],
      },
    });
    expect(corrected).toMatchObject({ status: 'candidate', version: 3, type: 'recovery_conflict', minimumRestDays: 1 });
    expect(listPlanningGoalRelations()).toEqual([]);
    expect(listGoalRelations()[0].events).toHaveLength(3);
    expect(listGoalRelations()[0].events[2]).toMatchObject({ action: 'corrected', reason: '实际是训练后需要完整休息一天。' });
  });

  it('拒绝候选关系时保留其来源和证据，并写入否定原因', () => {
    const left = activeGoal('目标一');
    const right = activeGoal('目标二');
    const candidate = createGoalRelation({
      type: 'shared_material', sourceActionId: left.id, targetActionId: right.id,
      sourceType: 'ai_inference', sourceLabel: 'AI 推断', confidence: 'low', impact: '可能共享参考资料。',
    });
    const rejected = resolveGoalRelation(candidate.id, { action: 'reject', version: 1, reason: '两个目标使用不同的材料。' });

    expect(rejected).toMatchObject({ status: 'rejected', version: 2, sourceLabel: 'AI 推断' });
    expect(rejected.events.at(-1)).toMatchObject({ action: 'rejected', reason: '两个目标使用不同的材料。' });
    expect(rejected.evidenceReferences.map(item => item.kind)).toEqual(['action', 'action']);
  });
});
