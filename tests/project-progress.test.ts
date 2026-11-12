import { describe, expect, it } from 'vitest';
import type { Evidence } from '../lib/model';
import type { GoalPlanAction, GoalProject } from '../lib/goal-plans';
import { deriveProjectProgress } from '../lib/project-progress';

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'evidence-1', text: '观测记录', source: '测试报告', reference: 'run-1',
    observedAt: '2026-11-01T10:00:00.000Z', createdAt: '2026-11-01T11:00:00.000Z',
    links: ['milestone'], goalPlanId: 'goal-1', goalActionId: 'action-1', level: 'E2',
    reportSubmitted: null, latencyMs: 350, benchmarkComplete: true,
    ...overrides,
  };
}

function project(overrides: Partial<GoalProject> = {}): GoalProject {
  return {
    id: 'project-1', title: '真实交付项目', primaryGoalPlanId: 'goal-1',
    goals: [{ goalPlanId: 'goal-1', title: '性能目标', status: 'active' }],
    milestones: [{
      goalPlanId: 'goal-1', goalTitle: '性能目标', milestone: {
        id: 'milestone-1', title: '响应阶段', stage: 'near',
        successCriteria: '项目要求另行核对', standardAssessment: 'reasonable',
        evidenceAvailability: 'available', reviewNote: null, evidenceRequirement: '完整测量',
      },
    }],
    evidence: [], createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function action(overrides: Partial<GoalPlanAction> = {}): GoalPlanAction {
  return {
    id: 'action-1', goalPlanId: 'goal-1', projectId: 'project-1', goalTitle: '性能目标',
    projectName: '真实交付项目', title: '运行完整基准测试', details: null, deadline: null,
    estimateMinutes: 30, dependencyIds: [], successCriteria: null, evidenceRequirement: null,
    priority: 'medium', hardDeadline: null, milestoneId: 'milestone-1', milestoneTitle: '响应阶段',
    milestoneCriteria: '项目要求另行核对', dependsOn: [], status: 'done', parentActionId: null,
    decomposedAt: null, completedAt: '2026-11-01T09:00:00.000Z',
    createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T09:00:00.000Z',
    ...overrides,
  };
}

describe('项目进展视图的数据语义', () => {
  it('没有固定交付清单时不把任务完成数伪装成百分比', () => {
    const model = deriveProjectProgress(project(), [action()]);

    expect(model.deliverables.available).toBe(false);
    expect(model.deliverables.reason).toContain('固定交付物');
    expect(model.deliverables.reason).toContain('分母');
    expect(model.deliverables.percent).toBeNull();
  });

  it('只把显式关联到里程碑行动的证据列入该里程碑，E2/E3 也不直接代表达成', () => {
    const model = deriveProjectProgress(project({ evidence: [
      evidence({ id: 'milestone-evidence', level: 'E2' }),
      evidence({ id: 'other-action', goalActionId: 'action-2', level: 'E3' }),
      evidence({ id: 'cross-project-action', goalActionId: 'foreign-action', level: 'E3' }),
      evidence({ id: 'unowned', goalPlanId: null, goalActionId: null, level: 'E3' }),
    ] }), [action(), action({ id: 'foreign-action', projectId: 'project-2' })]);

    expect(model.milestones[0]).toMatchObject({
      evidenceIds: ['milestone-evidence'], evidenceStatus: '含可验证证据',
    });
    expect(model.milestones[0].gap).toContain('尚未记录结构化的里程碑达成结果');
  });

  it('只用完整基准测试构成观测序列，单次观测不套用全局阈值', () => {
    const model = deriveProjectProgress(project({
      milestones: [{
        goalPlanId: 'goal-1', goalTitle: '性能目标', milestone: {
          id: 'milestone-1', title: '响应阶段', stage: 'near',
          successCriteria: '本项目要求延迟低于 50 ms', standardAssessment: 'reasonable',
          evidenceAvailability: 'available', reviewNote: null, evidenceRequirement: '完整测量',
        },
      }],
      evidence: [
        evidence({ id: 'single-e1', level: 'E1', latencyMs: 350 }),
        evidence({ id: 'incomplete', latencyMs: 12, benchmarkComplete: false }),
        evidence({ id: 'other-node', links: ['task'], latencyMs: 10 }),
      ],
    }), [action()]);

    expect(model.trend.observations).toEqual([expect.objectContaining({ id: 'single-e1', value: 350 })]);
    expect(model.trend.kind).toBe('single');
    expect(model.trend.gap).toContain('无法判断趋势');
    expect(model.trend.applicableRule).toBeNull();
  });

  it('多个同一结构化指标按实际观测时间稳定排序并只报告数值变化', () => {
    const model = deriveProjectProgress(project({ evidence: [
      evidence({ id: 'later', observedAt: '2026-11-03T10:00:00.000Z', createdAt: '2026-11-03T11:00:00.000Z', lastCorrectedAt: '2026-11-08T11:00:00.000Z', latencyMs: 324, level: 'E3' }),
      evidence({ id: 'earlier', observedAt: '2026-11-01T10:00:00.000Z', latencyMs: 350, level: 'E2' }),
    ] }), [action()]);

    expect(model.trend.observations.map(item => item.id)).toEqual(['earlier', 'later']);
    expect(model.trend.kind).toBe('series');
    expect(model.trend.firstToLastDeltaMs).toBe(-26);
    expect(model.trend.applicableRule).toBeNull();
    expect(model.evidence.sources).toEqual(['测试报告']);
    expect(model.evidence.updatedAt).toBe('2026-11-08T11:00:00.000Z');
  });

  it('仅按用户明确保存的交付物清单和状态计算确定分母', () => {
    const model = deriveProjectProgress(project(), [action()], [
      { id: 'one', projectId: 'project-1', title: '源码', completed: true, position: 0, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T01:00:00.000Z' },
      { id: 'two', projectId: 'project-1', title: '验收报告', completed: false, position: 1, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' },
      { id: 'three', projectId: 'project-1', title: '发布记录', completed: false, position: 2, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' },
    ]);

    expect(model.deliverables).toMatchObject({ available: true, total: 3, completed: 1, percent: 33, reason: null });
  });
});
