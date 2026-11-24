import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST as createDraft } from '../app/api/v2/goal-drafts/route';
import { POST as sendGoalMessage } from '../app/api/v2/goal-drafts/[id]/messages/route';
import { POST as confirmGoal } from '../app/api/v2/goal-drafts/[id]/confirm/route';
import { POST as confirmWeeklyPlan } from '../app/api/v2/weekly-plans/[id]/confirm/route';
import { POST as createReview } from '../app/api/v2/weekly-reviews/route';
import { POST as editReview } from '../app/api/v2/weekly-reviews/[weekStart]/messages/route';
import { POST as confirmReview } from '../app/api/v2/weekly-reviews/[weekStart]/confirm/route';
import { GET as readReview } from '../app/api/v2/weekly-reviews/[weekStart]/route';

const live = process.env.RUN_PI_AGENT_SMOKE === '1' ? describe : describe.skip;

live('真实 PI Agent 周复盘 HTTP 烟测', () => {
  const directory = mkdtempSync(join(tmpdir(), 'buildyourself-weekly-review-live-'));
  const previousDatabase = process.env.BUILDYOURSELF_DB;
  const context = (weekStart: string) => ({ params: Promise.resolve({ weekStart }) });
  const planContext = (id: string) => ({ params: Promise.resolve({ id }) });

  beforeAll(() => { process.env.BUILDYOURSELF_DB = join(directory, `${randomUUID()}.sqlite`); });
  afterAll(() => {
    if (previousDatabase === undefined) delete process.env.BUILDYOURSELF_DB;
    else process.env.BUILDYOURSELF_DB = previousDatabase;
    rmSync(directory, { recursive: true, force: true });
  });

  it('真实模型总结本周、结合两类意见生成和调整下周规划，再确认并回读', async () => {
    const created = await createDraft(new Request('http://localhost/api/v2/goal-drafts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '我想提高英语口语，三个月内能独立做10分钟英文项目介绍并回答常见问题。每周练习3次，每次30分钟。期限与时间约束均已确认，没有其他限制。希望分别提升口语表达和听力理解。' }),
    }));
    expect(created.status, JSON.stringify(await created.clone().json())).toBe(201);
    let draft = (await created.json()).draft;
    let enabled: { goal: { id: string }; weeklyPlanGeneration: { plan: { id: string; revision: number; actions: unknown[]; weekStart: string } } } | null = null;
    for (let attempt = 0; attempt < 3 && !enabled; attempt += 1) {
      const response = await confirmGoal(new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: draft.revision }) }), planContext(draft.id));
      if (response.status === 201) enabled = await response.json();
      else {
        expect(response.status, JSON.stringify(await response.clone().json())).toBe(422);
        let updated = await sendGoalMessage(new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: draft.revision,
          message: '确认目标：三个月内能独立做10分钟英文项目介绍并回答常见问题；每周练习3次，每次30分钟。请严格按此 JSON 结构填写约束：{"status":"confirmed","items":["3个月内完成","每周练习3次，每次30分钟"]}，不要返回对象或空字符串作为 items。评价属性为口语表达、听力理解，没有其他待澄清项。' }) }), planContext(draft.id));
        if (updated.status === 502) {
          updated = await sendGoalMessage(new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: draft.revision,
            message: '只修正 JSON 结构错误。constraints 必须为 {"status":"confirmed","items":["每周练习3次，每次30分钟"]}，items 中每项必须是非空字符串。其他目标信息保持原样。' }) }), planContext(draft.id));
        }
        expect(updated.status, JSON.stringify(await updated.clone().json())).toBe(200);
        draft = (await updated.json()).draft;
      }
    }
    expect(enabled).not.toBeNull();
    const firstPlan = enabled!.weeklyPlanGeneration.plan;
    expect(firstPlan.actions.length).toBeGreaterThan(0);
    const confirmedFirst = await confirmWeeklyPlan(new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: firstPlan.revision }) }), planContext(firstPlan.id));
    expect(confirmedFirst.status, JSON.stringify(await confirmedFirst.clone().json())).toBe(200);

    const reviewResponse = await createReview(new Request('http://localhost/api/v2/weekly-reviews', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weekStart: firstPlan.weekStart,
        weekFeedback: '总结完成的实际工作，并指出进度不足之处。', nextWeekFeedback: '下周继续练习，安排在周二和周四。' }),
    }));
    expect(reviewResponse.status, JSON.stringify(await reviewResponse.clone().json())).toBe(201);
    const review = await reviewResponse.json();
    expect(review.review.summary).toBeTypeOf('string');
    const nextPlan = review.nextWeekPlan.plan;
    expect(nextPlan.actions.length).toBeGreaterThan(0);
    const editedResponse = await editReview(new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: nextPlan.revision, message: '请把周二那项简化为10分钟口头练习，并保留其他行动。' }) }), context(firstPlan.weekStart));
    expect(editedResponse.status, JSON.stringify(await editedResponse.clone().json())).toBe(200);
    const edited = (await editedResponse.json()).plan;
    const confirmed = await confirmReview(new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: edited.revision }) }), context(firstPlan.weekStart));
    expect(confirmed.status, JSON.stringify(await confirmed.clone().json())).toBe(200);
    const reopened = await readReview(new Request('http://localhost'), context(firstPlan.weekStart));
    expect((await reopened.json()).review).toMatchObject({ summary: review.review.summary, weekFeedback: '总结完成的实际工作，并指出进度不足之处。', nextWeekFeedback: '下周继续练习，安排在周二和周四。' });
  }, 300_000);
});
