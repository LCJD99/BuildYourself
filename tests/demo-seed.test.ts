import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDemoData } from '../lib/demo-seed';
import { listGoalPlans } from '../lib/goal-plans';
import { listExternalCommitments } from '../lib/commitments';
import { listEvidence } from '../lib/store';

const dir = mkdtempSync(join(tmpdir(), 'buildyourself-demo-'));

beforeEach(() => {
  process.env.BUILDYOURSELF_DB = join(dir, `${randomUUID()}.sqlite`);
});

afterEach(() => {
  delete process.env.BUILDYOURSELF_DB;
  rmSync(dir, { recursive: true, force: true });
});

describe('演示数据', () => {
  it('首次访问生成三个目标、证据和一条外部承诺，重复调用不会重复播种', async () => {
    await ensureDemoData();
    await ensureDemoData();

    const plans = listGoalPlans();
    expect(plans.filter(plan => plan.status === 'active')).toHaveLength(3);
    expect(plans.map(plan => plan.domain).sort()).toEqual(['fitness', 'learning', 'project']);
    expect(listEvidence()).toHaveLength(2);
    expect(listExternalCommitments()).toHaveLength(1);
  });
});
