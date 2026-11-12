import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, saveEvidence } from '../lib/store';
import { confirmDailyPlan, generateAndSaveDailyPlan, getDailyPlan } from '../lib/daily-plan-store';
import { activateGoalPlan, createGoalProject, createTaskDecompositionProposal, linkGoalProjectEvidence, linkGoalProjectToGoal, listGoalPlanActions, listGoalProjects, markGoalPlanActionDone, resolveTaskDecompositionProposal, saveGoalPlanDraft, transitionGoalPlan, updateGoalPlanAction } from '../lib/goal-plans';
import { getHistoryCalendar } from '../lib/history-calendar';
import { filterHistoryDay, selectHistoryDay } from '../lib/history-calendar-view';
import { correctEvidence } from '../lib/milestone-store';
import { saveExternalCommitment } from '../lib/commitments';
import { GET as getEvidenceTargets } from '../app/api/evidence/targets/route';
import { PATCH as patchEvidence, POST as postEvidence } from '../app/api/evidence/route';
import { GET as getHistoryCalendarRoute } from '../app/api/history-calendar/route';

const dir = mkdtempSync(join(tmpdir(), 'buildyourself-history-calendar-'));
beforeEach(() => { process.env.BUILDYOURSELF_DB = join(dir, `${randomUUID()}.sqlite`); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function completePlan(title = '英语学习目标') {
  return {
    sourceIntent: '提升工作英语表达', title, domain: 'learning', context: '工作会议',
    domainTemplate: { id: 'learning', version: '1.0.0' },
    successDescription: '能独立主持一次英文同步。', observableResult: '保存一段会议录音并获得导师反馈。',
    baselineStatus: 'known', baselineAction: null,
    milestones: [{ title: '完成基线', stage: 'near', successCriteria: '录制一段三分钟介绍。', standardAssessment: 'reasonable', evidenceAvailability: 'available', reviewNote: '可以保存录音复查。', evidenceRequirement: '录音（E2）' }],
    nextActions: [{ title: '录制英文介绍', details: '准备并录音。', estimateMinutes: 20, specificity: 'concrete' }],
    constraints: { status: 'confirmed', items: [] },
    evidenceRequirements: [{ item: '英文表达', description: '保留录音', minimumLevel: 'E2' }], reviewCycleDays: 7,
  };
}

describe('只读历史日历', () => {
  it('按明确时区的完成日期展示行动，并把目标完成证据作为标记', () => {
    const draft = saveGoalPlanDraft(completePlan());
    activateGoalPlan(draft.id, { confirmed: true, reviewedAt: draft.updatedAt });
    const action = listGoalPlanActions(draft.id)[0];
    const database = openDatabase();
    try {
      database.prepare("UPDATE goal_plan_actions SET status='done', completed_at=?, updated_at=? WHERE id=?")
        .run('2026-11-04T01:00:00.000Z', '2026-11-08T10:00:00.000Z', action.id);
    } finally {
      database.close();
    }

    transitionGoalPlan(draft.id, {
      action: 'request_completion',
      evidence: [{ requirementId: draft.evidenceRequirements[0].id, description: '导师确认录音表达清晰。', level: 'E3', observedAt: '2026-11-04T01:00:00.000Z' }],
    });
    transitionGoalPlan(draft.id, { action: 'confirm_completion', confirmed: true });

    const history = getHistoryCalendar('America/Los_Angeles');
    expect(history.goals).toContainEqual({ id: draft.id, title: '英语学习目标', status: 'completed' });
    expect(history.days).toContainEqual(expect.objectContaining({
      date: '2026-11-03',
      activities: [expect.objectContaining({ kind: 'action', goalPlanId: draft.id, title: '录制英文介绍' })],
    }));
    const evidenceDay = history.days.find(day => day.evidence.some(item => item.description === '导师确认录音表达清晰。'));
    expect(evidenceDay?.date).toBe('2026-11-03');
    expect(evidenceDay?.evidence).toEqual([expect.objectContaining({ level: 'E3', description: '导师确认录音表达清晰。', observedAt: '2026-11-04T01:00:00.000Z' })]);
  });

  it('保留暂停目标的历史活动并排除草稿目标', () => {
    const paused = saveGoalPlanDraft(completePlan('后来暂停的目标'));
    const archived = saveGoalPlanDraft(completePlan('后来归档的目标'));
    activateGoalPlan(paused.id, { confirmed: true, reviewedAt: paused.updatedAt });
    activateGoalPlan(archived.id, { confirmed: true, reviewedAt: archived.updatedAt });
    const action = listGoalPlanActions(paused.id)[0];
    const archivedAction = listGoalPlanActions(archived.id)[0];
    markGoalPlanActionDone(action.id);
    markGoalPlanActionDone(archivedAction.id);
    transitionGoalPlan(paused.id, { action: 'pause', reason: '暂缓投入' });
    transitionGoalPlan(archived.id, { action: 'pause', reason: '暂缓投入' });
    transitionGoalPlan(archived.id, { action: 'archive', reason: '目标已归档' });
    const draft = saveGoalPlanDraft(completePlan('尚未启用的目标'));

    const history = getHistoryCalendar();
    expect(history.goals).toContainEqual(expect.objectContaining({ id: paused.id, status: 'paused' }));
    expect(history.goals).toContainEqual(expect.objectContaining({ id: archived.id, status: 'archived' }));
    expect(history.goals.map(goal => goal.id)).not.toContain(draft.id);
    expect(history.days.flatMap(day => day.activities)).toContainEqual(expect.objectContaining({ goalPlanId: paused.id, title: action.title }));
    expect(history.days.flatMap(day => day.activities)).toContainEqual(expect.objectContaining({ goalPlanId: archived.id, title: archivedAction.title }));
  });

  it('保存独立完成时间，后续编辑不会把行动移到另一天', () => {
    const draft = saveGoalPlanDraft(completePlan());
    activateGoalPlan(draft.id, { confirmed: true, reviewedAt: draft.updatedAt });
    const action = listGoalPlanActions(draft.id)[0];
    const completed = markGoalPlanActionDone(action.id);
    const edited = updateGoalPlanAction(action.id, { title: '补充行动说明' });

    expect(completed.completedAt).toBeTruthy();
    expect(edited.completedAt).toBe(completed.completedAt);
    const expectedDate = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(completed.completedAt!));
    expect(getHistoryCalendar().days[0].date).toBe(expectedDate);
  });

  it('任务拆分后拒绝把已替代父任务记成完成历史', () => {
    const draft = saveGoalPlanDraft(completePlan());
    activateGoalPlan(draft.id, { confirmed: true, reviewedAt: draft.updatedAt });
    const [parent] = listGoalPlanActions(draft.id);
    const proposal = createTaskDecompositionProposal(parent.id, { tasks: [
      { id: 'prepare', title: '准备材料', estimateMinutes: 30, successCriteria: '材料齐全', dependencyIds: [] },
      { id: 'review', title: '复核材料', estimateMinutes: 30, successCriteria: '复核完成', dependencyIds: ['prepare'] },
    ] });
    resolveTaskDecompositionProposal(proposal.id, { action: 'confirm' });

    expect(() => markGoalPlanActionDone(parent.id)).toThrow('已拆分');
    expect(getHistoryCalendar().days.flatMap(day => day.activities)).not.toContainEqual(expect.objectContaining({ id: parent.id }));
  });

  it('保留旧的无日期完成记录并明确标记日期不详', () => {
    const draft = saveGoalPlanDraft(completePlan());
    activateGoalPlan(draft.id, { confirmed: true, reviewedAt: draft.updatedAt });
    const action = listGoalPlanActions(draft.id)[0];
    const database = openDatabase();
    try {
      database.exec('ALTER TABLE goal_plan_actions DROP COLUMN completed_at');
      database.prepare("UPDATE goal_plan_actions SET status='done', updated_at=? WHERE id=?")
        .run('2026-11-04T10:00:00.000Z', action.id);
    } finally {
      database.close();
    }

    const history = getHistoryCalendar();
    expect(history.days).toEqual([]);
    expect(history.undatedActivities).toEqual([expect.objectContaining({ title: action.title, goalPlanId: draft.id })]);
  });

  it('不把未归属具体目标的通用证据混进目标日历', () => {
    const plan = saveGoalPlanDraft(completePlan());
    activateGoalPlan(plan.id, { confirmed: true, reviewedAt: plan.updatedAt });
    saveEvidence({
      text: '一次任务反馈', source: '用户反馈', reference: 'note-1', observedAt: '2026-11-05T10:00:00.000Z',
      links: ['task'], level: 'E2', reportSubmitted: true, benchmarkComplete: null, latencyMs: null,
    });

    saveExternalCommitment({
      sourceText: '普通外部日程', deliverable: '家庭聚会', deadline: null, goalPlanId: null,
      tasks: [{ title: '参加聚会', details: null, deadline: null, estimateMinutes: 60, dependencies: [], acceptanceCriteria: null }],
      uncertainFields: [
        { field: 'deadline', taskIndex: 0, reason: '日程没有明确截止时间' },
        { field: 'acceptanceCriteria', taskIndex: 0, reason: '普通日程没有任务验收要求' },
      ],
    });
    const history = getHistoryCalendar();
    expect(history.days).toEqual([]);
  });

  it('显式关联到目标行动的证据按 observedAt 入日历，并可按目标和日期筛选', () => {
    const firstGoal = saveGoalPlanDraft(completePlan('目标一'));
    const secondGoal = saveGoalPlanDraft(completePlan('目标二'));
    activateGoalPlan(firstGoal.id, { confirmed: true, reviewedAt: firstGoal.updatedAt });
    activateGoalPlan(secondGoal.id, { confirmed: true, reviewedAt: secondGoal.updatedAt });
    const firstAction = listGoalPlanActions(firstGoal.id)[0];
    const evidence = saveEvidence({
      text: '录音确认表达清晰', source: '导师反馈', reference: 'audio-review', observedAt: '2026-11-04T01:00:00.000Z',
      links: ['task'], goalPlanId: firstGoal.id, goalActionId: firstAction.id,
      level: 'E3', reportSubmitted: null, benchmarkComplete: null, latencyMs: null,
    });

    const history = getHistoryCalendar('America/Los_Angeles');
    const filtered = filterHistoryDay(history.days.find(day => day.date === '2026-11-03'), firstGoal.id);
    expect(filtered?.evidence).toEqual([expect.objectContaining({
      id: evidence.id, goalPlanId: firstGoal.id, goalActionId: firstAction.id,
      actionTitle: firstAction.title, observedAt: evidence.observedAt,
    })]);
    expect(filterHistoryDay(history.days.find(day => day.date === '2026-11-03'), secondGoal.id)?.evidence).toEqual([]);
    expect(filterHistoryDay(history.days.find(day => day.date === '2026-11-04'), firstGoal.id)).toBeUndefined();
  });

  it('更正证据归属或 observedAt 后，历史按新目标和新日期回查', () => {
    const firstGoal = saveGoalPlanDraft(completePlan('目标一'));
    const secondGoal = saveGoalPlanDraft(completePlan('目标二'));
    activateGoalPlan(firstGoal.id, { confirmed: true, reviewedAt: firstGoal.updatedAt });
    activateGoalPlan(secondGoal.id, { confirmed: true, reviewedAt: secondGoal.updatedAt });
    const firstAction = listGoalPlanActions(firstGoal.id)[0];
    const secondAction = listGoalPlanActions(secondGoal.id)[0];
    const evidence = saveEvidence({
      text: '录音确认表达清晰', source: '导师反馈', reference: 'audio-review', observedAt: '2026-11-04T01:00:00.000Z',
      links: ['task'], goalPlanId: firstGoal.id, goalActionId: firstAction.id,
      level: 'E3', reportSubmitted: null, benchmarkComplete: null, latencyMs: null,
    });

    const corrected = correctEvidence(evidence.id, {
      ...evidence, observedAt: '2026-11-06T12:00:00.000Z', goalPlanId: secondGoal.id, goalActionId: secondAction.id,
    });
    expect(corrected.changed).toBe(true);
    expect(corrected.evidence.revisions?.[0].before).toMatchObject({ goalPlanId: firstGoal.id, goalActionId: firstAction.id });
    expect(corrected.evidence.revisions?.[0].after).toMatchObject({ goalPlanId: secondGoal.id, goalActionId: secondAction.id });
    const history = getHistoryCalendar('America/Los_Angeles');
    expect(filterHistoryDay(history.days.find(day => day.date === '2026-11-03'), firstGoal.id)).toBeUndefined();
    expect(filterHistoryDay(history.days.find(day => day.date === '2026-11-06'), secondGoal.id)?.evidence).toEqual([
      expect.objectContaining({ id: evidence.id, goalActionId: secondAction.id, observedAt: '2026-11-06T12:00:00.000Z' }),
    ]);
  });

  it('拒绝把行动证据关联到另一个目标的行动', () => {
    const firstGoal = saveGoalPlanDraft(completePlan('目标一'));
    const secondGoal = saveGoalPlanDraft(completePlan('目标二'));
    activateGoalPlan(firstGoal.id, { confirmed: true, reviewedAt: firstGoal.updatedAt });
    activateGoalPlan(secondGoal.id, { confirmed: true, reviewedAt: secondGoal.updatedAt });
    const secondAction = listGoalPlanActions(secondGoal.id)[0];
    expect(() => saveEvidence({
      text: '证据', source: '用户', reference: 'note', observedAt: '2026-11-04T01:00:00.000Z',
      links: ['task'], goalPlanId: firstGoal.id, goalActionId: secondAction.id,
      level: 'E1', reportSubmitted: null, benchmarkComplete: null, latencyMs: null,
    })).toThrow('不属于该目标');
  });

  it('通过证据 API 选择目标和行动、保存并更正后可在历史日历中回查', async () => {
    const firstGoal = saveGoalPlanDraft(completePlan('目标一'));
    const secondGoal = saveGoalPlanDraft(completePlan('目标二'));
    activateGoalPlan(firstGoal.id, { confirmed: true, reviewedAt: firstGoal.updatedAt });
    activateGoalPlan(secondGoal.id, { confirmed: true, reviewedAt: secondGoal.updatedAt });
    const firstAction = listGoalPlanActions(firstGoal.id)[0];
    const secondAction = listGoalPlanActions(secondGoal.id)[0];

    const targetsResponse = getEvidenceTargets();
    const { targets } = await targetsResponse.json() as { targets: Array<{ id: string; actions: Array<{ id: string }> }> };
    expect(targets.map(target => target.id)).toEqual(expect.arrayContaining([firstGoal.id, secondGoal.id]));
    expect(targets.find(target => target.id === firstGoal.id)?.actions.map(action => action.id)).toContain(firstAction.id);

    const posted = await postEvidence(new Request('http://localhost/api/evidence', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '导师确认表达清晰', source: '导师反馈', reference: 'audio-review', observedAt: '2026-11-04T01:00:00.000Z',
        links: ['task'], goalPlanId: firstGoal.id, goalActionId: firstAction.id,
        level: 'E3', reportSubmitted: null, benchmarkComplete: null, latencyMs: null,
      }),
    }));
    expect(posted.status).toBe(201);
    const evidence = await posted.json() as { id: string };

    const beforeCorrectionResponse = await getHistoryCalendarRoute(new Request('http://localhost/api/history-calendar?timeZone=America%2FLos_Angeles'));
    const beforeCorrection = await beforeCorrectionResponse.json() as Awaited<ReturnType<typeof getHistoryCalendar>>;
    expect(selectHistoryDay(beforeCorrection, '2026-11-03', firstGoal.id)?.evidence).toContainEqual(
      expect.objectContaining({ id: evidence.id, observedAt: '2026-11-04T01:00:00.000Z' }),
    );

    const patched = await patchEvidence(new Request('http://localhost/api/evidence', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: evidence.id, text: '导师补充确认表达清晰', source: '导师反馈', reference: 'audio-review-v2', observedAt: '2026-11-06T01:00:00.000Z',
        links: ['task'], goalPlanId: secondGoal.id, goalActionId: secondAction.id,
        level: 'E3', reportSubmitted: null, benchmarkComplete: null, latencyMs: null,
      }),
    }));
    expect(patched.status).toBe(200);

    const historyResponse = await getHistoryCalendarRoute(new Request('http://localhost/api/history-calendar?timeZone=America%2FLos_Angeles'));
    const history = await historyResponse.json() as Awaited<ReturnType<typeof getHistoryCalendar>>;
    expect(selectHistoryDay(history, '2026-11-03', firstGoal.id)).toBeUndefined();
    expect(selectHistoryDay(history, '2026-11-05', secondGoal.id)?.evidence).toEqual([
      expect.objectContaining({ id: evidence.id, goalActionId: secondAction.id, observedAt: '2026-11-06T01:00:00.000Z' }),
    ]);
  });

  it('更正行动证据归属后保留共享项目的证据链接', () => {
    const firstGoal = saveGoalPlanDraft(completePlan('项目目标一'));
    const secondGoal = saveGoalPlanDraft(completePlan('项目目标二'));
    activateGoalPlan(firstGoal.id, { confirmed: true, reviewedAt: firstGoal.updatedAt });
    activateGoalPlan(secondGoal.id, { confirmed: true, reviewedAt: secondGoal.updatedAt });
    const firstAction = listGoalPlanActions(firstGoal.id)[0];
    const secondAction = listGoalPlanActions(secondGoal.id)[0];
    const project = createGoalProject({ title: '跨目标共享项目', goalPlanId: firstGoal.id });
    linkGoalProjectToGoal(project.id, { goalPlanId: secondGoal.id });
    const evidence = saveEvidence({
      text: '完成验收记录', source: '用户', reference: 'acceptance-1', observedAt: '2026-11-04T01:00:00.000Z',
      links: ['task'], goalPlanId: firstGoal.id, goalActionId: firstAction.id,
      level: 'E2', reportSubmitted: true, benchmarkComplete: null, latencyMs: null,
    });
    linkGoalProjectEvidence(project.id, evidence.id);

    correctEvidence(evidence.id, {
      ...evidence, text: '补充后的验收记录', observedAt: '2026-11-06T01:00:00.000Z',
      goalPlanId: secondGoal.id, goalActionId: secondAction.id,
    });

    const linkedEvidence = listGoalProjects().find(item => item.id === project.id)?.evidence;
    expect(linkedEvidence).toContainEqual(expect.objectContaining({
      id: evidence.id, goalPlanId: secondGoal.id, goalActionId: secondAction.id, text: '补充后的验收记录',
    }));
    const history = getHistoryCalendar('America/Los_Angeles');
    expect(history.days.find(day => day.date === '2026-11-05')?.evidence).toContainEqual(expect.objectContaining({
      id: evidence.id, goalPlanId: secondGoal.id, goalActionId: secondAction.id,
    }));
  });

  it('已确认周计划仍是安排记录，只有显式完成记录才进入历史', () => {
    const draft = saveGoalPlanDraft(completePlan());
    activateGoalPlan(draft.id, { confirmed: true, reviewedAt: draft.updatedAt });
    const [action] = listGoalPlanActions(draft.id);
    const weekStart = '2020-11-09';
    const planned = generateAndSaveDailyPlan(weekStart);
    const scheduledDate = planned.days.find(day => day.actions.some(item => item.actionId === action.id))!.date;
    confirmDailyPlan(weekStart);

    expect(getDailyPlan(weekStart).status).toBe('confirmed');
    expect(getHistoryCalendar('Asia/Shanghai').days).toEqual([]);

    const completed = markGoalPlanActionDone(action.id);
    const expectedDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(completed.completedAt!));
    expect(getDailyPlan(weekStart).status).toBe('confirmed');
    const historyDate = getHistoryCalendar('Asia/Shanghai').days[0].date;
    expect(historyDate).toBe(expectedDate);
    expect(historyDate).not.toBe(scheduledDate);
  });

  it('拒绝无效时区，避免静默回退到服务器时区', () => {
    expect(() => getHistoryCalendar('Not/A_Time_Zone')).toThrow();
  });
});
