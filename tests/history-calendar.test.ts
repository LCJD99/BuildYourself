import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, saveEvidence } from '../lib/store';
import { activateGoalPlan, listGoalPlanActions, markGoalPlanActionDone, saveGoalPlanDraft, transitionGoalPlan, updateGoalPlanAction } from '../lib/goal-plans';
import { getHistoryCalendar } from '../lib/history-calendar';

const dir = mkdtempSync(join(tmpdir(), 'buildyourself-history-calendar-'));
beforeEach(() => { process.env.BUILDYOURSELF_DB = join(dir, `${randomUUID()}.sqlite`); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function completePlan(title = '英语学习目标') {
  return {
    sourceIntent: '提升工作英语表达', title, domain: 'learning', context: '工作会议',
    successDescription: '能独立主持一次英文同步。', observableResult: '保存一段会议录音并获得导师反馈。',
    baselineStatus: 'known', baselineAction: null,
    milestones: [{ title: '完成基线', stage: 'near', successCriteria: '录制一段三分钟介绍。', standardAssessment: 'reasonable', evidenceAvailability: 'available', reviewNote: '可以保存录音复查。', evidenceRequirement: '录音（E2）' }],
    nextActions: [{ title: '录制英文介绍', details: '准备并录音。', estimateMinutes: 20, specificity: 'concrete' }],
    constraints: { status: 'confirmed', items: [] },
    evidenceRequirements: [{ item: '英文表达', description: '保留录音', minimumLevel: 'E2' }], reviewCycleDays: 7,
  };
}

describe('只读历史日历', () => {
  it('按完成日期展示目标行动，并把确认完成时提交的证据作为标记', () => {
    const draft = saveGoalPlanDraft(completePlan());
    activateGoalPlan(draft.id);
    const action = listGoalPlanActions(draft.id)[0];
    const database = openDatabase();
    try {
      database.prepare("UPDATE goal_plan_actions SET status='done', completed_at=?, updated_at=? WHERE id=?")
        .run('2026-11-04T10:00:00.000Z', '2026-11-08T10:00:00.000Z', action.id);
    } finally {
      database.close();
    }

    transitionGoalPlan(draft.id, {
      action: 'request_completion',
      evidence: [{ requirementId: draft.evidenceRequirements[0].id, description: '导师确认录音表达清晰。', level: 'E3' }],
    });
    transitionGoalPlan(draft.id, { action: 'confirm_completion', confirmed: true });

    const history = getHistoryCalendar();
    expect(history.goals).toContainEqual({ id: draft.id, title: '英语学习目标', status: 'completed' });
    expect(history.days).toContainEqual(expect.objectContaining({
      date: '2026-11-04',
      activities: [expect.objectContaining({ kind: 'action', goalPlanId: draft.id, title: '录制英文介绍' })],
    }));
    const completionDay = history.days.find(day => day.activities.some(activity => activity.kind === 'goal_completed'));
    expect(completionDay?.evidence).toEqual([expect.objectContaining({ level: 'E3', description: '导师确认录音表达清晰。' })]);
  });

  it('只列入活跃或已完成目标，不把待排行动当作实际活动', () => {
    const active = saveGoalPlanDraft(completePlan('进行中的目标'));
    activateGoalPlan(active.id);
    const draft = saveGoalPlanDraft(completePlan('尚未启用的目标'));

    const history = getHistoryCalendar();
    expect(history.goals.map(goal => goal.id)).toContain(active.id);
    expect(history.goals.map(goal => goal.id)).not.toContain(draft.id);
    expect(history.days).toEqual([]);
  });

  it('保存独立完成时间，后续编辑不会把行动移到另一天', () => {
    const draft = saveGoalPlanDraft(completePlan());
    activateGoalPlan(draft.id);
    const action = listGoalPlanActions(draft.id)[0];
    const completed = markGoalPlanActionDone(action.id);
    const edited = updateGoalPlanAction(action.id, { title: '补充行动说明' });

    expect(completed.completedAt).toBeTruthy();
    expect(edited.completedAt).toBe(completed.completedAt);
    const expectedDate = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(completed.completedAt!));
    expect(getHistoryCalendar().days[0].date).toBe(expectedDate);
  });

  it('保留旧的无日期完成记录并明确标记日期不详', () => {
    const draft = saveGoalPlanDraft(completePlan());
    activateGoalPlan(draft.id);
    const action = listGoalPlanActions(draft.id)[0];
    const database = openDatabase();
    try {
      database.exec('ALTER TABLE goal_plan_actions DROP COLUMN completed_at');
      database.prepare("UPDATE goal_plan_actions SET status='done', updated_at=? WHERE id=?")
        .run('2026-11-04T10:00:00.000Z', action.id);
    } finally {
      database.close();
    }

    const history = getHistoryCalendar();
    expect(history.days).toEqual([]);
    expect(history.undatedActivities).toEqual([expect.objectContaining({ title: action.title, goalPlanId: draft.id })]);
  });

  it('显示未归属具体目标的通用任务证据，不把它挂到某个目标', () => {
    const plan = saveGoalPlanDraft(completePlan());
    activateGoalPlan(plan.id);
    saveEvidence({
      text: '一次任务反馈', source: '用户反馈', reference: 'note-1', observedAt: '2026-11-05T10:00:00.000Z',
      links: ['task'], level: 'E2', reportSubmitted: true, benchmarkComplete: null, latencyMs: null,
    });

    const history = getHistoryCalendar();
    expect(history.days.find(day => day.date === '2026-11-05')?.unassignedEvidence).toEqual([
      expect.objectContaining({ text: '一次任务反馈', reference: 'note-1', links: ['task'] }),
    ]);
    expect(history.days.find(day => day.date === '2026-11-05')?.evidence).toEqual([]);
  });
});
