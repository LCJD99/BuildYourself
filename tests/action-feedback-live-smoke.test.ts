import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST as createDraft } from '../app/api/v2/goal-drafts/route';
import { POST as confirmGoal } from '../app/api/v2/goal-drafts/[id]/confirm/route';
import { POST as confirmWeeklyPlan } from '../app/api/v2/weekly-plans/[id]/confirm/route';
import { POST as submitFeedback } from '../app/api/v2/action-feedback/route';
import { GET as getFeedback } from '../app/api/v2/action-feedback/[id]/route';
import { GET as getAttributeContributions } from '../app/api/v2/goals/[id]/attributes/[attributeId]/contributions/route';
import { POST as submitUnplannedFeedback } from '../app/api/v2/unplanned-feedback/route';
import { GET as getCalendarDay } from '../app/api/v2/calendar/days/[date]/route';

const liveAgentSmoke = process.env.RUN_PI_AGENT_SMOKE === '1' ? describe : describe.skip;

liveAgentSmoke('真实 PI Agent 计划内行动反馈 HTTP 烟测', () => {
  const directory = mkdtempSync(join(tmpdir(), 'buildyourself-live-action-feedback-'));
  const originalDatabase = process.env.BUILDYOURSELF_DB;
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const dayParams = (date: string) => ({ params: Promise.resolve({ date }) });

  beforeAll(() => { process.env.BUILDYOURSELF_DB = join(directory, `${randomUUID()}.sqlite`); });
  afterAll(() => {
    if (originalDatabase === undefined) delete process.env.BUILDYOURSELF_DB;
    else process.env.BUILDYOURSELF_DB = originalDatabase;
    rmSync(directory, { recursive: true, force: true });
  });

  it('调用真实模型评估已安排行动并保存可追溯贡献', async () => {
    const created = await createDraft(new Request('http://localhost/api/v2/goal-drafts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '我想提升英语表达能力。' }),
    }));
    expect(created.status, JSON.stringify(await created.clone().json())).toBe(201);
    let draft = (await created.json()).draft;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const confirmedGoal = await confirmGoal(new Request(`http://localhost/api/v2/goal-drafts/${draft.id}/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: draft.revision }),
      }), params(draft.id));
      if (confirmedGoal.status === 201) {
        const { goal, weeklyPlanGeneration } = await confirmedGoal.json();
        expect(weeklyPlanGeneration.status, JSON.stringify(weeklyPlanGeneration)).toBe('ready');
        const plan = weeklyPlanGeneration.plan;
        const confirmedPlan = await confirmWeeklyPlan(new Request(`http://localhost/api/v2/weekly-plans/${plan.id}/confirm`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: plan.revision }),
        }), params(plan.id));
        expect(confirmedPlan.status, JSON.stringify(await confirmedPlan.clone().json())).toBe(200);

        const action = plan.actions[0];
        const feedbackResponse = await submitFeedback(new Request('http://localhost/api/v2/action-feedback', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actionId: action.id, idempotencyKey: randomUUID(),
            message: '我按安排完成了这次英语介绍练习，大部分内容都说清楚了，不过回答问题时还需要停顿思考。',
          }),
        }));
        expect(feedbackResponse.status, JSON.stringify(await feedbackResponse.clone().json())).toBe(201);
        const { feedback } = await feedbackResponse.json();
        expect(feedback.actionId).toBe(action.id);
        expect(feedback.assessment.completion).toBeGreaterThan(0);
        expect(feedback.assessment.confidence).toBeGreaterThan(0);
        const reopened = await getFeedback(new Request('http://localhost'), params(feedback.id));
        expect((await reopened.json()).feedback).toEqual(feedback);
        for (const contribution of feedback.contributions) {
          const trace = await getAttributeContributions(new Request('http://localhost'), {
            params: Promise.resolve({ id: goal.id, attributeId: contribution.attributeId }),
          });
          expect(trace.status).toBe(200);
          expect((await trace.json()).contributions).toContainEqual(expect.objectContaining({
            feedbackId: feedback.id, actionId: action.id,
          }));
        }
        return;
      }
      const failure = await confirmedGoal.json();
      expect(confirmedGoal.status).toBe(422);
      expect(failure.issues.length).toBeGreaterThan(0);
      const reply = await (await import('../app/api/v2/goal-drafts/[id]/messages/route')).POST(new Request(`http://localhost/api/v2/goal-drafts/${draft.id}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revision: draft.revision,
          message: '这是已经核对的目标：三个月后能独立进行10分钟英文项目介绍并回答工作常见问题。评价属性为口语表达和回答问题的清晰度。每周练习三次，每次30分钟。约束已确认，没有待澄清问题。',
        }),
      }), params(draft.id));
      expect(reply.status, JSON.stringify(await reply.clone().json())).toBe(200);
      draft = (await reply.json()).draft;
    }
    throw new Error('PI 模型未能生成可确认目标');
  }, 300_000);

  it('调用真实模型评估计划外反馈并按实际发生日期记录', async () => {
    const created = await createDraft(new Request('http://localhost/api/v2/goal-drafts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '我想提升英语表达能力。' }),
    }));
    expect(created.status, JSON.stringify(await created.clone().json())).toBe(201);
    let draft = (await created.json()).draft;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const confirmedGoal = await confirmGoal(new Request(`http://localhost/api/v2/goal-drafts/${draft.id}/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: draft.revision }),
      }), params(draft.id));
      if (confirmedGoal.status === 201) {
        const performedOn = new Date().toISOString().slice(0, 10);
        const response = await submitUnplannedFeedback(new Request('http://localhost/api/v2/unplanned-feedback', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: '今天临时用英语向同事介绍了项目。', performedOn, idempotencyKey: randomUUID() }),
        }));
        expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
        const result = await response.json();
        expect(['action', 'misc']).toContain(result.kind);
        expect(result.feedback.performedOn).toBe(performedOn);
        if (result.kind === 'action') {
          const calendar = await getCalendarDay(new Request('http://localhost'), dayParams(performedOn));
          expect((await calendar.json()).actions).toContainEqual(expect.objectContaining({
            actionId: result.feedback.actionId, source: 'unplanned', scheduledDate: performedOn,
          }));
        }
        return;
      }
      await confirmedGoal.json();
      expect(confirmedGoal.status).toBe(422);
      const reply = await (await import('../app/api/v2/goal-drafts/[id]/messages/route')).POST(new Request(`http://localhost/api/v2/goal-drafts/${draft.id}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: draft.revision, message: '这是已经核对的目标：三个月后能独立进行10分钟英文项目介绍。评价属性为口语表达和回答问题的清晰度。每周练习三次，每次30分钟。约束已确认，没有待澄清问题。' }),
      }), params(draft.id));
      expect(reply.status, JSON.stringify(await reply.clone().json())).toBe(200);
      draft = (await reply.json()).draft;
    }
    throw new Error('PI 模型未能生成可确认目标');
  }, 300_000);
});
