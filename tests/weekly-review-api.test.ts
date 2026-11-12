import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET, PUT } from '../app/api/weekly-review/route';
import { saveEvidence } from '../lib/store';

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
});
