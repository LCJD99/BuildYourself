import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from '../app/api/goal-plans/route';
import { POST as postEvaluation } from '../app/api/goal-plans/[id]/evaluations/route';
import { activateGoalPlan, saveGoalPlanDraft } from '../lib/goal-plans';
import { saveEvidence } from '../lib/store';

const directory = mkdtempSync(join(tmpdir(), 'buildyourself-goal-navigation-api-'));
beforeEach(() => { process.env.BUILDYOURSELF_DB = join(directory, `${randomUUID()}.sqlite`); });
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function completePlan() {
  return {
    sourceIntent: '我想完成课程展示',
    title: '完成英语课程展示',
    domain: 'learning',
    domainTemplate: { id: 'learning', version: '1.0.0' },
    successDescription: '完成一次可核对的英文展示。',
    observableResult: '提交展示录像和课程平台反馈。',
    baselineStatus: 'known',
    milestones: [{
      title: '提交展示录像', stage: 'near', successCriteria: '提交一段完整录像。',
      standardAssessment: 'reasonable', evidenceAvailability: 'available',
      reviewNote: '录像和平台反馈可以保存。', evidenceRequirement: 'E2 提交记录。',
    }],
    nextActions: [{ title: '录制课程展示', details: '按课程要求录制。', estimateMinutes: 30, specificity: 'concrete' }],
    constraints: { status: 'confirmed', items: [] },
    evidenceRequirements: [{ item: '展示录像', description: '保存提交记录。', minimumLevel: 'E2' }],
    reviewCycleDays: 7,
  };
}

describe('组合总览接口', () => {
  it('返回摘要、单目标工作区和详情共用的真实目标、行动、证据及评价', async () => {
    const draft = saveGoalPlanDraft(completePlan());
    const goal = activateGoalPlan(draft.id, { confirmed: true, reviewedAt: draft.updatedAt });
    const action = (await (await GET()).json()).actions[0];
    const evidence = saveEvidence({
      text: '课程平台已收到展示录像。', source: '课程平台', reference: '课程反馈-1',
      observedAt: new Date().toISOString(), links: ['task'], goalPlanId: goal.id,
      goalActionId: action.id, level: 'E2', reportSubmitted: true,
      benchmarkComplete: null, latencyMs: null,
    });
    const evaluationResponse = await postEvaluation(new Request(`http://localhost/api/goal-plans/${goal.id}/evaluations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'record', outcome: 'met', summary: '展示录像已按要求提交。',
        milestoneId: goal.milestones[0].id, evidenceIds: [evidence.id], reasons: ['E2 课程平台记录可用。'],
      }),
    }), { params: Promise.resolve({ id: goal.id }) });
    expect(evaluationResponse.status).toBe(201);

    const state = await (await GET()).json();

    expect(state.plans[0].id).toBe(goal.id);
    expect(state.actions[0].id).toBe(action.id);
    expect(state.evidence[0].id).toBe(evidence.id);
    expect(state.evidence[0]).toMatchObject({ goalPlanId: goal.id, goalActionId: action.id, level: 'E2' });
    expect(state.commitments).toEqual([]);
    expect(state.evaluations).toMatchObject([{
      goalPlanId: goal.id, outcome: 'met', milestoneId: goal.milestones[0].id,
      evidenceIds: [evidence.id], contractVersion: { version: 1 },
    }]);
  });
});
