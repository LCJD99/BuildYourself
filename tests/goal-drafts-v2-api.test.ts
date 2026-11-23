import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST as createDraft } from '../app/api/v2/goal-drafts/route';
import { GET as getDraft } from '../app/api/v2/goal-drafts/[id]/route';
import { POST as sendMessage } from '../app/api/v2/goal-drafts/[id]/messages/route';
import { POST as confirmDraft } from '../app/api/v2/goal-drafts/[id]/confirm/route';
import { GET as listGoals } from '../app/api/v2/goals/route';
import { GET as getGoal } from '../app/api/v2/goals/[id]/route';

const { proposeGoalDraft } = vi.hoisted(() => ({ proposeGoalDraft: vi.fn() }));
vi.mock('../lib/goal-draft-agent', () => ({ proposeGoalDraft }));

const directory = mkdtempSync(join(tmpdir(), 'buildyourself-v2-goal-drafts-'));
beforeEach(() => {
  process.env.BUILDYOURSELF_DB = join(directory, `${randomUUID()}.sqlite`);
  proposeGoalDraft.mockImplementation(async ({ message }: { message: string }) => message === '我想学英语'
    ? { reply: '你希望通过什么可观察的结果判断目标达成？', draft: { clarifyingQuestions: ['你希望通过什么可观察的结果判断目标达成？'] } }
    : { reply: '我整理了目标草稿，请核对名称、约束和属性。', draft: readyProposal });
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const readyProposal = {
  title: '提升英语表达能力',
  description: '能够独立完成 10 分钟英文项目介绍并回答常见问题。',
  constraints: { status: 'confirmed', items: ['工作日每天可投入 30 分钟'] },
  attributes: [
    { name: '口语表达', description: '英文介绍的流畅度与清晰度' },
    { name: '听力理解', description: '听懂并回应常见问题' },
  ],
  clarifyingQuestions: [],
};

describe('v0.2 目标草稿 HTTP API', () => {
  it('保存初始意图并可重新打开，草稿尚不进入已启用目标列表', async () => {
    const response = await createDraft(new Request('http://localhost/api/v2/goal-drafts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '我想学英语', agentDraft: { title: '不可信的浏览器提议' } }),
    }));
    const { draft } = await response.json();

    expect(response.status).toBe(201);
    expect(draft).toMatchObject({
      revision: 1, sourceIntent: '我想学英语', state: 'draft',
      constraints: { status: 'needs_clarification' },
    });
    expect(draft.clarifyingQuestions.length).toBeGreaterThan(0);
    expect(draft.title).toBe('');
    expect(proposeGoalDraft.mock.calls[0][0].currentDraft).toBeNull();
    expect((await (await listGoals()).json()).goals).toEqual([]);
    expect((await (await getDraft(new Request('http://localhost'), params(draft.id))).json()).draft).toEqual(draft);
  });

  it('跨请求保存自然语言回答和 Agent 提议，确认后目标及初始属性进度可读取', async () => {
    const created = await createDraft(new Request('http://localhost/api/v2/goal-drafts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '我想学英语' }),
    }));
    const { draft: first } = await created.json();
    const response = await sendMessage(new Request(`http://localhost/api/v2/goal-drafts/${first.id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '希望三个月后能做英文项目介绍，工作日每天练习半小时。', revision: first.revision }),
    }), params(first.id));
    const { draft: updated } = await response.json();

    expect(response.status).toBe(200);
    expect(updated.revision).toBe(2);
    expect(updated.transcript).toHaveLength(4);
    expect(updated.transcript.map((entry: { role: string }) => entry.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(updated.title).toBe(readyProposal.title);
    expect(proposeGoalDraft.mock.calls.at(-1)?.[0].currentDraft.revision).toBe(first.revision);
    expect(updated.title).toBe(readyProposal.title);
    expect(updated.clarifyingQuestions).toEqual([]);

    const confirmed = await confirmDraft(new Request(`http://localhost/api/v2/goal-drafts/${first.id}/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: updated.revision }),
    }), params(first.id));
    const { goal } = await confirmed.json();
    const goals = await (await listGoals()).json();
    const detail = await (await getGoal(new Request('http://localhost'), params(goal.id))).json();

    expect(confirmed.status).toBe(201);
    expect(goals.goals).toHaveLength(1);
    expect(detail.goal).toMatchObject({
      id: goal.id, title: readyProposal.title, state: 'enabled',
      attributes: [
        { name: '口语表达', progress: 0 },
        { name: '听力理解', progress: 0 },
      ],
    });
  });

  it('拒绝过期版本并以 409 要求刷新', async () => {
    const created = await createDraft(new Request('http://localhost/api/v2/goal-drafts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '我想学英语' }),
    }));
    const { draft } = await created.json();
    await sendMessage(new Request(`http://localhost/api/v2/goal-drafts/${draft.id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '希望能做英文项目介绍。', revision: draft.revision }),
    }), params(draft.id));

    const response = await confirmDraft(new Request(`http://localhost/api/v2/goal-drafts/${draft.id}/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: draft.revision }),
    }), params(draft.id));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('刷新');
  });

  it('同一版本重复确认复用已启用目标', async () => {
    const created = await createDraft(new Request('http://localhost/api/v2/goal-drafts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '我想学英语' }),
    }));
    const { draft } = await created.json();
    const updated = await sendMessage(new Request(`http://localhost/api/v2/goal-drafts/${draft.id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '我希望完成英文项目介绍。', revision: draft.revision }),
    }), params(draft.id));
    const ready = (await updated.json()).draft;
    const request = () => new Request(`http://localhost/api/v2/goal-drafts/${draft.id}/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: ready.revision }),
    });

    const first = await confirmDraft(request(), params(draft.id));
    const second = await confirmDraft(request(), params(draft.id));
    const firstGoal = (await first.json()).goal;
    const secondGoal = (await second.json()).goal;

    expect(firstGoal.id).toBe(secondGoal.id);
    expect((await (await listGoals()).json()).goals).toHaveLength(1);
  });

  it('不完整草稿不能确认', async () => {
    const created = await createDraft(new Request('http://localhost/api/v2/goal-drafts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '我想学英语' }),
    }));
    const { draft } = await created.json();
    const response = await confirmDraft(new Request(`http://localhost/api/v2/goal-drafts/${draft.id}/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: draft.revision }),
    }), params(draft.id));

    expect(response.status).toBe(422);
    expect((await response.json()).issues.length).toBeGreaterThan(0);
  });
});
