import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET, POST, PUT } from '../app/api/weekly-review/route';
import { saveEvidence } from '../lib/store';
import { activateGoalPlan, saveGoalPlanDraft } from '../lib/goal-plans';

const dir = mkdtempSync(join(tmpdir(), 'buildyourself-weekly-review-api-'));
beforeEach(() => { process.env.BUILDYOURSELF_DB = join(dir, `${randomUUID()}.sqlite`); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('周复盘 API', () => {
  it('生成待核对内容，保存后在源证据变化时仍恢复同一份复盘', async () => {
    const draftResponse = GET(new Request('http://localhost/api/weekly-review?weekStart=2026-11-09'));
    const draft = await draftResponse.json();
    expect(draftResponse.status).toBe(200);
    expect(draft.status).toBe('draft');

    const adjustment = { ...draft.review.adjustment, title: '先补一条完整测量' };
    const saveResponse = await PUT(new Request('http://localhost/api/weekly-review', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekStart: '2026-11-09', adjustment }),
    }));
    const saved = await saveResponse.json();
    expect(saveResponse.status).toBe(200);
    expect(saved).toMatchObject({ status: 'saved', review: { adjustment: { title: adjustment.title, modifiedByUser: true } } });

    saveEvidence({
      text: '完整基准测试测得延迟 190 ms', source: '测试报告', reference: 'report-190',
      observedAt: '2026-11-12T10:00:00.000Z', links: ['milestone'], level: 'E2',
      reportSubmitted: null, latencyMs: 190, benchmarkComplete: true,
    });
    const reopenResponse = GET(new Request('http://localhost/api/weekly-review?weekStart=2026-11-09'));
    expect(await reopenResponse.json()).toEqual(saved);
  });

  it('缺少周起始日期时返回可读错误', async () => {
    const response = GET(new Request('http://localhost/api/weekly-review'));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: '请指定周复盘的周一日期。' });
  });

  it('确认已保存建议后返回关联到里程碑的待排任务', async () => {
    const draft = saveGoalPlanDraft({
      sourceIntent: '改善响应延迟', title: '改善响应延迟', domain: 'project', context: '性能验证',
      successDescription: '响应延迟低于 200 ms', observableResult: '完整基准报告', baselineStatus: 'known',
      baselineAction: '运行完整基准测试',
      milestones: [{ id: 'latency', title: '响应延迟达标', stage: 'near', successCriteria: '完整基准测试响应延迟低于 200 ms',
        standardAssessment: 'reasonable', evidenceAvailability: 'available', reviewNote: '保留完整报告', evidenceRequirement: 'E2 或 E3 完整基准报告' }],
      nextActions: [{ id: 'benchmark', title: '运行完整基准测试', details: '固定环境并保留报告', estimateMinutes: 30,
        priority: 'high', hardDeadline: null, milestoneId: 'latency', dependsOn: [], specificity: 'concrete' }],
      constraints: { status: 'confirmed', items: [] },
      evidenceRequirements: [{ id: 'report', item: '基准报告', description: '提交完整报告', minimumLevel: 'E2' }],
      reviewCycleDays: 7,
    });
    activateGoalPlan(draft.id);
    const weekStart = '2026-11-09';
    const reviewResponse = GET(new Request(`http://localhost/api/weekly-review?weekStart=${weekStart}&timeZone=UTC`));
    const review = await reviewResponse.json();
    const saveResponse = await PUT(new Request('http://localhost/api/weekly-review', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekStart, adjustment: review.review.adjustment }),
    }));
    expect(saveResponse.status).toBe(200);

    const confirmResponse = await POST(new Request('http://localhost/api/weekly-review', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekStart, timeZone: 'UTC' }),
    }));
    const confirmed = await confirmResponse.json();
    expect(confirmResponse.status).toBe(200);
    expect(confirmed).toMatchObject({
      status: 'saved',
      followup: { state: 'confirmed', decision: 'accepted', goalPlanId: draft.id, milestoneId: 'latency', actionId: expect.any(String) },
    });
  });
});
