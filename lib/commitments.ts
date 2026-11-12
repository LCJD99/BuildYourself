import { randomUUID } from 'node:crypto';
import { openDatabase } from './store';
import { listGoalPlans } from './goal-plans';

export type CommitmentField = 'deliverable' | 'deadline' | 'tasks' | 'estimateMinutes' | 'dependencies' | 'acceptanceCriteria' | 'goalPlanId';

export type CommitmentTask = {
  title: string;
  details: string | null;
  deadline: string | null;
  estimateMinutes: number | null;
  dependencies: string[];
  acceptanceCriteria: string | null;
};

export type CommitmentUncertainty = {
  field: CommitmentField;
  taskIndex: number | null;
  reason: string;
};

export type ExternalCommitmentInput = {
  sourceText: string;
  deliverable: string;
  deadline: string | null;
  goalPlanId: string | null;
  tasks: CommitmentTask[];
  uncertainFields: CommitmentUncertainty[];
};

export type ExternalCommitment = ExternalCommitmentInput & {
  id: string;
  goalTitle: string | null;
  status: 'pending_schedule' | 'partially_scheduled' | 'scheduled';
  createdAt: string;
};

const commitmentFields = new Set<CommitmentField>([
  'deliverable', 'deadline', 'tasks', 'estimateMinutes', 'dependencies', 'acceptanceCriteria', 'goalPlanId',
]);

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field}格式无效`);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, maximum: number, required = false): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`请填写${field}`);
    return null;
  }
  if (typeof value !== 'string') throw new Error(`${field}必须是文本`);
  const trimmed = value.trim();
  if (trimmed.length > maximum) throw new Error(`${field}不能超过 ${maximum} 个字符`);
  if (!trimmed && required) throw new Error(`请填写${field}`);
  return trimmed || null;
}

function date(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field}格式无效，请使用 YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${field}日期无效`);
  return value;
}

function normalizeTask(value: unknown, index: number): CommitmentTask {
  const item = object(value, `任务 ${index + 1}`);
  for (const field of ['deadline', 'estimateMinutes', 'dependencies', 'acceptanceCriteria']) {
    if (!Object.hasOwn(item, field)) throw new Error(`任务 ${index + 1} 缺少${field === 'deadline' ? '截止时间' : field === 'estimateMinutes' ? '预计耗时' : field === 'dependencies' ? '依赖' : '验收要求'}字段；未说明时请显式标记为不确定`);
  }
  const title = text(item.title, '任务名称', 240, true)!;
  const estimate = item.estimateMinutes === undefined ? null : item.estimateMinutes;
  if (estimate !== null && (typeof estimate !== 'number' || !Number.isInteger(estimate) || estimate < 1 || estimate > 10080)) {
    throw new Error(`任务 ${index + 1} 的预计耗时必须是 1 到 10080 分钟的整数`);
  }
  const rawDependencies = item.dependencies === undefined ? [] : item.dependencies;
  if (!Array.isArray(rawDependencies) || !rawDependencies.every(dependency => typeof dependency === 'string' && dependency.trim().length > 0)
      || new Set(rawDependencies.map(dependency => (dependency as string).trim())).size !== rawDependencies.length) {
    throw new Error(`任务 ${index + 1} 的依赖格式无效`);
  }
  return {
    title,
    details: text(item.details, '任务说明', 2000),
    deadline: date(item.deadline, `任务 ${index + 1} 的截止日期`),
    estimateMinutes: estimate as number | null,
    dependencies: rawDependencies.map(dependency => (dependency as string).trim()),
    acceptanceCriteria: text(item.acceptanceCriteria, '验收要求', 2000),
  };
}

export function normalizeExternalCommitment(input: unknown): ExternalCommitmentInput {
  const value = object(input, '外部承诺');
  const sourceText = text(value.sourceText, '通知原文', 10000, true)!;
  const deliverable = text(value.deliverable, '交付物', 500, true)!;
  if (!Object.hasOwn(value, 'deadline')) throw new Error('请明确提供整体截止时间；没有单一截止时请显式设为 null');
  if (!Object.hasOwn(value, 'goalPlanId')) throw new Error('请明确核对目标归属；没有目标归属时请选择「杂项」');
  if (!Object.hasOwn(value, 'uncertainFields')) throw new Error('请明确列出不确定字段；没有不确定项时传入空列表');
  const rawTasks = value.tasks;
  if (!Array.isArray(rawTasks) || rawTasks.length === 0 || rawTasks.length > 50) throw new Error('至少需要一项任务，最多可记录 50 项');
  const tasks = rawTasks.map(normalizeTask);
  const goalPlanId = text(value.goalPlanId, '目标 ID', 100);
  const rawUncertainFields = value.uncertainFields === undefined ? [] : value.uncertainFields;
  if (!Array.isArray(rawUncertainFields) || rawUncertainFields.length > 100) throw new Error('不确定字段格式无效');
  const uncertainFields = rawUncertainFields.map((entry, index): CommitmentUncertainty => {
    const item = object(entry, `不确定字段 ${index + 1}`);
    if (typeof item.field !== 'string' || !commitmentFields.has(item.field as CommitmentField)) throw new Error(`不确定字段 ${index + 1} 无效`);
    const taskIndex = item.taskIndex === undefined || item.taskIndex === null ? null : item.taskIndex;
    if (taskIndex !== null && (typeof taskIndex !== 'number' || !Number.isInteger(taskIndex) || taskIndex < 0 || taskIndex >= tasks.length)) {
      throw new Error(`不确定字段 ${index + 1} 指向不存在的任务`);
    }
    const field = item.field as CommitmentField;
    if (taskIndex !== null && !['estimateMinutes', 'dependencies', 'acceptanceCriteria', 'deadline'].includes(field)) {
      throw new Error(`不确定字段 ${index + 1} 不能关联到任务`);
    }
    return {
      field,
      taskIndex,
      reason: text(item.reason, '不确定原因', 500, true)!,
    };
  });
  const isUncertain = (field: CommitmentField, taskIndex: number) => uncertainFields.some(item =>
    item.field === field && (item.taskIndex === null || item.taskIndex === taskIndex));
  tasks.forEach((task, index) => {
    if (task.deadline === null && !isUncertain('deadline', index)) {
      throw new Error(`任务 ${index + 1} 未说明截止时间时，请将其标记为不确定字段`);
    }
    if (task.estimateMinutes === null && !isUncertain('estimateMinutes', index)) {
      throw new Error(`任务 ${index + 1} 未说明预计耗时时，请将其标记为不确定字段`);
    }
    if (task.acceptanceCriteria === null && !isUncertain('acceptanceCriteria', index)) {
      throw new Error(`任务 ${index + 1} 未说明验收要求时，请将其标记为不确定字段`);
    }
  });

  return {
    sourceText,
    deliverable,
    deadline: date(value.deadline, '截止日期'),
    goalPlanId,
    tasks,
    uncertainFields,
  };
}

function ensureCommitmentsSchema() {
  const database = openDatabase();
  database.exec(`CREATE TABLE IF NOT EXISTS external_commitments (
    id TEXT PRIMARY KEY,
    source_text TEXT NOT NULL,
    deliverable TEXT NOT NULL,
    deadline TEXT,
    goal_plan_id TEXT REFERENCES goal_plans(id),
    tasks_json TEXT NOT NULL,
    uncertain_fields_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_schedule',
    created_at TEXT NOT NULL
  );
    CREATE INDEX IF NOT EXISTS external_commitments_created_at ON external_commitments(created_at DESC);`);
  return database;
}

function commitmentFromRow(row: Record<string, unknown>): ExternalCommitment {
  return {
    id: String(row.id),
    sourceText: String(row.source_text),
    deliverable: String(row.deliverable),
    deadline: row.deadline === null ? null : String(row.deadline),
    goalPlanId: row.goal_plan_id === null ? null : String(row.goal_plan_id),
    goalTitle: row.goal_title === null ? null : String(row.goal_title),
    tasks: JSON.parse(String(row.tasks_json)) as CommitmentTask[],
    uncertainFields: JSON.parse(String(row.uncertain_fields_json)) as CommitmentUncertainty[],
    status: row.status === 'scheduled' || row.status === 'partially_scheduled' ? row.status : 'pending_schedule',
    createdAt: String(row.created_at),
  };
}

const commitmentSelect = `SELECT c.*, json_extract(p.plan_json, '$.title') AS goal_title
  FROM external_commitments c LEFT JOIN goal_plans p ON p.id=c.goal_plan_id`;

export function listExternalCommitments(): ExternalCommitment[] {
  listGoalPlans();
  const database = ensureCommitmentsSchema();
  try {
    return (database.prepare(`${commitmentSelect} ORDER BY c.created_at DESC, c.rowid DESC`).all() as Array<Record<string, unknown>>)
      .map(commitmentFromRow);
  } finally {
    database.close();
  }
}

export function saveExternalCommitment(input: unknown): ExternalCommitment {
  const commitment = normalizeExternalCommitment(input);
  const goals = listGoalPlans();
  if (commitment.goalPlanId && !goals.some(goal => goal.id === commitment.goalPlanId && goal.status === 'active')) {
    throw new Error('归属目标必须是活跃目标；没有目标归属的承诺请选择「杂项」');
  }

  const database = ensureCommitmentsSchema();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  try {
    database.prepare(`INSERT INTO external_commitments
      (id,source_text,deliverable,deadline,goal_plan_id,tasks_json,uncertain_fields_json,status,created_at)
      VALUES (?,?,?,?,?,?,?,'pending_schedule',?)`)
      .run(id, commitment.sourceText, commitment.deliverable, commitment.deadline, commitment.goalPlanId,
        JSON.stringify(commitment.tasks), JSON.stringify(commitment.uncertainFields), createdAt);
  } finally {
    database.close();
  }
  return listExternalCommitments().find(item => item.id === id)!;
}
