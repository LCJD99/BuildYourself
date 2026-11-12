import { openDatabase, getTaskExecution, listEvidence } from './store';
import { evaluate, nodes, type Evidence } from './model';
import { evaluateMilestone } from './milestone-review';
import { getDailyPlan } from './daily-plan-store';
import { getMilestoneConfirmation, listChangeEvents } from './milestone-store';
import { listReplanProposals } from './replanning';

type GoalAssociatedEvidence = Evidence & { goalPlanId?: string | null; goalActionId?: string | null };

export type WeeklyReviewAdjustment = {
  kind: 'measure' | 'practice';
  goalTitle: string;
  milestoneId: string;
  milestoneTitle: string;
  title: string;
  rationale: string;
  expectedResult: string;
  verificationDate: string;
  modifiedByUser: boolean;
};

export type WeeklyReview = {
  weekStart: string;
  weekEnd: string;
  executionEffort: {
    planStatus: 'missing' | 'draft' | 'confirmed';
    plannedActionCount: number;
    plannedMinutes: number;
    unplacedActionCount: number;
    executionRecordCount: number;
    actualEffortAvailable: false;
  };
  plannedActions: string[];
  evidence: Array<Pick<Evidence, 'id' | 'observedAt' | 'text' | 'source' | 'reference' | 'level' | 'links'>>;
  exampleGraph: {
    goalTitle: string;
    milestoneTitle: string;
    delivery: { status: string; detail: string; evidenceIds: string[] };
    capability: { status: string; detail: string; evidenceIds: string[] };
    evidenceGaps: string[];
  };
  deviations: string[];
  facts: string[];
  hypotheses: string[];
  adjustment: WeeklyReviewAdjustment;
};

export type WeeklyReviewRecord = { review: WeeklyReview; status: 'draft' | 'saved'; savedAt: string | null };

function assertWeekStart(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('周起始日期必须是有效的 YYYY-MM-DD 日期。');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || date.getUTCDay() !== 1) {
    throw new Error('周起始日期必须是有效的星期一。');
  }
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function isWithinWeek(value: string, weekStart: string, nextWeekStart: string) {
  const observedAt = new Date(value);
  if (!Number.isFinite(observedAt.getTime())) return false;
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(observedAt);
  const part = (type: 'year' | 'month' | 'day') => parts.find(item => item.type === type)!.value;
  const observedDate = `${part('year')}-${part('month')}-${part('day')}`;
  return observedDate >= weekStart && observedDate < nextWeekStart;
}

function makeAdjustment(weekStart: string, milestoneStatus: string, evidence: Evidence[]): WeeklyReviewAdjustment {
  const goalTitle = nodes.find(node => node.id === 'goal')!.title;
  const milestoneTitle = nodes.find(node => node.id === 'milestone')!.title;
  const verificationDate = addDays(weekStart, 13);
  const measured = [...evidence].filter(item => item.links.includes('milestone')
    && item.benchmarkComplete === true && typeof item.latencyMs === 'number'
    && (item.level === 'E2' || item.level === 'E3'))
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt) || b.createdAt.localeCompare(a.createdAt))[0];
  if (milestoneStatus === '本次实测未达标') {
    return {
      kind: 'practice', goalTitle, milestoneId: 'milestone', milestoneTitle,
      title: '下一次完整基准测试只调整一个参数',
      rationale: `本周符合证据要求的完整实测为 ${measured?.latencyMs ?? '未记录'} ms，仍未低于 200 ms；当前记录支持调整做法并复测。`,
      expectedResult: '在其他测试条件保持一致时，复测延迟低于 200 ms；若仍未达标，也能判断这次单项调整是否带来变化。',
      verificationDate,
      modifiedByUser: false,
    };
  }
  if (milestoneStatus === '达到标准，待确认' || milestoneStatus === '已确认达成') {
    return {
      kind: 'measure', goalTitle, milestoneId: 'milestone', milestoneTitle,
      title: '下周在相同条件下复测一次',
      rationale: `本周符合证据要求的完整实测为 ${measured?.latencyMs ?? '未记录'} ms，达到当前标准；单次结果还不能说明表现稳定。`,
      expectedResult: '在相同条件下再次取得完整 E2 或 E3 测量，并核对延迟是否仍低于 200 ms。',
      verificationDate,
      modifiedByUser: false,
    };
  }
  return {
    kind: 'measure', goalTitle, milestoneId: 'milestone', milestoneTitle,
    title: '补做一次完整基准测试并保存可复核结果',
    rationale: '本周没有足以判断该里程碑的完整 E2/E3 实测；先补齐测量，再判断是否需要改变做法。',
    expectedResult: '获得一条包含完整测试条件和延迟数值的 E2 或 E3 证据，能够核对是否低于 200 ms。',
    verificationDate,
    modifiedByUser: false,
  };
}

export function generateWeeklyReview(weekStart: string): WeeklyReview {
  assertWeekStart(weekStart);
  const weekEnd = addDays(weekStart, 6);
  const nextWeekStart = addDays(weekStart, 7);
  const planRecord = getDailyPlan(weekStart);
  const plan = planRecord.plan;
  const plannedActions = plan?.days.flatMap(day => day.actions) ?? [];
  const plannedActionDetails = plan?.days.flatMap(day => day.actions.map(action => `${day.date} · ${action.goalTitle}：${action.title}（估算 ${action.estimateMinutes} 分钟）`)) ?? [];
  const unplaced = plan?.unplaced ?? [];
  const weekEvidence = listEvidence().filter(item => isWithinWeek(item.observedAt, weekStart, nextWeekStart)) as GoalAssociatedEvidence[];
  const evidence = weekEvidence.filter(item => !item.goalPlanId && !item.goalActionId);
  const [deliveryResult] = evaluate(evidence);
  const capabilityResult = evaluateMilestone(evidence, getMilestoneConfirmation());
  const execution = getTaskExecution();
  const executionRecordCount = execution.completedAt && isWithinWeek(execution.completedAt, weekStart, nextWeekStart) ? 1 : 0;
  const changes = listChangeEvents().filter(event => isWithinWeek(event.createdAt, weekStart, nextWeekStart));
  const replans = listReplanProposals(weekStart);
  const planStatus = planRecord.plan ? planRecord.status! : 'missing';
  const plannedMinutes = plannedActions.reduce((sum, action) => sum + action.estimateMinutes, 0);
  const actualEffortAvailable = false as const;
  const evidenceGaps = [...new Set([deliveryResult.gap, capabilityResult.gap].filter(gap => gap !== '无'))];
  const deviations = [
    ...unplaced.map(item => `「${item.action.title}」未排入：${item.reason}`),
    ...replans.filter(proposal => proposal.status === 'accepted').flatMap(proposal => proposal.changes.map(change => `重排「${change.title}」：${change.reason}`)),
    ...changes.filter(event => event.eventType === 'task.updated').map(event => `目标任务变更记录：${event.summary}`),
  ];
  const facts = [
    plan
      ? `本周${planStatus === 'confirmed' ? '已确认' : '尚未确认'}计划安排 ${plannedActions.length} 项行动，估算计划投入 ${plannedMinutes} 分钟；另有 ${unplaced.length} 项未排入。该分钟数是计划估算，不是实际工时。`
      : '本周没有保存的周计划，无法从计划记录计算预期投入。',
    `示例目标「${nodes.find(node => node.id === 'goal')!.title}」的交付记录：${deliveryResult.status}。${deliveryResult.detail}`,
    `示例目标「${nodes.find(node => node.id === 'goal')!.title}」的里程碑记录：${capabilityResult.status}。${capabilityResult.detail}`,
    executionRecordCount
      ? '本周有一条全局任务完成记录，但它没有关联到具体周计划行动。'
      : '本周没有与当前任务对应的完成时间记录。',
    `系统目前没有逐项行动完成状态或实际工时记录；本复盘不会据计划安排推断实际投入。`,
    ...changes.filter(event => event.eventType !== 'task.updated').map(event => `记录变更：${event.summary}`),
    ...replans.filter(proposal => proposal.status !== 'accepted').map(proposal => `有一份${proposal.status === 'draft' ? '未确认' : '已拒绝'}的重排建议：「${proposal.triggerReason}」。`),
  ];
  const hypotheses = unplaced.length
    ? ['未排入记录显示容量或依赖可能解释计划偏差；它不能证明实际执行情况。']
    : [];
  if (capabilityResult.status === '证据不足') hypotheses.push('缺少合格测量可能掩盖真实进展，也可能意味着本周尚未验证能力变化。');
  else if (capabilityResult.status === '本次实测未达标') hypotheses.push('测试方法或其中一个参数可能影响结果；需要单变量复测来验证。');
  else hypotheses.push('单次测量达到标准仍不能证明长期能力已经稳定提升。');
  if (!hypotheses.length) hypotheses.push('目前记录只能描述计划和结果，尚不能确认计划偏差背后的原因。');

  return {
    weekStart,
    weekEnd,
    executionEffort: {
      planStatus, plannedActionCount: plannedActions.length, plannedMinutes, unplacedActionCount: unplaced.length,
      executionRecordCount, actualEffortAvailable,
    },
    plannedActions: plannedActionDetails,
    evidence: evidence.map(({ id, observedAt, text, source, reference, level, links }) => ({ id, observedAt, text, source, reference, level, links })),
    exampleGraph: {
      goalTitle: nodes.find(node => node.id === 'goal')!.title,
      milestoneTitle: nodes.find(node => node.id === 'milestone')!.title,
      delivery: { status: deliveryResult.status, detail: deliveryResult.detail, evidenceIds: deliveryResult.evidence.map(item => item.id) },
      capability: { status: capabilityResult.status, detail: capabilityResult.detail, evidenceIds: capabilityResult.evidenceIds },
      evidenceGaps,
    },
    deviations,
    facts,
    hypotheses,
    adjustment: makeAdjustment(weekStart, capabilityResult.status, evidence),
  };
}

function ensureSchema() {
  const database = openDatabase();
  database.exec(`CREATE TABLE IF NOT EXISTS weekly_reviews (
    week_start TEXT PRIMARY KEY,
    review_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'saved')),
    saved_at TEXT
  )`);
  return database;
}

function readRecord(database: ReturnType<typeof openDatabase>, weekStart: string): WeeklyReviewRecord | null {
  const row = database.prepare('SELECT review_json, status, saved_at FROM weekly_reviews WHERE week_start=?').get(weekStart) as { review_json: string; status: 'draft' | 'saved'; saved_at: string | null } | undefined;
  return row ? { review: JSON.parse(row.review_json) as WeeklyReview, status: row.status, savedAt: row.saved_at } : null;
}

function validateAdjustment(input: unknown, generated: WeeklyReviewAdjustment, weekStart: string): WeeklyReviewAdjustment {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('复盘调整内容无效。');
  const value = input as Record<string, unknown>;
  const text = (key: 'title' | 'rationale' | 'expectedResult', label: string, maxLength: number) => {
    const item = value[key];
    if (typeof item !== 'string' || !item.trim() || item.trim().length > maxLength) throw new Error(`${label}不能为空且不能超过 ${maxLength} 字。`);
    return item.trim();
  };
  const verificationDate = value.verificationDate;
  if (typeof verificationDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(verificationDate)) throw new Error('请填写有效的验证日期。');
  const parsed = new Date(`${verificationDate}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== verificationDate || verificationDate <= addDays(weekStart, 6)) {
    throw new Error('验证日期必须是本周结束后的有效日期。');
  }
  const title = text('title', '调整建议', 240);
  const rationale = text('rationale', '建议依据', 500);
  const expectedResult = text('expectedResult', '预期结果', 500);
  return {
    ...generated,
    title,
    rationale,
    expectedResult,
    verificationDate,
    modifiedByUser: title !== generated.title || rationale !== generated.rationale
      || expectedResult !== generated.expectedResult || verificationDate !== generated.verificationDate,
  };
}

export function getWeeklyReview(weekStart: string): WeeklyReviewRecord {
  assertWeekStart(weekStart);
  const initial = ensureSchema();
  let existing: WeeklyReviewRecord | null;
  try {
    existing = readRecord(initial, weekStart);
  } finally {
    initial.close();
  }
  if (existing) return existing;

  const generated = generateWeeklyReview(weekStart);
  const database = ensureSchema();
  let inTransaction = false;
  try {
    database.exec('BEGIN IMMEDIATE');
    inTransaction = true;
    existing = readRecord(database, weekStart);
    if (existing) {
      database.exec('COMMIT');
      inTransaction = false;
      return existing;
    }
    database.prepare("INSERT INTO weekly_reviews (week_start, review_json, status, saved_at) VALUES (?, ?, 'draft', NULL)")
      .run(weekStart, JSON.stringify(generated));
    database.exec('COMMIT');
    inTransaction = false;
    return { review: generated, status: 'draft', savedAt: null };
  } catch (error) {
    if (inTransaction) database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
}

export function saveWeeklyReview(weekStart: string, adjustment: unknown): WeeklyReviewRecord {
  assertWeekStart(weekStart);
  const draft = getWeeklyReview(weekStart);
  if (draft.status === 'saved') return draft;
  const review = { ...draft.review, adjustment: validateAdjustment(adjustment, draft.review.adjustment, weekStart) };
  const database = ensureSchema();
  let inTransaction = false;
  try {
    database.exec('BEGIN IMMEDIATE');
    inTransaction = true;
    const existing = readRecord(database, weekStart);
    if (existing?.status === 'saved') {
      database.exec('COMMIT');
      inTransaction = false;
      return existing;
    }
    const savedAt = new Date().toISOString();
    database.prepare("UPDATE weekly_reviews SET review_json=?, status='saved', saved_at=? WHERE week_start=? AND status='draft'")
      .run(JSON.stringify(review), savedAt, weekStart);
    database.exec('COMMIT');
    inTransaction = false;
    return { review, status: 'saved', savedAt };
  } catch (error) {
    if (inTransaction) database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
}
