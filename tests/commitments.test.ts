import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET, POST } from '../app/api/commitments/route';
import { listExternalCommitments, saveExternalCommitment } from '../lib/commitments';
import { activateGoalPlan, listGoalPlanActions, listGoalPlans, saveGoalPlanDraft } from '../lib/goal-plans';

const dir = mkdtempSync(join(tmpdir(), 'buildyourself-commitments-'));
beforeEach(() => { process.env.BUILDYOURSELF_DB = join(dir, `${randomUUID()}.sqlite`); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function activeGoal(title = '英语表达目标') {
  const draft = saveGoalPlanDraft({
    sourceIntent: `我想完成${title}`,
    title,
    domain: 'learning',
    context: '工作会议',
    successDescription: '能独立主持一次英文同步。',
    observableResult: '保存会议录音并获得导师反馈。',
    baselineStatus: 'known',
    constraints: { status: 'confirmed', items: [] },
    milestones: [{
      title: '完成基线', stage: 'near', successCriteria: '录制一段介绍。',
      standardAssessment: 'reasonable', evidenceAvailability: 'available',
      reviewNote: '可以保存录音复查。', evidenceRequirement: '录音（E2）',
    }],
    nextActions: [{ title: '录制英文介绍', estimateMinutes: 20, specificity: 'concrete' }],
    evidenceRequirements: [{ item: '英文表达', description: '保留录音', minimumLevel: 'E2' }],
    reviewCycleDays: 7,
  });
  activateGoalPlan(draft.id);
  return draft.id;
}

function commitmentInput(goalPlanId: string | null = null) {
  return {
    sourceText: '英语老师通知：周三前提交展示大纲，周五前提交最终录音。',
    deliverable: '英语展示作业',
    deadline: null,
    goalPlanId,
    tasks: [
      { title: '提交展示大纲', deadline: '2026-11-11', estimateMinutes: 30, dependencies: [], acceptanceCriteria: '提交一页大纲。' },
      { title: '提交最终录音', deadline: '2026-11-13', estimateMinutes: 60, dependencies: ['提交展示大纲'], acceptanceCriteria: '提交完整录音。' },
    ],
    uncertainFields: [{ field: 'estimateMinutes', taskIndex: 1, reason: '录音修改次数尚不确定。' }],
  };
}

describe('外部承诺确认与保存', () => {
  it('确认后保存完整字段、多个截止和目标归属，但不修改原计划', () => {
    const goalPlanId = activeGoal();
    const originalActions = listGoalPlanActions(goalPlanId);

    const saved = saveExternalCommitment(commitmentInput(goalPlanId));

    expect(saved).toMatchObject({
      sourceText: '英语老师通知：周三前提交展示大纲，周五前提交最终录音。',
      deliverable: '英语展示作业',
      goalPlanId,
      goalTitle: '英语表达目标',
      deadline: null,
      status: 'pending_schedule',
      tasks: [
        { title: '提交展示大纲', deadline: '2026-11-11', estimateMinutes: 30 },
        { title: '提交最终录音', deadline: '2026-11-13', estimateMinutes: 60, dependencies: ['提交展示大纲'] },
      ],
      uncertainFields: [{ field: 'estimateMinutes', taskIndex: 1, reason: '录音修改次数尚不确定。' }],
    });
    expect(listExternalCommitments()).toEqual([saved]);
    expect(listGoalPlanActions(goalPlanId)).toEqual(originalActions);
  });

  it('将未归属目标的承诺保存到杂项，不创建目标或目标进度', () => {
    const goalPlanId = activeGoal();
    const activeGoalCount = listGoalPlans().filter(goal => goal.status === 'active').length;
    const saved = saveExternalCommitment(commitmentInput());

    expect(saved.goalPlanId).toBeNull();
    expect(saved.goalTitle).toBeNull();
    expect(saved.status).toBe('pending_schedule');
    expect(listGoalPlans().filter(goal => goal.status === 'active')).toHaveLength(activeGoalCount);
    expect(listGoalPlanActions(goalPlanId)).toHaveLength(1);
  });

  it('拒绝无效截止、耗时、空任务以及非活跃目标归属', () => {
    expect(() => saveExternalCommitment({ ...commitmentInput(), deadline: '2026-02-30' })).toThrow('截止日期');
    expect(() => saveExternalCommitment({
      ...commitmentInput(),
      tasks: [{ title: '提交', deadline: null, estimateMinutes: 0, dependencies: [], acceptanceCriteria: null }],
    })).toThrow('预计耗时');
    expect(() => saveExternalCommitment({
      ...commitmentInput(),
      tasks: [{ title: '提交', deadline: null, estimateMinutes: null, dependencies: [], acceptanceCriteria: null }],
      uncertainFields: [],
    })).toThrow('标记为不确定字段');
    expect(() => saveExternalCommitment({ ...commitmentInput(), tasks: [] })).toThrow('至少需要一项任务');
    const draft = saveGoalPlanDraft({ sourceIntent: '未启用目标', title: '草稿目标' });
    expect(() => saveExternalCommitment(commitmentInput(draft.id))).toThrow('活跃目标');
    const missingOwner = commitmentInput();
    delete (missingOwner as Partial<typeof missingOwner>).goalPlanId;
    expect(() => saveExternalCommitment(missingOwner)).toThrow('明确核对目标归属');
    expect(listExternalCommitments()).toEqual([]);
  });

  it('API 仅接受明确确认后的候选，并在读取时提供活跃目标和待排状态', async () => {
    const unconfirmed = await POST(new Request('http://localhost/api/commitments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...commitmentInput(), confirmed: false }),
    }));
    expect(unconfirmed.status).toBe(400);
    expect(listExternalCommitments()).toEqual([]);

    const goalPlanId = activeGoal();
    const confirmed = await POST(new Request('http://localhost/api/commitments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...commitmentInput(goalPlanId), confirmed: true }),
    }));
    expect(confirmed.status).toBe(201);

    const response = await GET();
    const data = await response.json();
    expect(data.commitments).toMatchObject([{ status: 'pending_schedule', goalPlanId }]);
    expect(data.goals).toContainEqual({ id: goalPlanId, title: '英语表达目标' });
  });
});
