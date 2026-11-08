import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  activateGoalPlan,
  listGoalPlans,
  listPendingGoalActions,
  saveGoalPlanDraft,
  updateGoalPlanDraft,
} from '../lib/goal-plans';

const dir = mkdtempSync(join(tmpdir(), 'buildyourself-goal-plans-'));
beforeEach(() => { process.env.BUILDYOURSELF_DB = join(dir, `${randomUUID()}.sqlite`); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function completePlan(overrides: Record<string, unknown> = {}) {
  return {
    sourceIntent: '我想学英语',
    title: '能用英语完成工作场景沟通',
    domain: 'learning',
    context: '工作会议和跨团队协作',
    successDescription: '能独立主持一次 10 分钟的英文项目同步。',
    observableResult: '录制一次完整英文同步，并由英语导师按清晰度和互动能力给出反馈。',
    baselineStatus: 'to_measure',
    baselineAction: '录制一段 3 分钟的英文项目介绍，记录停顿和表达困难。',
    milestones: [
      {
        title: '完成当前水平基线',
        stage: 'near',
        successCriteria: '完成一段 3 分钟的英文项目介绍。',
        standardAssessment: 'reasonable',
        evidenceAvailability: 'available',
        reviewNote: '录音可以保存并复听。',
        evidenceRequirement: '一段完整录音（E2）。',
      },
      {
        title: '独立主持英文项目同步',
        stage: 'future',
        successCriteria: '可在真实会议中说明进度并回答问题。',
        standardAssessment: 'provisional',
        evidenceAvailability: 'future',
        reviewNote: '先保留阶段方向，拿到基线和导师反馈后细化。',
        evidenceRequirement: '会议录音或导师反馈。',
      },
    ],
    nextActions: [
      { title: '录制 3 分钟英文项目介绍', details: '选一个熟悉项目，连续介绍背景、进度和下一步。', estimateMinutes: 20, specificity: 'concrete' },
    ],
    constraints: { status: 'confirmed', items: ['工作日晚上最多安排 30 分钟'] },
    evidenceRequirements: [
      { item: '英文口语基线', description: '保存完整录音，之后可以按同一标准复听比较。', minimumLevel: 'E2' },
    ],
    reviewCycleDays: 7,
    ...overrides,
  };
}

describe('目标计划草稿与激活', () => {
  it('允许保存不完整草稿，但不生成待排行动', () => {
    const saved = saveGoalPlanDraft({
      sourceIntent: '我想学英语',
      title: '学习英语',
      baselineStatus: 'unknown',
      constraints: { status: 'needs_clarification', items: [] },
    });

    expect(saved.status).toBe('draft');
    expect(saved.validation.ready).toBe(false);
    expect(saved.validation.issues).toContain('需要写明可观察的结果或能力表现。');
    expect(listPendingGoalActions()).toEqual([]);
    expect(listGoalPlans()).toHaveLength(1);
  });

  it('用户确认完整计划后激活目标，并把近期行动放入待排池', () => {
    const draft = saveGoalPlanDraft(completePlan());
    expect(draft.validation.ready).toBe(true);
    expect(listPendingGoalActions()).toEqual([]);

    const activated = activateGoalPlan(draft.id);

    expect(activated.status).toBe('active');
    expect(activated.activatedAt).toBeTruthy();
    expect(listPendingGoalActions()).toMatchObject([
      {
        goalPlanId: draft.id,
        goalTitle: '能用英语完成工作场景沟通',
        title: '录制 3 分钟英文项目介绍',
        status: 'pending_schedule',
        estimateMinutes: 20,
      },
    ]);
    expect(listGoalPlans()[0].status).toBe('active');
  });

  it('编辑草稿时保留未改动的契约字段', () => {
    const draft = saveGoalPlanDraft(completePlan());
    const updated = updateGoalPlanDraft(draft.id, { title: '能主持英文项目同步' });

    expect(updated.title).toBe('能主持英文项目同步');
    expect(updated.successDescription).toBe('能独立主持一次 10 分钟的英文项目同步。');
    expect(updated.milestones).toHaveLength(2);
    expect(updated.nextActions[0].title).toBe('录制 3 分钟英文项目介绍');
    expect(updated.validation.ready).toBe(true);
  });

  it('拒绝激活契约不完整的草稿，并保持它退出自动规划', () => {
    const draft = saveGoalPlanDraft(completePlan({ observableResult: '', baselineAction: '' }));

    expect(() => activateGoalPlan(draft.id)).toThrow('目标契约尚未通过校验');
    expect(listGoalPlans()[0].status).toBe('draft');
    expect(listPendingGoalActions()).toEqual([]);
  });

  it('允许保留尚待细化的远期里程碑，但拒绝未核对的近期标准', () => {
    const draft = saveGoalPlanDraft(completePlan({
      milestones: [
        ...completePlan().milestones.slice(0, 1),
        { ...completePlan().milestones[1], standardAssessment: 'needs_revision' },
      ],
    }));
    expect(draft.validation.ready).toBe(false);
    expect(draft.validation.issues).toContain('里程碑「独立主持英文项目同步」仍需调整标准。');

    const futureOnlyDraft = saveGoalPlanDraft(completePlan({
      milestones: [completePlan().milestones[1]],
    }));
    expect(futureOnlyDraft.validation.ready).toBe(true);
  });

  it('需要基线时必须提供一次可执行的基线行动', () => {
    const draft = saveGoalPlanDraft(completePlan({ baselineAction: '' }));
    expect(draft.validation.issues).toContain('当前水平未知，需要提出一次可执行的基线行动。');
  });

  it('证据要求必须说明最低等级，远期里程碑必须说明评估理由', () => {
    const input = completePlan({
      evidenceRequirements: [{ item: '口语基线', description: '保存一段完整录音。' }],
      milestones: [{ ...completePlan().milestones[1], reviewNote: '' }],
    });
    const draft = saveGoalPlanDraft(input);

    expect(draft.validation.issues).toContain('需要至少一项写明对象、内容和最低等级的证据要求。');
    expect(draft.validation.issues).toContain('远期里程碑「独立主持英文项目同步」需要说明评估结果或暂缓细化的理由。');

    const ungroundedFuture = saveGoalPlanDraft(completePlan({
      milestones: [{ ...completePlan().milestones[1], successCriteria: '', standardAssessment: 'reasonable' }],
    }));
    expect(ungroundedFuture.validation.issues).toContain('远期里程碑「独立主持英文项目同步」标为合理时需要填写可核对标准。');
  });

  it('达到 10 个活跃目标后拒绝新增启用，但保留草稿', () => {
    for (let index = 0; index < 10; index += 1) {
      const draft = saveGoalPlanDraft(completePlan({ title: `目标 ${index + 1}` }));
      activateGoalPlan(draft.id);
    }
    const extra = saveGoalPlanDraft(completePlan({ title: '第十一个目标' }));

    expect(() => activateGoalPlan(extra.id)).toThrow('活跃目标已达到 10 个');
    expect(listGoalPlans().find(plan => plan.id === extra.id)?.status).toBe('draft');
    expect(listPendingGoalActions()).toHaveLength(10);
  });
});
