import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile }));

import { proposeGoalDraft } from '../lib/goal-draft-agent';

const validOutput = JSON.stringify({
  reply: '你希望通过什么可观察的结果判断目标达成？',
  draft: {
    title: '', description: '',
    constraints: { status: 'needs_clarification', items: [] },
    attributes: [], clarifyingQuestions: ['你希望通过什么可观察的结果判断目标达成？'],
  },
});

function provide(stdout: string, error?: NodeJS.ErrnoException) {
  execFile.mockImplementation((_command, _args, _options, callback) => callback(error ?? null, stdout, ''));
}

beforeEach(() => {
  delete process.env.BUILDYOURSELF_PI_BIN;
  delete process.env.BUILDYOURSELF_AGENT_MODEL;
  execFile.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('v0.2 目标澄清 PI 适配器', () => {
  it('以无工具、无会话模式向配置的 PI 命令发送多轮上下文，并校验 JSON 返回', async () => {
    process.env.BUILDYOURSELF_PI_BIN = '/opt/homebrew/bin/pi';
    process.env.BUILDYOURSELF_AGENT_MODEL = 'magpie/auto/auto';
    provide(validOutput);

    const result = await proposeGoalDraft({
      message: '我想学英语',
      transcript: [{ role: 'user', message: '我想学英语' }],
      currentDraft: null,
    });

    expect(execFile).toHaveBeenCalledOnce();
    const [command, args, options] = execFile.mock.calls[0];
    expect(command).toBe('/opt/homebrew/bin/pi');
    expect(args).toContain('--print');
    expect(args).toContain('--no-session');
    expect(args).toContain('--no-tools');
    expect(args).toContain('--no-extensions');
    expect(args).toContain('--no-mcp');
    expect(args).toContain('--no-skills');
    expect(args).toContain('magpie/auto/auto');
    expect(options).toMatchObject({ encoding: 'utf8', timeout: 60_000 });
    expect(JSON.parse(String(args.at(-1)))).toMatchObject({
      task: 'clarify_goal', latestMessage: '我想学英语',
      conversation: [{ role: 'user', message: '我想学英语' }], currentDraft: null,
    });
    expect(result).toMatchObject({ reply: '你希望通过什么可观察的结果判断目标达成？' });
  });

  it('拒绝非 JSON 或缺少必要字段的模型响应', async () => {
    provide('```json\n{}\n```');
    await expect(proposeGoalDraft({ message: '我想学英语', transcript: [], currentDraft: null }))
      .rejects.toMatchObject({ status: 502, message: expect.stringContaining('reply 和 draft') });

    provide(JSON.stringify({ reply: '确认一下', draft: { attributes: [] } }));
    await expect(proposeGoalDraft({ message: '我想学英语', transcript: [], currentDraft: null }))
      .rejects.toMatchObject({ status: 502, message: expect.stringContaining('待澄清问题列表') });
  });

  it('规范化 PI 返回的代码围栏及常见字段变体', async () => {
    provide(`\`\`\`json
      {"reply":"需要继续澄清。","draft":{"title":"学英语","description":"待明确结果。","constraints":[],"attributes":[{"name":"当前水平","value":"未知"}],"clarifyingQuestions":[{"question":"希望用英语完成什么？","priority":"high"}]}}
      \`\`\``);

    const result = await proposeGoalDraft({ message: '我想学英语', transcript: [], currentDraft: null });

    expect(result.draft).toMatchObject({
      constraints: { status: 'needs_clarification', items: [] },
      attributes: [{ name: '当前水平', description: '当前水平：未知' }],
      clarifyingQuestions: ['希望用英语完成什么？'],
    });
  });

  it('把未安装命令与模型超时映射成可诊断的服务错误', async () => {
    const missingCommand = Object.assign(new Error('spawn pi ENOENT'), { code: 'ENOENT' });
    provide('', missingCommand);
    await expect(proposeGoalDraft({ message: '我想学英语', transcript: [], currentDraft: null }))
      .rejects.toMatchObject({ status: 503, message: expect.stringContaining('BUILDYOURSELF_PI_BIN') });

    const timeout = Object.assign(new Error('timeout'), { killed: true, code: 'ETIMEDOUT' });
    provide('', timeout);
    await expect(proposeGoalDraft({ message: '我想学英语', transcript: [], currentDraft: null }))
      .rejects.toMatchObject({ status: 504, message: expect.stringContaining('超时') });
  });
});
