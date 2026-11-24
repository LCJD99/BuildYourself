import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST as createDraft } from '../app/api/v2/goal-drafts/route';
import { POST as confirmDraft } from '../app/api/v2/goal-drafts/[id]/confirm/route';
import { POST as confirmWeeklyPlan } from '../app/api/v2/weekly-plans/[id]/confirm/route';
import { POST as editWeeklyPlan } from '../app/api/v2/weekly-plans/[id]/messages/route';
import { GET as getCalendarMonth } from '../app/api/v2/calendar/months/[month]/route';
import { GET as getCalendarDay } from '../app/api/v2/calendar/days/[date]/route';

const { proposeGoalDraft, proposeWeeklyPlan } = vi.hoisted(() => ({
  proposeGoalDraft: vi.fn(),
  proposeWeeklyPlan: vi.fn(),
}));
vi.mock('../lib/goal-draft-agent', () => ({ proposeGoalDraft }));
vi.mock('../lib/weekly-plan-agent', () => ({ proposeWeeklyPlan }));

const directory = mkdtempSync(join(tmpdir(), 'buildyourself-v2-calendar-'));
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const goalProposal = {
  title: '推进长期目标',
  description: '每周持续练习并回看结果。',
  constraints: { status: 'confirmed', items: [] },
  attributes: [{ name: '持续练习', description: '按周推进安排' }],
  clarifyingQuestions: [],
};

beforeEach(() => {
  vi.useFakeTimers();
  // 2026-04-30 17:00 UTC is May 1 in Shanghai; the active week starts on Apr 27.
  vi.setSystemTime(new Date('2026-04-30T17:00:00.000Z'));
  process.env.BUILDYOURSELF_DB = join(directory, `${randomUUID()}.sqlite`);
  proposeGoalDraft.mockReset().mockResolvedValue({ reply: '已整理目标。', draft: goalProposal });
  proposeWeeklyPlan.mockReset().mockImplementation(async ({ goals, currentPlan, message }: {
    goals: Array<{ id: string; attributes: Array<{ id: string }> }>;
    currentPlan: { actions: Array<{ id: string; title: string; description: string; date: string }> } | null;
    message?: string;
  }) => ({
    reply: '已生成本周行动安排。',
    actions: currentPlan ? currentPlan.actions.map((action, index) => ({
      ...action,
      operation: 'update' as const,
      date: message && index === 0 ? '2026-05-02' : action.date,
      goalIds: goals.map(goal => goal.id),
      attributeIds: goals.flatMap(goal => goal.attributes.map(attribute => attribute.id)),
    })) : [
      {
        operation: 'add' as const,
        title: '完成当周练习', description: '完成一轮目标相关练习。', date: '2026-04-30',
        goalIds: goals.map(goal => goal.id), attributeIds: goals.flatMap(goal => goal.attributes.map(attribute => attribute.id)),
      },
      {
        operation: 'add' as const,
        title: '记录练习结果', description: '整理当周练习结果。', date: '2026-05-01',
        goalIds: goals.map(goal => goal.id), attributeIds: goals.flatMap(goal => goal.attributes.map(attribute => attribute.id)),
      },
    ],
  }));
});
afterEach(() => vi.useRealTimers());
afterAll(() => rmSync(directory, { recursive: true, force: true }));

async function enableGoal() {
  const created = await createDraft(new Request('http://localhost/api/v2/goal-drafts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '我想培养稳定的练习习惯' }),
  }));
  const { draft } = await created.json();
  const enabled = await confirmDraft(new Request(`http://localhost/api/v2/goal-drafts/${draft.id}/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: draft.revision }),
  }), params({ id: draft.id }));
  return enabled.json() as Promise<{ goal: { id: string }; weeklyPlanGeneration: { plan: { id: string; revision: number; actions: Array<{ id: string }> } } }>;
}

async function confirmPlan(id: string, revision: number) {
  return confirmWeeklyPlan(new Request(`http://localhost/api/v2/weekly-plans/${id}/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision }),
  }), params({ id }));
}

describe('v0.2 月历与每日安排 HTTP API', () => {
  it('月标记和单日查询只显示当前已确认版本，并在确认新版本后同步切换', async () => {
    const { weeklyPlanGeneration } = await enableGoal();
    const draft = weeklyPlanGeneration.plan;
    const aprilDraft = await getCalendarMonth(new Request('http://localhost/api/v2/calendar/months/2026-04?timeZone=Asia%2FShanghai'), params({ month: '2026-04' }));
    const mayDraft = await getCalendarMonth(new Request('http://localhost/api/v2/calendar/months/2026-05?timeZone=Asia%2FShanghai'), params({ month: '2026-05' }));
    expect(aprilDraft.status).toBe(200);
    expect((await aprilDraft.json()).dates).toEqual([]);
    expect((await mayDraft.json()).dates).toEqual([]);

    expect((await confirmPlan(draft.id, draft.revision)).status).toBe(200);
    const april = await getCalendarMonth(new Request('http://localhost/api/v2/calendar/months/2026-04?timeZone=Asia%2FShanghai'), params({ month: '2026-04' }));
    const may = await getCalendarMonth(new Request('http://localhost/api/v2/calendar/months/2026-05?timeZone=Asia%2FShanghai'), params({ month: '2026-05' }));
    expect((await april.json()).dates).toEqual(['2026-04-30']);
    expect((await may.json()).dates).toEqual(['2026-05-01']);

    const aprilDay = await getCalendarDay(new Request('http://localhost/api/v2/calendar/days/2026-04-30?timeZone=Asia%2FShanghai'), params({ date: '2026-04-30' }));
    expect((await aprilDay.json()).actions).toMatchObject([{ scheduledDate: '2026-04-30', source: 'planned', completionFraction: null }]);
    const emptyDay = await getCalendarDay(new Request('http://localhost/api/v2/calendar/days/2026-04-29?timeZone=Asia%2FShanghai'), params({ date: '2026-04-29' }));
    expect((await emptyDay.json()).actions).toEqual([]);

    const edited = await editWeeklyPlan(new Request(`http://localhost/api/v2/weekly-plans/${draft.id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: draft.revision, message: '把第一项改到周六' }),
    }), params({ id: draft.id }));
    const { plan: revised } = await edited.json();
    const beforeConfirm = await getCalendarMonth(new Request('http://localhost/api/v2/calendar/months/2026-05?timeZone=Asia%2FShanghai'), params({ month: '2026-05' }));
    expect((await beforeConfirm.json()).dates).toEqual(['2026-05-01']);
    const notYetVisibleDay = await getCalendarDay(new Request('http://localhost/api/v2/calendar/days/2026-05-02?timeZone=Asia%2FShanghai'), params({ date: '2026-05-02' }));
    expect((await notYetVisibleDay.json()).actions).toEqual([]);

    expect((await confirmPlan(draft.id, revised.revision)).status).toBe(200);
    const afterConfirm = await getCalendarMonth(new Request('http://localhost/api/v2/calendar/months/2026-05?timeZone=Asia%2FShanghai'), params({ month: '2026-05' }));
    expect((await afterConfirm.json()).dates).toEqual(['2026-05-01', '2026-05-02']);
  });

  it('跨目标共享的行动在单日中只出现一次，并保留两个目标的属性关联', async () => {
    const first = await enableGoal();
    const second = await enableGoal();
    const plan = second.weeklyPlanGeneration.plan;
    expect((await confirmPlan(plan.id, plan.revision)).status).toBe(200);

    const day = await getCalendarDay(new Request('http://localhost/api/v2/calendar/days/2026-04-30?timeZone=Asia%2FShanghai'), params({ date: '2026-04-30' }));
    expect(day.status).toBe(200);
    const { actions } = await day.json();
    expect(actions).toHaveLength(1);
    expect(actions[0].actionId).toBeTruthy();
    expect(actions[0].goals.map((goal: { id: string }) => goal.id).sort()).toEqual([first.goal.id, second.goal.id].sort());
    expect(actions[0].goals.every((goal: { attributes: unknown[] }) => goal.attributes.length > 0)).toBe(true);
  });

  it('拒绝无效日期、月份和时区', async () => {
    const invalidDate = await getCalendarDay(new Request('http://localhost/api/v2/calendar/days/2026-02-30'), params({ date: '2026-02-30' }));
    const invalidMonth = await getCalendarMonth(new Request('http://localhost/api/v2/calendar/months/2026-13'), params({ month: '2026-13' }));
    const invalidZone = await getCalendarDay(new Request('http://localhost/api/v2/calendar/days/2026-04-30?timeZone=Not%2FAZone'), params({ date: '2026-04-30' }));
    expect(invalidDate.status).toBe(400);
    expect(invalidMonth.status).toBe(400);
    expect(invalidZone.status).toBe(400);
  });
});
