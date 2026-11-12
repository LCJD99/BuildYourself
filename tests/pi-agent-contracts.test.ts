import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const typeboxStub = {
  Optional: (value: unknown) => value,
  String: () => ({}),
  Literal: (value: unknown) => value,
  Union: (value: unknown) => value,
  Object: (value: unknown) => value,
};
const source = readFileSync(new URL('../pi/agent.js', import.meta.url), 'utf8')
  .replace("import { Type } from 'typebox';", '')
  .replace('export default function (pi) {', 'return function (pi) {');
const agentExtension = new Function('Type', source)(typeboxStub) as (pi: unknown) => void;

function createAgentTool() {
  const tools = new Map<string, any>();
  agentExtension({
    on() {},
    registerCommand() {},
    registerTool(tool: any) { tools.set(tool.name, tool); },
  } as any);
  return tools.get('agent_discussion');
}

function response(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('pi 共享业务 Agent', () => {
  it('读取应用保存的当前对象，并通过同一讨论接口处理继续对话', async () => {
    const tool = createAgentTool();
    const context = {
      layer: 'task', title: '录制演示', breadcrumb: '目标组合 / 英语展示 / 录制演示',
      goalPlanId: 'goal-1', actionId: 'action-1', evidenceId: null, projectId: null,
      graphNodeId: 'task', summary: '按课程要求准备并录制。', standard: '提交完整录像。',
      evidenceRequirement: 'E2 平台提交记录。', nextStep: '核对耗时与截止日期。',
    };
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/api/agent-context')) {
        return response({
          agent: { id: 'buildyourself.business-agent.v1', name: 'BuildYourself 业务 Agent' },
          context,
        });
      }
      expect(options?.method).toBe('POST');
      expect(JSON.parse(String(options?.body))).toEqual({ message: '下一步做什么？' });
      return response({
        agent: { id: 'buildyourself.business-agent.v1', name: 'BuildYourself 业务 Agent' },
        context,
        reply: '当前应继续完成「录制演示」，并保留 E2 平台提交记录。',
        confirmation: { required: false, kind: null, title: null, detail: null, nextStep: null },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const current = await tool.execute('call-1', { action: 'current' }, undefined, undefined, { hasUI: false });
    expect(current.content[0].text).toContain('正在讨论：目标组合 / 英语展示 / 录制演示');

    const discussion = await tool.execute('call-2', { action: 'discuss', message: '下一步做什么？' }, undefined, undefined, { hasUI: false });
    expect(discussion.content[0].text).toContain('当前应继续完成「录制演示」');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
