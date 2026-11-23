import { afterEach, describe, expect, it, vi } from 'vitest';
import { proposeGoalDraft } from '../lib/goal-draft-agent';

afterEach(() => {
  delete process.env.BUILDYOURSELF_AGENT_URL;
  delete process.env.BUILDYOURSELF_AGENT_TOKEN;
  vi.unstubAllGlobals();
});

describe('v0.2 目标澄清 Agent 适配器', () => {
  it('未配置服务端 Agent 时明确返回服务不可用', async () => {
    await expect(proposeGoalDraft({ message: '我想学英语', transcript: [], currentDraft: null }))
      .rejects.toMatchObject({ status: 503, message: expect.stringContaining('BUILDYOURSELF_AGENT_URL') });
  });

  it('将对话与当前草稿发给服务端 Agent，并校验结构化返回', async () => {
    process.env.BUILDYOURSELF_AGENT_URL = 'http://agent.internal/clarify';
    process.env.BUILDYOURSELF_AGENT_TOKEN = 'local';
    const fetchMock = vi.fn(async (_url: URL, _options: RequestInit) => new Response(JSON.stringify({
      reply: '请核对目标草稿。',
      draft: {
        title: '提升英语表达能力',
        description: '能够完成英文项目介绍。',
        constraints: { status: 'confirmed', items: ['每周练习三次'] },
        attributes: [{ name: '口语表达', description: '表达清晰度' }],
        clarifyingQuestions: [],
      },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await proposeGoalDraft({
      message: '希望三个月后能做英文项目介绍。',
      transcript: [{ role: 'user', message: '我想学英语' }],
      currentDraft: null,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0].toString()).toBe('http://agent.internal/clarify');
    const options = fetchMock.mock.calls[0][1];
    expect(options.headers).toMatchObject({ Authorization: 'Bearer local' });
    expect(JSON.parse(String(options.body))).toMatchObject({
      task: 'clarify_goal', message: '希望三个月后能做英文项目介绍。',
      transcript: [{ role: 'user', message: '我想学英语' }], currentDraft: null,
    });
    expect(result).toMatchObject({
      reply: '请核对目标草稿。', draft: { title: '提升英语表达能力', clarifyingQuestions: [] },
    });
  });

  it('拒绝无效的服务端返回，避免持久化不完整响应', async () => {
    process.env.BUILDYOURSELF_AGENT_URL = 'http://agent.internal/clarify';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ reply: '请确认', draft: { attributes: 'not-a-list' } }), { status: 200 })));

    await expect(proposeGoalDraft({ message: '我想学英语', transcript: [], currentDraft: null }))
      .rejects.toMatchObject({ status: 502 });
  });
});
