import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activateGoalPlan, saveGoalPlanDraft } from '../lib/goal-plans';
import { confirmDailyPlan, generateAndSaveDailyPlan, getDailyPlan } from '../lib/daily-plan-store';
import { saveExternalCommitment, listExternalCommitments } from '../lib/commitments';
import { listGoalPlanActions, updateGoalPlanAction } from '../lib/goal-plans';
import { createReplanProposal, decideReplanProposal, editReplanProposal, listReplanProposals } from '../lib/replanning';

const dir = mkdtempSync(join(tmpdir(), 'buildyourself-replanning-'));
beforeEach(() => { process.env.BUILDYOURSELF_DB = join(dir, `${randomUUID()}.sqlite`); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function goal() {
  const draft = saveGoalPlanDraft({
    sourceIntent: '准备英语展示', title: '英语目标', domain: 'learning', successDescription: '完成展示', observableResult: '提交录音',
    baselineStatus: 'known', constraints: { status: 'confirmed', items: [] },
    milestones: [{ title: '完成展示', stage: 'near', successCriteria: '提交完整录音', standardAssessment: 'reasonable', evidenceAvailability: 'available', reviewNote: '可通过提交记录核实', evidenceRequirement: '提交记录' }],
    nextActions: [{ id: 'practice', title: '练习口语', estimateMinutes: 60, hardDeadline: '2026-11-12', specificity: 'concrete' }],
    evidenceRequirements: [{ item: '录音', description: '保存录音', minimumLevel: 'E2' }], reviewCycleDays: 7,
  });
  activateGoalPlan(draft.id);
  return draft.id;
}

function commitment(goalPlanId: string) {
  return saveExternalCommitment({
    sourceText: '周三交大纲，周五交成果。', deliverable: '课程展示', deadline: null, goalPlanId,
    tasks: [
      { title: '提交大纲', details: null, deadline: '2026-11-11', estimateMinutes: 30, dependencies: [], acceptanceCriteria: '提交一页大纲' },
      { title: '提交成果', details: null, deadline: '2026-11-13', estimateMinutes: 60, dependencies: ['提交大纲'], acceptanceCriteria: '提交完整录音' },
    ], uncertainFields: [],
  });
}

describe('重排建议', () => {
  it('保留多项外部截止，展示变化原因，并在接受后保存计划版本', () => {
    const goalPlanId = goal();
    const initial = generateAndSaveDailyPlan('2026-11-09');
    const saved = commitment(goalPlanId);
    const proposal = createReplanProposal({ weekStart: '2026-11-09', trigger: 'new_commitment', reason: '收到课程展示通知' });

    expect(proposal.status).toBe('draft');
    expect(proposal.plan.days.find(day => day.actions.some(action => action.title === '提交大纲'))?.actions.find(action => action.title === '提交大纲')?.hardDeadline).toBe('2026-11-11');
    expect(proposal.plan.days.find(day => day.actions.some(action => action.title === '提交成果'))?.actions.find(action => action.title === '提交成果')?.hardDeadline).toBe('2026-11-13');
    expect(proposal.plan.days.find(day => day.actions.some(action => action.title === '提交大纲'))?.date).toBe('2026-11-11');
    expect(proposal.plan.days.find(day => day.actions.some(action => action.title === '提交成果'))?.date).toBe('2026-11-13');
    expect(proposal.changes.some(change => change.title === '练习口语' && change.fromDate === change.toDate)).toBe(false);
    expect(getDailyPlan('2026-11-09').plan).toEqual(initial);
    expect(listExternalCommitments()[0].status).toBe('pending_schedule');

    const accepted = decideReplanProposal(proposal.id, 'accept');
    expect(accepted).toMatchObject({ status: 'accepted', version: 1 });
    expect(getDailyPlan('2026-11-09')).toMatchObject({ status: 'confirmed', plan: proposal.plan });
    expect(listExternalCommitments().find(item => item.id === saved.id)?.status).toBe('scheduled');
    expect(listReplanProposals('2026-11-09')).toEqual([accepted]);
  });

  it('可编辑日期，拒绝后保留原计划和未排入承诺', () => {
    const goalPlanId = goal();
    const initial = generateAndSaveDailyPlan('2026-11-09');
    const saved = commitment(goalPlanId);
    const proposal = createReplanProposal({ weekStart: '2026-11-09', trigger: 'capacity_change', reason: '周一可用时间减少' });
    const firstTask = proposal.plan.days.flatMap(day => day.actions).find(action => action.title === '提交大纲')!;
    const secondTask = proposal.plan.days.flatMap(day => day.actions).find(action => action.title === '提交成果')!;
    const edited = editReplanProposal(proposal.id, { [firstTask.actionId]: '2026-11-10', [secondTask.actionId]: '2026-11-11' });
    expect(edited.plan.days.find(day => day.date === '2026-11-10')?.actions.map(action => action.actionId)).toContain(firstTask.actionId);
    decideReplanProposal(proposal.id, 'reject');

    expect(getDailyPlan('2026-11-09').plan).toEqual(initial);
    expect(listExternalCommitments().find(item => item.id === saved.id)?.status).toBe('pending_schedule');
    expect(() => editReplanProposal(proposal.id, {})).toThrow('已经处理');
  });

  it('编辑不能超过容量或突破任务硬截止', () => {
    const goalPlanId = goal();
    generateAndSaveDailyPlan('2026-11-09', { '2026-11-09': 30 });
    commitment(goalPlanId);
    const proposal = createReplanProposal({ weekStart: '2026-11-09', trigger: 'constraint_change', reason: '新增时间限制' });
    const action = proposal.plan.days.flatMap(day => day.actions).find(item => item.title === '提交成果')!;
    expect(() => editReplanProposal(proposal.id, { [action.actionId]: '2026-11-09' })).toThrow('容量不足');
    expect(() => editReplanProposal(proposal.id, { [action.actionId]: '2026-11-14' })).toThrow('硬截止');
  });

  it('使用当前权威任务字段，并阻止过期建议覆盖新计划', () => {
    const goalPlanId = goal();
    generateAndSaveDailyPlan('2026-11-09');
    const action = listGoalPlanActions(goalPlanId)[0];
    updateGoalPlanAction(action.id, { title: '按新范围练习口语', deadline: '2026-11-13', estimateMinutes: 90 });
    const first = createReplanProposal({ weekStart: '2026-11-09', trigger: 'scope_change', reason: '任务范围扩大' });
    const second = createReplanProposal({ weekStart: '2026-11-09', trigger: 'deadline_change', reason: '截止日期变化' });
    expect(first.plan.days.flatMap(day => day.actions).some(item => item.title === '按新范围练习口语')).toBe(true);
    expect(first.changes.find(change => change.actionId === action.id)?.reason).toContain('范围');
    decideReplanProposal(first.id, 'accept');
    expect(() => decideReplanProposal(second.id, 'accept')).toThrow('已发生变化');
  });

  it('接受移除原安排的重排后，将原已排期行动放回待排状态', () => {
    const goalPlanId = goal();
    generateAndSaveDailyPlan('2026-11-09');
    confirmDailyPlan('2026-11-09');
    const originalAction = listGoalPlanActions(goalPlanId)[0];
    commitment(goalPlanId);
    const zeroCapacity = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`2026-11-${String(9 + index).padStart(2, '0')}`, 0]));
    const proposal = createReplanProposal({ weekStart: '2026-11-09', trigger: 'capacity_change', reason: '本周无法投入时间', capacities: zeroCapacity });
    expect(proposal.plan.unplaced.some(item => item.action.id === originalAction.id)).toBe(true);
    decideReplanProposal(proposal.id, 'accept');
    expect(listGoalPlanActions(goalPlanId).find(item => item.id === originalAction.id)?.status).toBe('pending_schedule');
  });

  it('不把其他周已经排期的行动复制到本周建议', () => {
    const goalPlanId = goal();
    generateAndSaveDailyPlan('2026-11-09');
    confirmDailyPlan('2026-11-09');
    const scheduledAction = listGoalPlanActions(goalPlanId)[0];
    const proposal = createReplanProposal({ weekStart: '2026-11-16', trigger: 'execution_deviation', reason: '本周发生重大执行偏差' });
    expect(proposal.plan.days.flatMap(day => day.actions).some(action => action.actionId === scheduledAction.id)).toBe(false);
    expect(proposal.plan.unplaced.some(item => item.action.id === scheduledAction.id)).toBe(false);
  });
});
