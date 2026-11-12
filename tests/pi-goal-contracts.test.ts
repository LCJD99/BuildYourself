import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { getGoalDomainTemplate } from '../lib/goal-domain-templates';

const typeboxStub = {
  Optional: (value: unknown) => value,
  String: () => ({}),
  Integer: () => ({}),
  Literal: (value: unknown) => value,
  Union: (value: unknown) => value,
  Object: (value: unknown) => value,
  Array: (value: unknown) => value,
  Boolean: () => ({}),
  Null: () => null,
};
const source = readFileSync(new URL('../pi/goal.js', import.meta.url), 'utf8')
  .replace("import { Type } from 'typebox';", '')
  .replace('export default function (pi) {', 'return function (pi) {');
const goalExtension = new Function('Type', source)(typeboxStub) as (pi: unknown) => void;

const pendingChange = {
  id: 'change-1', goalPlanId: 'goal-1', baseVersion: 1, status: 'pending_review', summary: '提高可核验要求',
  changedFields: ['里程碑与评价标准'],
  previousPlan: {
    title: '英语表达', domain: 'learning', successDescription: '能主持会议。', observableResult: null,
    context: null, baselineStatus: 'known', baselineAction: null, constraints: { status: 'confirmed', items: [] },
    reviewCycleDays: 7, milestones: [], evidenceRequirements: [], nextActions: [], sourceIntent: '学习英语',
  },
  proposedPlan: {
    title: '英语表达', domain: 'learning', successDescription: '能主持会议并回答问题。', observableResult: null,
    context: null, baselineStatus: 'known', baselineAction: null, constraints: { status: 'confirmed', items: [] },
    reviewCycleDays: 7, milestones: [], evidenceRequirements: [], nextActions: [], sourceIntent: '学习英语',
  },
  createdAt: '2026-11-12T00:00:00.000Z', updatedAt: '2026-11-12T00:00:00.000Z', resolvedAt: null,
};

const template = getGoalDomainTemplate('learning', '1.0.0');
const completeDraft = {
  id: 'draft-1', status: 'draft', updatedAt: '2026-11-12T00:00:00.000Z', validation: { ready: true, issues: [] },
  sourceIntent: '我想学英语', title: '英语表达', domain: 'learning', domainTemplate: template,
  context: '工作会议', successDescription: '能主持英文会议。', observableResult: '保存完整录音和反馈。',
  baselineStatus: 'to_measure', baselineAction: '录制一段英文项目介绍。',
  constraints: { status: 'confirmed', items: ['每晚最多 30 分钟'] },
  milestones: [{ id: 'milestone-1', title: '完成基线', stage: 'near', successCriteria: '保存一段 3 分钟录音。', standardAssessment: 'reasonable', evidenceAvailability: 'available', reviewNote: '录音可复听。', evidenceRequirement: '完整录音（E2）。' }],
  nextActions: [{ id: 'action-1', title: '录制英文项目介绍', estimateMinutes: 20, priority: 'medium', specificity: 'concrete', dependsOn: [] }],
  evidenceRequirements: [{ id: 'evidence-1', item: '口语基线', description: '保存完整录音。', minimumLevel: 'E2' }],
  reviewCycleDays: 7, lifecycleEvents: [], pendingCompletion: null, contractVersion: null,
};

function createGoalTool() {
  const tools = new Map<string, any>();
  goalExtension({
    on() {},
    registerCommand() {},
    registerTool(tool: any) { tools.set(tool.name, tool); },
  } as any);
  return tools.get('goal_planning');
}

function response(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('pi 目标契约变更确认', () => {
  it('确认对话框取消时不调用写入接口', async () => {
    const tool = createGoalTool();
    const fetchMock = vi.fn(async (url: string) => response({ changes: [pendingChange] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await tool.execute('call-1', { action: 'confirm_change', goalPlanId: 'goal-1', changeId: 'change-1' }, undefined, undefined, {
      hasUI: true,
      ui: { confirm: async (_title: string, message: string) => message.includes('原契约') ? false : true },
    });

    expect(result.content[0].text).toContain('用户取消确认');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('写入前向用户展示新旧契约并取得单独确认', async () => {
    const tool = createGoalTool();
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => options?.method === 'POST'
      ? response({ change: { ...pendingChange, status: 'confirmed' } })
      : response({ changes: [pendingChange] }));
    vi.stubGlobal('fetch', fetchMock);
    const confirm = vi.fn(async (_title: string, message: string) => {
      expect(message).toContain('原契约');
      expect(message).toContain('拟议的新契约');
      expect(message).toContain('能主持会议并回答问题');
      return true;
    });

    const result = await tool.execute('call-2', { action: 'confirm_change', goalPlanId: 'goal-1', changeId: 'change-1' }, undefined, undefined, {
      hasUI: true, ui: { confirm },
    });

    expect(confirm).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.method).toBe('POST');
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ action: 'confirm', confirmed: true, changeId: 'change-1' });
    expect(result.content[0].text).toContain('创建新版本');
  });

  it('历史评价展示记录中保存的契约版本和证据规则', async () => {
    const tool = createGoalTool();
    const fetchMock = vi.fn(async (url: string) => url.endsWith('/contract-changes')
      ? response({ currentVersion: 2, versions: [], changes: [], applicableVersion: null })
      : response({ evidenceCandidates: [{ id: 'evidence-1', level: 'E2', observedAt: '2026-11-05T09:00:00.000Z', reference: '会议录音', text: '完整录音', goalActionId: 'action-1' }], evaluations: [{
        id: 'evaluation-1', status: 'confirmed', observedAt: '2026-11-05T09:00:00.000Z', evaluatedAt: '2026-11-12T09:00:00.000Z',
        assessmentSource: 'caller_supplied', outcome: 'met', evidenceGate: { requiredLevel: 'E2', status: 'qualified', qualifiedEvidenceIds: ['evidence-1'] },
        contractVersion: { id: 'contract-1', version: 1 },
        ruleSnapshot: {
          minimumEvidenceLevel: 'E2',
          milestone: { id: 'meeting', title: '主持项目同步', successCriteria: '回答至少 3 个现场问题。' },
          successDescription: '完成项目同步。', evidenceRequirements: [{ id: 'recording', item: '会议录音', description: '保存完整录音。', minimumLevel: 'E2' }],
        },
        summary: '观察时符合旧标准。', reasons: ['留存完整会议录音。'], evidenceIds: ['evidence-1'],
      }] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await tool.execute('call-3', { action: 'list_history', goalPlanId: 'goal-1' }, undefined, undefined, { hasUI: false });
    const output = result.content[0].text;

    expect(output).toContain('版本 1（contract-1）');
    expect(output).toContain('调用方提出的结论');
    expect(output).toContain('系统只核对当时契约规定的证据等级');
    expect(output).toContain('evidence-1 · E2');
    expect(output).toContain('回答至少 3 个现场问题');
    expect(output).toContain('会议录音：保存完整录音。（最低 E2）');
  });

  it('列出模板时展示来源、适用条件和版本，并让用户选择后再存草稿', async () => {
    const tool = createGoalTool();
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'POST' || options?.method === 'PATCH') return response({ plan: completeDraft });
      if (_url.includes('/goal-domain-templates')) return response({ templates: [template] });
      return response({ plans: [completeDraft] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const listed = await tool.execute('templates', { action: 'list_templates' }, undefined, undefined, { hasUI: false });
    expect(listed.content[0].text).toContain('学习目标模板 · v1.0.0');
    expect(listed.content[0].text).toContain('https://doi.org/10.1177/1529100612453266');
    expect(listed.content[0].text).toContain('适用条件');
    expect(listed.content[0].text).toContain('请向用户展示');

    const rejected = await tool.execute('missing-template', { action: 'save_draft', plan: { title: '英语表达' } }, undefined, undefined, { hasUI: false });
    expect(rejected.isError).toBe(true);
    expect(rejected.content[0].text).toContain('list_templates');

    const saved = await tool.execute('save-template', { action: 'save_draft', plan: { domain: 'learning', domainTemplate: { id: 'learning', version: '1.0.0' } } }, undefined, undefined, { hasUI: false });
    expect(saved.content[0].text).toContain('学习目标模板 · v1.0.0');
    expect(saved.content[0].text).toContain('BuildYourself MVP PRD');
  });

  it('启用对话框展示完整计划、评价标准、行动和模板依据', async () => {
    const tool = createGoalTool();
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => options?.method === 'POST'
      ? response({ plan: { ...completeDraft, status: 'active' } })
      : response({ plans: [completeDraft] }));
    vi.stubGlobal('fetch', fetchMock);
    const confirm = vi.fn(async (_title: string, message: string) => {
      expect(message).toContain('保存一段 3 分钟录音');
      expect(message).toContain('录制英文项目介绍');
      expect(message).toContain('学习目标模板 · v1.0.0');
      expect(message).toContain('https://doi.org/10.1177/1529100612453266');
      expect(message).toContain('使用边界');
      return true;
    });

    const activated = await tool.execute('activate', { action: 'activate', draftId: 'draft-1' }, undefined, undefined, {
      hasUI: true, ui: { confirm },
    });

    expect(confirm).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toMatchObject({
      confirmed: true,
      reviewedAt: completeDraft.updatedAt,
    });
    expect(activated.content[0].text).toContain('近期行动已进入待排池');
  });
});
