import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST as createDraft } from '../app/api/v2/goal-drafts/route';
import { POST as sendMessage } from '../app/api/v2/goal-drafts/[id]/messages/route';

const liveAgentSmoke = process.env.RUN_PI_AGENT_SMOKE === '1' ? describe : describe.skip;

liveAgentSmoke('真实 PI Agent 多轮 HTTP 烟测', () => {
  const directory = mkdtempSync(join(tmpdir(), 'buildyourself-live-agent-'));
  const originalDatabase = process.env.BUILDYOURSELF_DB;

  beforeAll(() => { process.env.BUILDYOURSELF_DB = join(directory, `${randomUUID()}.sqlite`); });
  afterAll(() => {
    if (originalDatabase === undefined) delete process.env.BUILDYOURSELF_DB;
    else process.env.BUILDYOURSELF_DB = originalDatabase;
    rmSync(directory, { recursive: true, force: true });
  });

  it('calls the configured PI model through the initial and follow-up v2 API routes', async () => {
    const initialResponse = await createDraft(new Request('http://localhost/api/v2/goal-drafts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '我想学英语' }),
    }));
    expect(initialResponse.status, JSON.stringify(await initialResponse.clone().json())).toBe(201);
    const initial = await initialResponse.json();
    expect(initial.reply).toBeTypeOf('string');
    expect(initial.draft.clarifyingQuestions).toBeInstanceOf(Array);

    const followupResponse = await sendMessage(new Request(`http://localhost/api/v2/goal-drafts/${initial.draft.id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        revision: initial.draft.revision,
        message: '我希望三个月后能够独立进行10分钟英文项目介绍并回答工作中的常见问题，每周练习三次，每次30分钟。',
      }),
    }), { params: Promise.resolve({ id: initial.draft.id }) });
    expect(followupResponse.status, JSON.stringify(await followupResponse.clone().json())).toBe(200);
    const followup = await followupResponse.json();
    expect(followup.draft.revision).toBe(2);
    expect(followup.draft.transcript).toHaveLength(4);
    expect(followup.reply).toBeTypeOf('string');
  }, 150_000);
});
