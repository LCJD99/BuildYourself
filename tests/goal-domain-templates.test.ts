import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getGoalDomainTemplate, listGoalDomainTemplates } from '../lib/goal-domain-templates';
import { GET as listTemplatesApi } from '../app/api/goal-domain-templates/route';
import { POST as activateGoalPlanApi } from '../app/api/goal-plans/[id]/activate/route';
import { activateGoalPlan, createGoalPlanContractChange, listGoalPlanContractVersions, resolveGoalPlanContractChange, saveGoalPlanDraft, updateGoalPlanDraft } from '../lib/goal-plans';
import { describeGoalTemplateReview } from '../lib/goal-template-review';

const dir = mkdtempSync(join(tmpdir(), 'buildyourself-domain-templates-'));
beforeEach(() => { process.env.BUILDYOURSELF_DB = join(dir, `${randomUUID()}.sqlite`); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function plan(domain: string, domainTemplate: unknown) {
  return {
    sourceIntent: `建立${domain}目标`, title: `${domain}目标`, domain, domainTemplate,
    successDescription: '达到用户定义的结果', observableResult: '留下可核对的结果',
    baselineStatus: 'known', constraints: { status: 'confirmed', items: [] },
    milestones: [{ title: '近期阶段', stage: 'near', successCriteria: '按用户标准完成', standardAssessment: 'reasonable', evidenceAvailability: 'available', reviewNote: '用户可核对', evidenceRequirement: '保存结果记录' }],
    nextActions: [{ id: 'first-action', title: '执行一次基线行动', estimateMinutes: 30, specificity: 'concrete' }],
    evidenceRequirements: [{ item: '结果记录', description: '保存原始结果', minimumLevel: 'E2' }], reviewCycleDays: 7,
  };
}

describe('版本化领域目标模板', () => {
  it('提供学习、健身、项目和通用模板及有来源/适用范围的知识条目', () => {
    const templates = listGoalDomainTemplates();
    expect(templates.map(template => template.id)).toEqual(['learning', 'fitness', 'project', 'general']);
    for (const template of templates) {
      expect(template.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(template.applicabilityConditions.length).toBeGreaterThan(0);
      expect(template.sourceReferences.length).toBeGreaterThan(0);
      for (const source of template.sourceReferences) {
        expect(source.id).toBeTruthy();
        expect(source.version).toBeTruthy();
        expect(source.url).toMatch(/^https:\/\//);
        expect(source.supports).toBeTruthy();
        expect(source.applicability).toBeTruthy();
        expect(source.limitations).toBeTruthy();
      }
    }
  });

  it('学习模板覆盖掌握、留存、迁移和真实输出，引用检索练习来源', () => {
    const template = getGoalDomainTemplate('learning', '1.0.0');
    expect(template?.outcomeDimensions).toEqual(expect.arrayContaining(['掌握', '留存', '迁移', '真实输出']));
    expect(template?.sourceReferences.some(source => source.id === 'dunlosky-2013')).toBe(true);
    expect(template?.limitations.join(' ')).toContain('不保证');
  });

  it('健身和项目模板覆盖指定关注点，并标清专业来源的使用边界', () => {
    const fitness = getGoalDomainTemplate('fitness', '1.0.0');
    const project = getGoalDomainTemplate('project', '1.0.0');
    expect(fitness?.outcomeDimensions).toEqual(expect.arrayContaining(['表现', '训练负荷', '恢复']));
    expect(fitness?.sourceReferences.some(source => source.id === 'acsm-resistance-training-2026')).toBe(true);
    expect(fitness?.applicabilityConditions.join(' ')).toContain('健康成年人');
    expect(project?.outcomeDimensions).toEqual(expect.arrayContaining(['里程碑', '质量', '交付验收']));
    expect(project?.sourceReferences.some(source => source.id === 'scrum-guide-2020')).toBe(true);
    expect(project?.sourceReferences.some(source => source.id === 'nasa-se-handbook-rev2')).toBe(true);
  });

  it('保存目标时从注册表生成不可伪造的模板快照并拒绝领域或版本不匹配', () => {
    const fakeTemplate = { id: 'learning', version: '1.0.0', title: '伪造标题', sourceReferences: [{ id: 'fake', url: 'https://example.invalid' }] };
    const saved = saveGoalPlanDraft(plan('learning', fakeTemplate));
    expect(saved.domainTemplate).toMatchObject({ id: 'learning', version: '1.0.0', title: '学习目标模板' });
    expect(saved.domainTemplate?.sourceReferences.some(source => source.id === 'fake')).toBe(false);

    const forgedSnapshot = getGoalDomainTemplate('learning', '1.0.0')!;
    forgedSnapshot.title = '编辑时伪造的标题';
    forgedSnapshot.sourceReferences[0].url = 'https://example.invalid';
    const edited = updateGoalPlanDraft(saved.id, { domainTemplate: forgedSnapshot });
    expect(edited.domainTemplate?.title).toBe('学习目标模板');
    expect(edited.domainTemplate?.sourceReferences.some(source => source.url === 'https://example.invalid')).toBe(false);

    expect(() => saveGoalPlanDraft(plan('fitness', fakeTemplate))).toThrow('模板领域与目标领域不一致');
    expect(() => saveGoalPlanDraft(plan('learning', { id: 'learning', version: '99.0.0' }))).toThrow('找不到该领域模板版本');
  });

  it('模板接口提供完整知识目录，通用模板走相同的起草和启用流程', async () => {
    const response = listTemplatesApi();
    const { templates } = await response.json();
    expect(templates).toEqual(listGoalDomainTemplates());

    const draft = saveGoalPlanDraft(plan('general', { id: 'general', version: '1.0.0' }));
    expect(draft.domainTemplate?.sourceReferences[0].url).toBeTruthy();
    expect(draft.validation.ready).toBe(true);

    const review = describeGoalTemplateReview(draft);
    expect(review.template).toContain('通用目标模板 v1.0.0');
    expect(review.sources).toContain('https://');
    expect(review.criteria).toContain('按用户标准完成');
    expect(review.evidence).toContain('最低 E2');
    expect(review.actions).toContain('执行一次基线行动');

    activateGoalPlan(draft.id, { confirmed: true, reviewedAt: draft.updatedAt });
    expect(listGoalPlanContractVersions(draft.id)[0].plan.domainTemplate).toMatchObject({ id: 'general', version: '1.0.0' });
  });

  it('启用 API 拒绝仅凭布尔值确认，并要求核对当前草稿版本', async () => {
    const draft = saveGoalPlanDraft(plan('general', { id: 'general', version: '1.0.0' }));
    const context = { params: Promise.resolve({ id: draft.id }) };
    const withoutRevision = await activateGoalPlanApi(new Request(`http://localhost/api/goal-plans/${draft.id}/activate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }),
    }), context);

    expect(withoutRevision.status).toBe(400);
    expect(await withoutRevision.json()).toMatchObject({ error: '目标核对版本 必须是有效时间' });
    expect(listGoalPlanContractVersions(draft.id)).toEqual([]);

    const approved = await activateGoalPlanApi(new Request(`http://localhost/api/goal-plans/${draft.id}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmed: true, reviewedAt: draft.updatedAt }),
    }), context);
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({ plan: { id: draft.id, status: 'active' } });
  });

  it('编辑草稿保留已确认的模板快照，模板变更写入契约版本历史', () => {
    const draft = saveGoalPlanDraft(plan('learning', { id: 'learning', version: '1.0.0' }));
    const edited = updateGoalPlanDraft(draft.id, { title: '更新后的学习目标' });
    expect(edited.domainTemplate).toEqual(draft.domainTemplate);

    activateGoalPlan(edited.id, { confirmed: true, reviewedAt: edited.updatedAt });
    expect(listGoalPlanContractVersions(draft.id)[0].plan.domainTemplate?.sourceReferences.some(source => source.id === 'dunlosky-2013')).toBe(true);

    const change = createGoalPlanContractChange(draft.id, {
      summary: '改用通用模板',
      plan: { domain: 'general', domainTemplate: { id: 'general', version: '1.0.0' } },
    });
    expect(change.previousPlan.domainTemplate).toMatchObject({ id: 'learning', version: '1.0.0' });
    expect(change.proposedPlan.domainTemplate).toMatchObject({ id: 'general', version: '1.0.0' });
    resolveGoalPlanContractChange(draft.id, change.id, { action: 'confirm', confirmed: true });
    expect(listGoalPlanContractVersions(draft.id).map(version => version.plan.domainTemplate?.id)).toEqual(['learning', 'general']);
  });

  it('读取契约历史时保留当时存储的完整模板快照，即使该版本已不在实时注册表中', () => {
    const draft = saveGoalPlanDraft(plan('learning', { id: 'learning', version: '1.0.0' }));
    activateGoalPlan(draft.id, { confirmed: true, reviewedAt: draft.updatedAt });

    const database = new DatabaseSync(process.env.BUILDYOURSELF_DB!);
    try {
      const row = database.prepare('SELECT id,plan_json FROM goal_plan_contract_versions WHERE goal_plan_id=?').get(draft.id) as {
        id: string; plan_json: string;
      };
      const stored = JSON.parse(row.plan_json);
      stored.domainTemplate = {
        ...stored.domainTemplate,
        version: '0.9.0',
        summary: '版本历史中保存的模板摘要',
      };
      database.prepare('UPDATE goal_plan_contract_versions SET plan_json=? WHERE id=?')
        .run(JSON.stringify(stored), row.id);
    } finally {
      database.close();
    }

    const snapshot = listGoalPlanContractVersions(draft.id)[0].plan.domainTemplate;
    expect(snapshot).toMatchObject({
      id: 'learning',
      version: '0.9.0',
      summary: '版本历史中保存的模板摘要',
    });
  });
});
