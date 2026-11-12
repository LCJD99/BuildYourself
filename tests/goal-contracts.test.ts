import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET as getContractChanges, POST as postContractChange } from '../app/api/goal-plans/[id]/contract-changes/route';
import { GET as getEvaluations, POST as postEvaluation } from '../app/api/goal-plans/[id]/evaluations/route';
import { saveEvidence } from '../lib/store';
import {
  activateGoalPlan,
  confirmGoalPlanEvaluation,
  createGoalPlanContractChange,
  getGoalPlan,
  getGoalPlanContractVersionAt,
  listGoalPlanContractVersions,
  listGoalPlanEvaluations,
  listGoalPlanActions,
  recordGoalPlanEvaluation,
  resolveGoalPlanContractChange,
  saveGoalPlanDraft,
} from '../lib/goal-plans';

const dir = mkdtempSync(join(tmpdir(), 'buildyourself-goal-contracts-'));
beforeEach(() => { process.env.BUILDYOURSELF_DB = join(dir, `${randomUUID()}.sqlite`); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function activeGoal() {
  const actionId = randomUUID();
  const draft = saveGoalPlanDraft({
    sourceIntent: '提升英语表达', title: '完成英文项目同步', domain: 'learning', context: '真实工作会议',
    domainTemplate: { id: 'learning', version: '1.0.0' },
    successDescription: '能独立主持一次英文项目同步。', observableResult: '保存会议录音并取得导师反馈。',
    baselineStatus: 'known', baselineAction: null,
    milestones: [{ id: 'meeting', title: '主持项目同步', stage: 'near', successCriteria: '完成 10 分钟英文项目同步并回答提问。', standardAssessment: 'reasonable', evidenceAvailability: 'available', reviewNote: '可通过录音和反馈核对。', evidenceRequirement: '会议录音或导师反馈。' }],
    nextActions: [{ id: actionId, title: '练习项目介绍', details: '准备英文表达。', estimateMinutes: 20, priority: 'medium', hardDeadline: null, milestoneId: 'meeting', dependsOn: [], specificity: 'concrete' }],
    constraints: { status: 'confirmed', items: [] },
    evidenceRequirements: [{ id: 'recording', item: '会议录音', description: '保存完整会议录音。', minimumLevel: 'E2' }],
    reviewCycleDays: 7,
  });
  return activateGoalPlan(draft.id, { confirmed: true, reviewedAt: draft.updatedAt });
}

function evidence(goal: ReturnType<typeof activeGoal>, level: 'E1' | 'E2' | 'E3' = 'E2', observedAt = new Date().toISOString()) {
  const action = listGoalPlanActions(goal.id)[0];
  return saveEvidence({
    text: '已完成并保存项目同步录音。', source: '测试', reference: `会议录音-${randomUUID()}`,
    observedAt, links: ['milestone'], goalPlanId: goal.id, goalActionId: action.id, level,
    reportSubmitted: null, latencyMs: null, benchmarkComplete: null,
  });
}

describe('目标契约版本与进展口径', () => {
  it('候选变更在确认前不改当前契约，确认后写入新版本和事件', () => {
    const goal = activeGoal();
    const candidate = createGoalPlanContractChange(goal.id, {
      summary: '提高里程碑的可核验要求',
      plan: {
        successDescription: '能独立主持一次英文项目同步并回答追问。',
        milestones: [{ ...goal.milestones[0], successCriteria: '完成 10 分钟英文项目同步，回答至少 3 个现场问题，并获得导师 E2 反馈。' }],
      },
    });

    expect(candidate).toMatchObject({ status: 'pending_review', baseVersion: 1, summary: '提高里程碑的可核验要求' });
    expect(getGoalPlan(goal.id)).toMatchObject({ successDescription: goal.successDescription, contractVersion: 1 });
    expect(listGoalPlanContractVersions(goal.id)).toHaveLength(1);
    expect(() => resolveGoalPlanContractChange(goal.id, candidate.id, { action: 'confirm', confirmed: false })).toThrow('需要单独确认');

    const confirmed = resolveGoalPlanContractChange(goal.id, candidate.id, { action: 'confirm', confirmed: true });

    expect(confirmed.status).toBe('confirmed');
    expect(getGoalPlan(goal.id)).toMatchObject({
      successDescription: '能独立主持一次英文项目同步并回答追问。',
      contractVersion: 2,
      lifecycleEvents: expect.arrayContaining([expect.objectContaining({ action: 'contract_changed', reason: '提高里程碑的可核验要求' })]),
    });
    expect(listGoalPlanContractVersions(goal.id).map(version => version.version)).toEqual([1, 2]);
    expect(listGoalPlanContractVersions(goal.id)[0].plan.successDescription).toBe(goal.successDescription);
    expect(listGoalPlanContractVersions(goal.id)[1].plan.milestones[0].successCriteria).toContain('至少 3 个现场问题');
    expect(listGoalPlanContractVersions(goal.id)[1].plan.nextActions).toEqual(goal.nextActions);
    expect(listGoalPlanContractVersions(goal.id)[1].plan.domainTemplate).toEqual(goal.domainTemplate);
  });

  it('每次评价固定保存实际使用的版本 ID 和规则快照，历史读取不随新版本变化', () => {
    const goal = activeGoal();
    const firstVersion = listGoalPlanContractVersions(goal.id)[0];
    const firstEvaluation = recordGoalPlanEvaluation(goal.id, {
      milestoneId: 'meeting', outcome: 'insufficient', summary: '尚无录音。', evidenceIds: [],
      reasons: ['缺少可核验的会议材料。'], observedAt: firstVersion.effectiveAt,
    });
    const candidate = createGoalPlanContractChange(goal.id, {
      summary: '要求现场问答和导师反馈',
      plan: { milestones: [{ ...goal.milestones[0], successCriteria: '完成 10 分钟英文项目同步，回答至少 3 个现场问题，并获得导师 E2 反馈。' }] },
    });
    resolveGoalPlanContractChange(goal.id, candidate.id, { action: 'confirm', confirmed: true });

    const currentEvidence = evidence(goal);
    const currentEvaluation = recordGoalPlanEvaluation(goal.id, {
      milestoneId: 'meeting', outcome: 'met', summary: '已完成现场同步。', evidenceIds: [currentEvidence.id],
      reasons: ['当前契约要求的同步已完成。'], observedAt: firstVersion.effectiveAt,
    });
    const history = listGoalPlanEvaluations(goal.id);

    expect(firstEvaluation.contractVersion).toMatchObject({ id: firstVersion.id, version: 1 });
    expect(firstEvaluation.ruleSnapshot.milestone?.successCriteria).toBe(goal.milestones[0].successCriteria);
    expect(currentEvaluation.contractVersion.version).toBe(2);
    expect(currentEvaluation.ruleSnapshot.milestone?.successCriteria).toContain('至少 3 个现场问题');
    expect(history.map(item => item.contractVersion.version)).toEqual([1, 2]);
    expect(history[0].ruleSnapshot.milestone?.successCriteria).toBe(goal.milestones[0].successCriteria);
  });

  it('仅显式回填才按进展日期选择旧版本，普通新评价始终使用当前版本', () => {
    const goal = activeGoal();
    const firstVersion = listGoalPlanContractVersions(goal.id)[0];
    const candidate = createGoalPlanContractChange(goal.id, {
      summary: '调整标准',
      plan: { milestones: [{ ...goal.milestones[0], successCriteria: '回答至少 3 个问题。' }] },
    });
    const changed = resolveGoalPlanContractChange(goal.id, candidate.id, { action: 'confirm', confirmed: true });
    const secondVersion = listGoalPlanContractVersions(goal.id)[1];
    const observedBeforeChange = new Date(Date.parse(secondVersion.effectiveAt) - 1).toISOString();
    const oldEvidence = evidence(goal);
    const backfillEvidence = evidence(goal);

    const ordinary = recordGoalPlanEvaluation(goal.id, {
      milestoneId: 'meeting', outcome: 'not_met', summary: '补录一条旧观察。', evidenceIds: [oldEvidence.id], reasons: [],
      observedAt: observedBeforeChange,
    });
    const backfilled = recordGoalPlanEvaluation(goal.id, {
      milestoneId: 'meeting', outcome: 'met', summary: '明确按当时口径补录。', evidenceIds: [backfillEvidence.id], reasons: [],
      observedAt: observedBeforeChange, backfill: true,
    });

    expect(ordinary.contractVersion.version).toBe(2);
    expect(backfilled.contractVersion.id).toBe(firstVersion.id);
    expect(getGoalPlanContractVersionAt(goal.id, observedBeforeChange)?.id).toBe(firstVersion.id);
    expect(changed.status).toBe('confirmed');
  });

  it('有结论的评价必须使用达到版本要求的证据', () => {
    const goal = activeGoal();
    const weakEvidence = evidence(goal, 'E1');

    const candidate = recordGoalPlanEvaluation(goal.id, {
      milestoneId: 'meeting', outcome: 'met', summary: '只有自我报告。', evidenceIds: [weakEvidence.id], reasons: [],
    });
    expect(candidate).toMatchObject({ assessmentSource: 'caller_supplied', outcome: 'met', status: 'insufficient', evidenceGate: { requiredLevel: 'E2', status: 'insufficient' } });
    expect(() => confirmGoalPlanEvaluation(goal.id, candidate.id, { confirmed: true })).toThrow('找不到待确认');

    expect(recordGoalPlanEvaluation(goal.id, {
      milestoneId: 'meeting', outcome: 'insufficient', summary: '当前材料不足以判断。', evidenceIds: [weakEvidence.id], reasons: [],
    })).toMatchObject({ assessmentSource: 'caller_supplied', outcome: 'insufficient', evidenceIds: [weakEvidence.id] });
  });

  it('未达到标准也是调用方结论，需用户核对后才成为确认记录', () => {
    const goal = activeGoal();
    const qualifiedEvidence = evidence(goal);
    const candidate = recordGoalPlanEvaluation(goal.id, {
      milestoneId: 'meeting', outcome: 'not_met', summary: '调用方认为尚未满足现场问答标准。',
      evidenceIds: [qualifiedEvidence.id], reasons: ['录音中未出现现场提问。'],
    });

    expect(candidate).toMatchObject({ outcome: 'not_met', status: 'pending_confirmation', assessmentSource: 'caller_supplied' });
    expect(confirmGoalPlanEvaluation(goal.id, candidate.id, { confirmed: true })).toMatchObject({ outcome: 'not_met', status: 'confirmed' });
  });

  it('目标评价只接受明确归属到同一目标和里程碑行动的证据，并沿用真实版本规则', () => {
    const goal = activeGoal();
    const otherGoal = activeGoal();
    const observedBeforeChange = listGoalPlanContractVersions(goal.id)[0].effectiveAt;
    const ownEvidence = evidence(goal, 'E2', observedBeforeChange);
    const unrelatedEvidence = evidence(otherGoal, 'E2', observedBeforeChange);
    const candidate = createGoalPlanContractChange(goal.id, {
      summary: '提高里程碑标准',
      plan: { milestones: [{ ...goal.milestones[0], successCriteria: '完成同步并回答至少三个现场问题。' }] },
    });
    resolveGoalPlanContractChange(goal.id, candidate.id, { action: 'confirm', confirmed: true });

    const backfilled = recordGoalPlanEvaluation(goal.id, {
      milestoneId: 'meeting', outcome: 'met', summary: '调用方认为旧标准已达到。', evidenceIds: [ownEvidence.id], reasons: ['录音有完整过程。'],
      observedAt: observedBeforeChange, backfill: true,
    });

    expect(backfilled).toMatchObject({
      assessmentSource: 'caller_supplied', status: 'pending_confirmation', contractVersion: { version: 1 },
      ruleSnapshot: { minimumEvidenceLevel: 'E2', milestone: { successCriteria: goal.milestones[0].successCriteria } },
      evidenceGate: { status: 'qualified', qualifiedEvidenceIds: [ownEvidence.id] },
      evidenceSnapshots: [{ id: ownEvidence.id, goalPlanId: goal.id, goalActionId: ownEvidence.goalActionId }],
    });
    expect(confirmGoalPlanEvaluation(goal.id, backfilled.id, { confirmed: true })).toMatchObject({
      assessmentSource: 'caller_supplied', outcome: 'met', status: 'confirmed',
      contractVersion: { version: 1 }, evidenceSnapshots: [{ goalPlanId: goal.id, goalActionId: ownEvidence.goalActionId }],
    });
    expect(getGoalPlan(goal.id)?.lifecycleEvents).toContainEqual(expect.objectContaining({ action: 'progress_confirmed' }));
    expect(() => recordGoalPlanEvaluation(goal.id, {
      milestoneId: 'meeting', outcome: 'met', summary: '调用方认为达标。', evidenceIds: [unrelatedEvidence.id], reasons: [],
    })).toThrow('未明确关联到该目标');
    expect(listGoalPlanEvaluations(goal.id)).toHaveLength(1);
  });

  it('拒绝变更只保留候选记录，不产生新版本或改变有效契约', () => {
    const goal = activeGoal();
    const candidate = createGoalPlanContractChange(goal.id, {
      plan: { successDescription: '改成另一个目标。' },
    });

    const rejected = resolveGoalPlanContractChange(goal.id, candidate.id, { action: 'reject' });

    expect(rejected.status).toBe('rejected');
    expect(getGoalPlan(goal.id)?.successDescription).toBe(goal.successDescription);
    expect(listGoalPlanContractVersions(goal.id)).toHaveLength(1);
  });

  it('重开版本迁移时能为已有活动目标恢复初始契约快照', () => {
    const goal = activeGoal();
    const database = new DatabaseSync(process.env.BUILDYOURSELF_DB!);
    database.prepare('DELETE FROM goal_plan_contract_versions WHERE goal_plan_id=?').run(goal.id);
    database.close();

    expect(listGoalPlanContractVersions(goal.id)).toMatchObject([{ version: 1, plan: { title: goal.title } }]);
  });

  it('API 仅在确认后切换版本，并从评价记录返回固定口径', async () => {
    const goal = activeGoal();
    const context = { params: Promise.resolve({ id: goal.id }) };
    const proposalResponse = await postContractChange(new Request('http://localhost/api/goal-plans/goal-1/contract-changes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'propose', summary: '调整评价门槛', plan: { successDescription: '能主持会议并回答现场问题。' } }),
    }), context);
    const proposalBody = await proposalResponse.json() as { change: { id: string } };
    expect(proposalResponse.status).toBe(201);

    const notConfirmed = await postContractChange(new Request('http://localhost/api/goal-plans/goal-1/contract-changes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm', changeId: proposalBody.change.id, confirmed: false }),
    }), context);
    expect(notConfirmed.status).toBe(400);
    expect((await getContractChanges(new Request('http://localhost/api/goal-plans/goal-1/contract-changes'), context).then(response => response.json())).currentVersion).toBe(1);

    const confirmed = await postContractChange(new Request('http://localhost/api/goal-plans/goal-1/contract-changes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm', changeId: proposalBody.change.id, confirmed: true }),
    }), context);
    expect(confirmed.status).toBe(200);
    expect((await getContractChanges(new Request('http://localhost/api/goal-plans/goal-1/contract-changes'), context).then(response => response.json())).currentVersion).toBe(2);

    const apiEvidence = evidence(goal);
    const recorded = await postEvaluation(new Request('http://localhost/api/goal-plans/goal-1/evaluations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'record', outcome: 'met', summary: '达到当前标准。', milestoneId: 'meeting', evidenceIds: [apiEvidence.id], reasons: [] }),
    }), context);
    const recordedBody = await recorded.json() as { evaluation: { id: string; contractVersion: { version: number }; ruleSnapshot: { successDescription: string | null } } };
    expect(recorded.status).toBe(201);
    expect(recordedBody.evaluation).toMatchObject({ contractVersion: { version: 2 }, status: 'pending_confirmation', ruleSnapshot: { successDescription: '能主持会议并回答现场问题。' } });

    const history = await getEvaluations(new Request('http://localhost/api/goal-plans/goal-1/evaluations'), context);
    expect(await history.json()).toMatchObject({
      evaluations: [{ contractVersion: { version: 2 }, status: 'pending_confirmation', assessmentSource: 'caller_supplied' }],
      evidenceCandidates: [{ id: apiEvidence.id, goalPlanId: goal.id, goalActionId: apiEvidence.goalActionId }],
    });
    const confirmation = await postEvaluation(new Request('http://localhost/api/goal-plans/goal-1/evaluations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm', evaluationId: recordedBody.evaluation.id, confirmed: true }),
    }), context);
    expect(await confirmation.json()).toMatchObject({ evaluation: { contractVersion: { version: 2 }, status: 'confirmed' } });
  });

  it('评价历史 API 对不存在的目标返回 404', async () => {
    const response = await getEvaluations(new Request('http://localhost/api/goal-plans/missing/evaluations'), {
      params: Promise.resolve({ id: randomUUID() }),
    });

    expect(response.status).toBe(404);
  });
});
