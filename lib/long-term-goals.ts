import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './store';

export type GoalAttribute = {
  id: string;
  goalId: string;
  title: string;
  description: string | null;
  progress: number;
};

export type LongTermGoal = {
  id: string;
  intent: string;
  title: string;
  description: string | null;
  deadline: string | null;
  constraints: string[];
  status: 'draft' | 'active';
  confirmedAt: string | null;
  attributes: GoalAttribute[];
};

export type LongTermAction = {
  id: string;
  title: string;
  details: string | null;
  source: 'planned' | 'unplanned';
  date: string | null;
  status: 'open' | 'done';
  goalIds: string[];
  attributeIds: string[];
  completion: number | null;
  confidence: number | null;
  agentFeedback: string | null;
};

export type ActionAssessment = {
  id: string;
  actionId: string;
  rawFeedback: string;
  completion: number;
  confidence: number;
  agentFeedback: string;
  assessedAt: string;
  contributions: Array<{ goalId: string; attributeId: string; amount: number }>;
};

function schema(database: DatabaseSync) {
  database.exec(`CREATE TABLE IF NOT EXISTS v2_goals (
    id TEXT PRIMARY KEY, intent TEXT NOT NULL, title TEXT NOT NULL,
    description TEXT, deadline TEXT, constraints_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('draft','active')),
    confirmed_at TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS v2_attributes (
    id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES v2_goals(id),
    title TEXT NOT NULL, description TEXT, progress REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS v2_actions (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, details TEXT,
    source TEXT NOT NULL CHECK(source IN ('planned','unplanned')),
    action_date TEXT, status TEXT NOT NULL CHECK(status IN ('open','done')),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS v2_action_goals (
    action_id TEXT NOT NULL REFERENCES v2_actions(id), goal_id TEXT NOT NULL REFERENCES v2_goals(id),
    PRIMARY KEY(action_id, goal_id)
  );
  CREATE TABLE IF NOT EXISTS v2_action_attributes (
    action_id TEXT NOT NULL REFERENCES v2_actions(id), attribute_id TEXT NOT NULL REFERENCES v2_attributes(id),
    PRIMARY KEY(action_id, attribute_id)
  );
  CREATE TABLE IF NOT EXISTS v2_assessments (
    id TEXT PRIMARY KEY, action_id TEXT NOT NULL REFERENCES v2_actions(id),
    raw_feedback TEXT NOT NULL, completion REAL NOT NULL, confidence REAL NOT NULL,
    agent_feedback TEXT NOT NULL, assessed_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS v2_contributions (
    assessment_id TEXT NOT NULL REFERENCES v2_assessments(id),
    action_id TEXT NOT NULL REFERENCES v2_actions(id), goal_id TEXT NOT NULL REFERENCES v2_goals(id),
    attribute_id TEXT NOT NULL REFERENCES v2_attributes(id), amount REAL NOT NULL,
    PRIMARY KEY(assessment_id, attribute_id)
  );
  CREATE TABLE IF NOT EXISTS v2_miscellaneous (
    id TEXT PRIMARY KEY, raw_feedback TEXT NOT NULL, agent_feedback TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS v2_actions_date ON v2_actions(action_date);`);
}

function use<T>(callback: (database: DatabaseSync) => T): T {
  const database = openDatabase();
  try {
    schema(database);
    return callback(database);
  } finally {
    database.close();
  }
}

function text(value: unknown, field: string, required = true): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    if (required) throw new Error(`${field}不能为空`);
    return null;
  }
  return value.trim();
}

function ratio(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${field}必须是 0 到 1 之间的数字`);
  }
  return value;
}

function readGoal(database: DatabaseSync, id: string): LongTermGoal | null {
  const row = database.prepare('SELECT * FROM v2_goals WHERE id=?').get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const attributes = database.prepare('SELECT * FROM v2_attributes WHERE goal_id=? ORDER BY rowid').all(id) as Record<string, unknown>[];
  return {
    id: String(row.id), intent: String(row.intent), title: String(row.title),
    description: row.description === null ? null : String(row.description),
    deadline: row.deadline === null ? null : String(row.deadline),
    constraints: JSON.parse(String(row.constraints_json)) as string[],
    status: row.status as LongTermGoal['status'],
    confirmedAt: row.confirmed_at === null ? null : String(row.confirmed_at),
    attributes: attributes.map(attribute => ({
      id: String(attribute.id), goalId: String(attribute.goal_id), title: String(attribute.title),
      description: attribute.description === null ? null : String(attribute.description),
      progress: Number(attribute.progress),
    })),
  };
}

export function createLongTermGoal(input: unknown): LongTermGoal {
  const value = input as Record<string, unknown>;
  const intent = text(value?.intent, '目标意图')!;
  const title = text(value?.title, '目标标题')!;
  const attributes = Array.isArray(value?.attributes) ? value.attributes : [];
  if (!attributes.length) throw new Error('至少需要一个目标属性');
  const normalized = attributes.map(attribute => {
    const item = attribute as Record<string, unknown>;
    return { id: randomUUID(), title: text(item.title, '属性标题')!, description: text(item.description, '属性说明', false) };
  });
  const id = randomUUID();
  const now = new Date().toISOString();
  return use(database => {
    database.prepare(`INSERT INTO v2_goals VALUES (?,?,?,?,?,?,?,?)`).run(
      id, intent, title, text(value.description, '目标描述', false), text(value.deadline, '期限', false),
      JSON.stringify(Array.isArray(value.constraints) ? value.constraints.filter(item => typeof item === 'string') : []),
      'draft', null, now,
    );
    const insert = database.prepare('INSERT INTO v2_attributes VALUES (?,?,?,?,0)');
    for (const attribute of normalized) insert.run(attribute.id, id, attribute.title, attribute.description);
    return readGoal(database, id)!;
  });
}

export function confirmLongTermGoal(id: string): LongTermGoal {
  return use(database => {
    if (!readGoal(database, id)) throw new Error('目标不存在');
    const confirmedAt = new Date().toISOString();
    database.prepare("UPDATE v2_goals SET status='active', confirmed_at=? WHERE id=?").run(confirmedAt, id);
    return readGoal(database, id)!;
  });
}

export function listLongTermGoals(): LongTermGoal[] {
  return use(database => (database.prepare('SELECT id FROM v2_goals ORDER BY created_at').all() as { id: string }[])
    .map(row => readGoal(database, row.id)!));
}

function ensureLinks(database: DatabaseSync, goalIds: string[], attributeIds: string[]) {
  if (!goalIds.length && !attributeIds.length) return;
  if (!goalIds.length) throw new Error('行动至少需要关联一个目标');
  const placeholders = goalIds.map(() => '?').join(',');
  const goals = database.prepare(`SELECT id FROM v2_goals WHERE status='active' AND id IN (${placeholders})`).all(...goalIds) as { id: string }[];
  if (goals.length !== new Set(goalIds).size) throw new Error('行动只能关联已确认目标');
  if (!attributeIds.length) throw new Error('行动至少需要关联一个属性');
  const attributes = database.prepare(`SELECT id, goal_id FROM v2_attributes WHERE id IN (${attributeIds.map(() => '?').join(',')})`).all(...attributeIds) as { id: string; goal_id: string }[];
  if (attributes.length !== new Set(attributeIds).size || attributes.some(attribute => !goalIds.includes(attribute.goal_id))) {
    throw new Error('行动属性必须属于关联目标');
  }
}

function readAction(database: DatabaseSync, id: string): LongTermAction | null {
  const row = database.prepare('SELECT * FROM v2_actions WHERE id=?').get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const links = database.prepare('SELECT goal_id FROM v2_action_goals WHERE action_id=?').all(id) as { goal_id: string }[];
  const attributes = database.prepare('SELECT attribute_id FROM v2_action_attributes WHERE action_id=?').all(id) as { attribute_id: string }[];
  const assessment = database.prepare('SELECT completion, confidence, agent_feedback FROM v2_assessments WHERE action_id=? ORDER BY assessed_at DESC LIMIT 1').get(id) as Record<string, unknown> | undefined;
  return {
    id: String(row.id), title: String(row.title), details: row.details === null ? null : String(row.details),
    source: row.source as LongTermAction['source'], date: row.action_date === null ? null : String(row.action_date),
    status: row.status as LongTermAction['status'], goalIds: links.map(link => link.goal_id),
    attributeIds: attributes.map(attribute => attribute.attribute_id),
    completion: assessment ? Number(assessment.completion) : null,
    confidence: assessment ? Number(assessment.confidence) : null,
    agentFeedback: assessment ? String(assessment.agent_feedback) : null,
  };
}

export function createLongTermAction(input: unknown): LongTermAction {
  const value = input as Record<string, unknown>;
  const source = value?.source === 'unplanned' ? 'unplanned' : 'planned';
  const title = text(value?.title, '行动标题')!;
  const goalIds = Array.isArray(value?.goalIds) ? value.goalIds.filter((id): id is string => typeof id === 'string') : [];
  const attributeIds = Array.isArray(value?.attributeIds) ? value.attributeIds.filter((id): id is string => typeof id === 'string') : [];
  return use(database => {
    if (source === 'planned' || goalIds.length || attributeIds.length) ensureLinks(database, goalIds, attributeIds);
    const id = randomUUID();
    database.prepare('INSERT INTO v2_actions VALUES (?,?,?,?,?,?,?)').run(
      id, title, text(value.details, '行动说明', false), source,
      text(value.date, '行动日期', false), 'open', new Date().toISOString(),
    );
    const goalLink = database.prepare('INSERT INTO v2_action_goals VALUES (?,?)');
    const attributeLink = database.prepare('INSERT INTO v2_action_attributes VALUES (?,?)');
    for (const goalId of goalIds) goalLink.run(id, goalId);
    for (const attributeId of attributeIds) attributeLink.run(id, attributeId);
    return readAction(database, id)!;
  });
}

export function listLongTermActions(filters: { month?: string; date?: string } = {}): LongTermAction[] {
  return use(database => {
    let query = 'SELECT id FROM v2_actions';
    const args: string[] = [];
    if (filters.date) { query += ' WHERE action_date=?'; args.push(filters.date); }
    else if (filters.month) { query += ' WHERE action_date LIKE ?'; args.push(`${filters.month}-%`); }
    query += ' ORDER BY action_date, created_at';
    return (database.prepare(query).all(...args) as { id: string }[]).map(row => readAction(database, row.id)!);
  });
}

export function listActionDates(month: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('月份必须是 YYYY-MM');
  return use(database => (database.prepare("SELECT DISTINCT action_date FROM v2_actions WHERE action_date LIKE ? AND action_date IS NOT NULL ORDER BY action_date")
    .all(`${month}-%`) as { action_date: string }[]).map(row => row.action_date));
}

export function assessLongTermAction(actionId: string, input: unknown): ActionAssessment | { miscellaneousId: string; rawFeedback: string; agentFeedback: string } {
  const value = input as Record<string, unknown>;
  const rawFeedback = text(value?.rawFeedback, '原始反馈')!;
  const completion = ratio(value?.completion, '完成度');
  const confidence = ratio(value?.confidence, '置信度');
  const agentFeedback = text(value?.agentFeedback, 'Agent反馈')!;
  return use(database => {
    const action = readAction(database, actionId);
    if (!action) throw new Error('行动不存在');
    const now = new Date().toISOString();
    if (action.source === 'unplanned' && (!Array.isArray(value.contributions) || value.contributions.length === 0)) {
      const id = randomUUID();
      database.prepare('INSERT INTO v2_miscellaneous VALUES (?,?,?,?,?)').run(id, rawFeedback, agentFeedback, now);
      return { miscellaneousId: id, rawFeedback, agentFeedback };
    }
    const assessmentId = randomUUID();
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare('INSERT INTO v2_assessments VALUES (?,?,?,?,?,?,?)').run(assessmentId, actionId, rawFeedback, completion, confidence, agentFeedback, now);
      const requested = Array.isArray(value.contributions) ? value.contributions as Record<string, unknown>[] : [];
      const insert = database.prepare('INSERT INTO v2_contributions VALUES (?,?,?,?,?)');
      const update = database.prepare('UPDATE v2_attributes SET progress=MIN(1, progress+?) WHERE id=?');
      const previous = database.prepare('SELECT COALESCE(SUM(amount),0) AS total FROM v2_contributions WHERE action_id=? AND attribute_id=?');
      const contributions: ActionAssessment['contributions'] = [];
      for (const item of requested) {
        const attributeId = text(item.attributeId, '属性')!;
        const goalId = text(item.goalId, '目标')!;
        const weight = ratio(item.amount, '贡献度');
        const score = completion * confidence * weight;
        const prior = Number((previous.get(actionId, attributeId) as { total: number }).total);
        const delta = Math.max(0, score - prior);
        if (delta > 0) {
          insert.run(assessmentId, actionId, goalId, attributeId, delta);
          update.run(delta, attributeId);
          contributions.push({ goalId, attributeId, amount: delta });
        }
      }
      database.prepare("UPDATE v2_actions SET status=CASE WHEN ? >= 1 THEN 'done' ELSE status END WHERE id=?").run(completion, actionId);
      database.exec('COMMIT');
      return { id: assessmentId, actionId, rawFeedback, completion, confidence, agentFeedback, assessedAt: now, contributions };
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  });
}
