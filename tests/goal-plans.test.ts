import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  activateGoalPlan,
  listGoalPlans,
  listPendingGoalActions,
  saveGoalPlanDraft,
  transitionGoalPlan,
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

  it('暂停目标会保留历史待办并退出待排池，恢复时重新占用活跃名额', () => {
    const draft = saveGoalPlanDraft(completePlan());
    activateGoalPlan(draft.id);

    const paused = transitionGoalPlan(draft.id, { action: 'pause', reason: '本周优先处理项目交付' });

    expect(paused.status).toBe('paused');
    expect(paused.lifecycleReason).toBe('本周优先处理项目交付');
    expect(listPendingGoalActions()).toEqual([]);
    expect(paused.lifecycleEvents.map(event => event.action)).toEqual(['created', 'activated', 'paused']);

    expect(transitionGoalPlan(draft.id, { action: 'resume' }).status).toBe('active');
    expect(listPendingGoalActions()).toHaveLength(1);
  });

  it('归档与放弃都要求原因并留下可回查的终态记录', () => {
    const archived = saveGoalPlanDraft(completePlan());
    const abandoned = saveGoalPlanDraft(completePlan({ title: '放弃目标' }));
    activateGoalPlan(archived.id);
    activateGoalPlan(abandoned.id);

    expect(() => transitionGoalPlan(archived.id, { action: 'archive', reason: '  ' })).toThrow('请填写归档原因');
    expect(transitionGoalPlan(archived.id, { action: 'archive', reason: '目标方向已变化' })).toMatchObject({
      status: 'archived', lifecycleReason: '目标方向已变化',
    });
    expect(transitionGoalPlan(abandoned.id, { action: 'abandon', reason: '目前不再投入时间' })).toMatchObject({
      status: 'abandoned', lifecycleReason: '目前不再投入时间',
    });
    expect(listGoalPlans().find(plan => plan.id === archived.id)?.lifecycleEvents.at(-1)).toMatchObject({
      action: 'archived', reason: '目标方向已变化', fromStatus: 'active', toStatus: 'archived',
    });
  });

  it('完成请求必须满足每项证据等级并等待单独确认', () => {
    const draft = saveGoalPlanDraft(completePlan());
    activateGoalPlan(draft.id);
    const requirement = draft.evidenceRequirements[0];
    const evidence = [{ requirementId: requirement.id, description: '录音文件：baseline.mp3', level: 'E2' }];

    expect(() => transitionGoalPlan(draft.id, { action: 'request_completion', evidence: [] })).toThrow('每项证据要求都需要提交证据');
    expect(() => transitionGoalPlan(draft.id, {
      action: 'request_completion',
      evidence: [{ ...evidence[0], level: 'E1' }],
    })).toThrow('证据等级未达到要求');

    const requested = transitionGoalPlan(draft.id, { action: 'request_completion', evidence });
    expect(requested.status).toBe('active');
    expect(requested.pendingCompletion).toMatchObject({ evidence });
    expect(requested.lifecycleEvents.at(-1)?.action).toBe('completion_requested');

    expect(() => transitionGoalPlan(draft.id, { action: 'confirm_completion' })).toThrow('需要单独确认完成');
    const completed = transitionGoalPlan(draft.id, { action: 'confirm_completion', confirmed: true });
    expect(completed).toMatchObject({ status: 'completed', completedAt: expect.any(String), pendingCompletion: null });
    expect(completed.lifecycleEvents.at(-1)).toMatchObject({ action: 'completion_confirmed', fromStatus: 'active', toStatus: 'completed' });
  });

  it('暂停后释放的名额可被新目标占用，满额时不能恢复旧目标', () => {
    const plans = Array.from({ length: 10 }, (_, index) => saveGoalPlanDraft(completePlan({ title: `目标 ${index + 1}` })));
    plans.forEach(plan => activateGoalPlan(plan.id));
    transitionGoalPlan(plans[0].id, { action: 'pause' });
    const replacement = saveGoalPlanDraft(completePlan({ title: '替补目标' }));
    activateGoalPlan(replacement.id);

    expect(() => transitionGoalPlan(plans[0].id, { action: 'resume' })).toThrow('活跃目标已达到 10 个');
    expect(listPendingGoalActions()).toHaveLength(10);
  });

  it('升级已有两态数据库时保留目标、待排行动和迁移状态记录', () => {
    const databasePath = join(dir, `legacy-${randomUUID()}.sqlite`);
    process.env.BUILDYOURSELF_DB = databasePath;
    const database = new DatabaseSync(databasePath);
    database.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE goal_plans (
        id TEXT PRIMARY KEY, source_intent TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('draft', 'active')),
        plan_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, activated_at TEXT
      );
      CREATE TABLE goal_plan_actions (
        id TEXT PRIMARY KEY, goal_plan_id TEXT NOT NULL REFERENCES goal_plans(id) ON DELETE CASCADE,
        title TEXT NOT NULL, details TEXT, estimate_minutes INTEGER,
        status TEXT NOT NULL CHECK (status IN ('pending_schedule', 'scheduled', 'done')), created_at TEXT NOT NULL
      );
    `);
    const now = new Date().toISOString();
    database.prepare('INSERT INTO goal_plans VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('legacy-goal', '我想学英语', 'active', JSON.stringify(completePlan()), now, now, now);
    database.prepare('INSERT INTO goal_plan_actions VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('legacy-action', 'legacy-goal', '继续练习', null, 15, 'pending_schedule', now);
    database.close();

    const plans = listGoalPlans();

    expect(plans[0]).toMatchObject({ status: 'active', completedAt: null, lifecycleReason: null });
    expect(plans[0].lifecycleEvents).toMatchObject([{ action: 'imported', toStatus: 'active' }]);
    expect(listPendingGoalActions()).toMatchObject([{ id: 'legacy-action', goalPlanId: 'legacy-goal' }]);
  });
});
