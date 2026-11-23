import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { execFile, outputs } = vi.hoisted(() => ({ execFile: vi.fn(), outputs: [] as string[] }));
vi.mock('node:child_process', () => ({ execFile }));

import { POST as createDraft } from '../app/api/v2/goal-drafts/route';
import { GET as getDraft } from '../app/api/v2/goal-drafts/[id]/route';
import { POST as sendMessage } from '../app/api/v2/goal-drafts/[id]/messages/route';

const directory = mkdtempSync(join(tmpdir(), 'buildyourself-agent-persistence-'));
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  process.env.BUILDYOURSELF_DB = join(directory, `${randomUUID()}.sqlite`);
  outputs.length = 0;
  execFile.mockReset();
  execFile.mockImplementation((_command, _args, _options, callback) => {
    callback(null, outputs.shift(), '');
    return { stdin: { end: vi.fn() } };
  });
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe('目标草稿 Agent 跨轮持久化', () => {
  it('Agent 只返回约束状态时拒绝该轮且保留已保存约束', async () => {
    outputs.push(JSON.stringify({
      reply: '先记录你的练习安排。',
      draft: {
        title: '提升英语口语', description: '能够独立完成英文项目介绍。',
        constraints: { status: 'needs_clarification', items: ['每周练习三次'] },
        attributes: [{ name: '项目介绍', description: '英文介绍的清晰度' }],
        clarifyingQuestions: ['希望几个月后达到目标？'],
      },
    }));
    const created = await createDraft(new Request('http://localhost/api/v2/goal-drafts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '我想提升英语口语' }),
    }));
    const { draft: first } = await created.json();
    expect(created.status).toBe(201);

    outputs.push(JSON.stringify({
      reply: '约束已确认。',
      draft: {
        title: '提升英语口语', description: '能够独立完成英文项目介绍。',
        constraints: { status: 'confirmed' },
        attributes: [{ name: '项目介绍', description: '英文介绍的清晰度' }],
        clarifyingQuestions: [],
      },
    }));
    const rejected = await sendMessage(new Request(`http://localhost/api/v2/goal-drafts/${first.id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '好的，请确认约束。', revision: first.revision }),
    }), params(first.id));
    const persisted = await (await getDraft(new Request('http://localhost'), params(first.id))).json();

    expect(rejected.status).toBe(502);
    expect(persisted.draft).toMatchObject({
      revision: first.revision,
      constraints: { status: 'needs_clarification', items: ['每周练习三次'] },
    });
    expect(persisted.draft.transcript).toHaveLength(2);
  });
});
