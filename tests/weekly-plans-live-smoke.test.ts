import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST as createDraft } from '../app/api/v2/goal-drafts/route';
import { POST as sendGoalMessage } from '../app/api/v2/goal-drafts/[id]/messages/route';
import { POST as confirmGoal } from '../app/api/v2/goal-drafts/[id]/confirm/route';
import { POST as editWeeklyPlan } from '../app/api/v2/weekly-plans/[id]/messages/route';
import { POST as confirmWeeklyPlan } from '../app/api/v2/weekly-plans/[id]/confirm/route';
import { GET as getWeeklyPlan } from '../app/api/v2/weekly-plans/[id]/route';

const liveAgentSmoke = process.env.RUN_PI_AGENT_SMOKE === '1' ? describe : describe.skip;

liveAgentSmoke('真实 PI Agent 首周规划 HTTP 烟测', () => {
  const directory = mkdtempSync(join(tmpdir(), 'buildyourself-live-weekly-plan-'));
  const originalDatabase = process.env.BUILDYOURSELF_DB;
  const context = (id: string) => ({ params: Promise.resolve({ id }) });

  beforeAll(() => { process.env.BUILDYOURSELF_DB = join(directory, `${randomUUID()}.sqlite`); });
  afterAll(() => {
    if (originalDatabase === undefined) delete process.env.BUILDYOURSELF_DB;
    else process.env.BUILDYOURSELF_DB = originalDatabase;
    rmSync(directory, { recursive: true, force: true });
  });

  it('通过真实模型生成、自然语言修改、确认并重新打开本周规划', async () => {
    const created = await createDraft(new Request('http://localhost/api/v2/goal-drafts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '我想在三个月内能用英语独立介绍一个软件项目，并回答同事的常见问题；每周练习三次，每次三十分钟。请整理可观察结果、时间约束和口语表达、听力理解两个评价属性。' }),
    }));
    expect(created.status, JSON.stringify(await created.clone().json())).toBe(201);
    let draft = (await created.json()).draft;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const confirmation = await confirmGoal(new Request(`http://localhost/api/v2/goal-drafts/${draft.id}/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: draft.revision }),
      }), context(draft.id));
      if (confirmation.status === 201) {
        const enabled = await confirmation.json();
        expect(enabled.weeklyPlanGeneration.status, JSON.stringify(enabled.weeklyPlanGeneration)).toBe('ready');
        const first = enabled.weeklyPlanGeneration.plan;
        expect(first.actions.length).toBeGreaterThan(0);

        const edit = await editWeeklyPlan(new Request(`http://localhost/api/v2/weekly-plans/${first.id}/messages`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision: first.revision, message: '请将其中一个行动改到这周的星期三，其他目标关联和属性保持不变。' }),
        }), context(first.id));
        expect(edit.status, JSON.stringify(await edit.clone().json())).toBe(200);
        const revised = (await edit.json()).plan;
        const confirmed = await confirmWeeklyPlan(new Request(`http://localhost/api/v2/weekly-plans/${first.id}/confirm`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: revised.revision }),
        }), context(first.id));
        expect(confirmed.status, JSON.stringify(await confirmed.clone().json())).toBe(200);
        const reopened = await getWeeklyPlan(new Request('http://localhost'), context(first.id));
        expect((await reopened.json()).versions).toHaveLength(2);
        return;
      }
      const failed = await confirmation.json();
      expect(confirmation.status).toBe(422);
      expect(failed.issues.length).toBeGreaterThan(0);
      const update = await sendGoalMessage(new Request(`http://localhost/api/v2/goal-drafts/${draft.id}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: draft.revision, message: '请根据我刚才给出的结果、期限、练习安排和两个属性补全草稿，并清空已经回答的待澄清问题。' }),
      }), context(draft.id));
      expect(update.status, JSON.stringify(await update.clone().json())).toBe(200);
      draft = (await update.json()).draft;
    }
    throw new Error('PI 模型未能生成可确认的目标草稿。');
  }, 300_000);
});
