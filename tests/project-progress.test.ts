import { describe, expect, it } from 'vitest';
import type { Evidence } from '../lib/model';
import type { GoalPlanAction, GoalProject } from '../lib/goal-plans';
import { deriveProjectProgress } from '../lib/project-progress';
import type { ProjectMeasurementSeries } from '../lib/project-measurement-series';

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

function series(evidenceIds: string[], overrides: Partial<ProjectMeasurementSeries> = {}): ProjectMeasurementSeries {
  return {
    id: 'series-1', projectId: 'project-1', name: '相同负载基准', basis: '相同工作负载、环境和延迟口径',
    confirmedComparableAt: '2026-11-02T00:00:00.000Z', createdAt: '2026-11-02T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    evidence: evidenceIds.map(evidenceId => ({ evidenceId, confirmedAt: '2026-11-02T00:00:00.000Z' })), ...overrides,
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

  it('无序列归属时把完整观测逐条展示，不计算趋势差值', () => {
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

    expect(model.trend.unassignedObservations).toEqual([expect.objectContaining({ id: 'single-e1', value: 350 })]);
    expect(model.trend.series).toEqual([]);
    expect(model.trend.applicableRule).toBeNull();
    expect(model.milestones[0].evidenceStatus).not.toContain('达标');
    expect(model.milestones[0]).not.toHaveProperty('outcome');
  });

  it('即使字段相同，未明确分组的来源和条件也不跨记录比较', () => {
    const model = deriveProjectProgress(project({ evidence: [
      evidence({ id: 'workload-b', text: '工作负载 B，本地环境', source: '本地手工测试', reference: 'run-local', observedAt: '2026-11-03T10:00:00.000Z', latencyMs: 324, level: 'E3' }),
      evidence({ id: 'workload-a', text: '工作负载 A，CI 环境', source: 'CI', reference: 'run-ci', observedAt: '2026-11-01T10:00:00.000Z', latencyMs: 350, level: 'E2' }),
    ] }), [action()]);

    expect(model.trend.unassignedObservations.map(item => item.id)).toEqual(['workload-a', 'workload-b']);
    expect(model.trend.series).toEqual([]);
    expect(model.trend.applicableRule).toBeNull();
    expect(model.evidence.sources).toEqual(['CI', '本地手工测试']);
  });

  it('只在用户确认的同口径序列内计算趋势，并让未选记录保持单次展示', () => {
    const report = project({ evidence: [
      evidence({ id: 'comparable-later', text: '负载 A、staging、版本 v1', source: '手工测试', observedAt: '2026-11-03T10:00:00.000Z', latencyMs: 324 }),
      evidence({ id: 'comparable-earlier', text: '负载 A、staging、版本 v1', source: 'CI', observedAt: '2026-11-01T10:00:00.000Z', latencyMs: 350 }),
      evidence({ id: 'different-workload', text: '负载 B、本地环境、版本 v2', source: '性能平台', observedAt: '2026-11-02T10:00:00.000Z', latencyMs: 120 }),
    ] });
    const model = deriveProjectProgress(report, [action()], [], [series(['comparable-later', 'comparable-earlier'])]);

    expect(model.trend.series[0]).toMatchObject({
      name: '相同负载基准', basis: '相同工作负载、环境和延迟口径',
      observations: [expect.objectContaining({ id: 'comparable-earlier' }), expect.objectContaining({ id: 'comparable-later' })],
      firstToLastDeltaMs: -26, gap: null,
    });
    expect(model.trend.unassignedObservations).toEqual([expect.objectContaining({ id: 'different-workload', value: 120 })]);
  });

  it('其他项目的比较序列不会吸收或隐藏当前项目的观测', () => {
    const report = project({ evidence: [evidence({ id: 'project-1-run' })] });
    const model = deriveProjectProgress(report, [action()], [], [series(['project-1-run'], { projectId: 'project-2' })]);

    expect(model.trend.series).toEqual([]);
    expect(model.trend.unassignedObservations).toEqual([expect.objectContaining({ id: 'project-1-run', value: 350 })]);
  });

  it('归组记录更正后若不再是完整延迟测量，就不纳入差值', () => {
    const report = project({ evidence: [
      evidence({ id: 'valid', observedAt: '2026-11-01T10:00:00.000Z', latencyMs: 350 }),
      evidence({ id: 'corrected-invalid', observedAt: '2026-11-02T10:00:00.000Z', lastCorrectedAt: '2026-11-03T10:00:00.000Z', latencyMs: 324, benchmarkComplete: false }),
      evidence({ id: 'corrected-valid', observedAt: '2026-11-02T10:00:00.000Z', lastCorrectedAt: '2026-11-03T10:00:00.000Z', latencyMs: 324, benchmarkComplete: true }),
    ] });
    const model = deriveProjectProgress(report, [action()], [], [series(['valid', 'corrected-invalid', 'corrected-valid'])]);

    expect(model.trend.series[0]).toMatchObject({
      observations: [expect.objectContaining({ id: 'valid', value: 350 })],
      excludedEvidence: [
        expect.objectContaining({ id: 'corrected-invalid', reference: 'run-1', source: '测试报告', canReconfirm: false }),
        expect.objectContaining({ id: 'corrected-valid', canReconfirm: true }),
      ],
      firstToLastDeltaMs: null,
    });
    expect(model.trend.series[0].gap).toContain('未计算差值');
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
