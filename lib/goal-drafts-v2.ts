import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './store';

type DraftConstraints = { status: 'confirmed' | 'needs_clarification'; items: string[] };
type DraftAttribute = { id?: string; name: string; description: string };
type DraftMessage = { role: 'user' | 'assistant'; message: string; createdAt: string };
export type GoalDraftProposal = {
  title?: string;
  description?: string;
  constraints?: DraftConstraints;
  attributes?: DraftAttribute[];
  clarifyingQuestions?: string[];
};
type DraftState = 'draft' | 'confirmed';

export type GoalDraftV2 = {
  id: string;
  revision: number;
  sourceIntent: string;
  title: string;
  description: string;
  constraints: DraftConstraints;
  attributes: DraftAttribute[];
  clarifyingQuestions: string[];
  transcript: DraftMessage[];
  state: DraftState;
  confirmedGoalId: string | null;
  updatedAt: string;
};

export type GoalV2 = {
  id: string;
  sourceDraftId: string;
  sourceIntent: string;
  title: string;
  description: string;
  constraints: DraftConstraints;
  attributes: Array<DraftAttribute & { id: string; progress: number }>;
  state: 'enabled';
  createdAt: string;
};

export class GoalDraftError extends Error {
  constructor(message: string, readonly status: number, readonly issues?: string[]) {
    super(message);
  }
}

const initialClarifyingQuestions = [
  '你希望通过什么可观察的结果判断目标达成？',
  '是否有期限、时间投入或其他需要遵守的限制？',
];

function ensureSchema(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS v2_goal_drafts (
      id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      source_intent TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      constraints_json TEXT NOT NULL,
      attributes_json TEXT NOT NULL,
      clarifying_questions_json TEXT NOT NULL,
      transcript_json TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('draft', 'confirmed')),
      confirmed_goal_id TEXT,
      confirmed_revision INTEGER,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS v2_goals (
      id TEXT PRIMARY KEY,
      source_draft_id TEXT NOT NULL UNIQUE REFERENCES v2_goal_drafts(id),
      source_intent TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      constraints_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS v2_goal_attributes (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL REFERENCES v2_goals(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      progress REAL NOT NULL DEFAULT 0,
      UNIQUE(goal_id, name)
    );
  `);
}

function withDatabase<T>(operation: (database: DatabaseSync) => T): T {
  const database = openDatabase();
  try {
    ensureSchema(database);
    return operation(database);
  } finally {
    database.close();
  }
}

function nonEmptyText(value: unknown, field: string, required = false): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || (required && !value.trim())) {
    throw new GoalDraftError(`${field}必须是非空文本`, 400);
  }
  return value.trim();
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new GoalDraftError(`${field}必须是文本列表`, 400);
  }
  return value.map(item => item.trim()).filter(Boolean);
}

export function validateGoalDraftProposal(value: unknown): GoalDraftProposal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GoalDraftError('Agent 草稿必须是对象', 400);
  }
  const input = value as Record<string, unknown>;
  const proposal: GoalDraftProposal = {};
  const title = nonEmptyText(input.title, '目标名称');
  const description = nonEmptyText(input.description, '目标描述');
  if (title !== undefined) proposal.title = title;
  if (description !== undefined) proposal.description = description;

  if (input.constraints !== undefined) {
    if (!input.constraints || typeof input.constraints !== 'object' || Array.isArray(input.constraints)) {
      throw new GoalDraftError('目标约束格式无效', 400);
    }
    const constraints = input.constraints as Record<string, unknown>;
    if (constraints.status !== 'confirmed' && constraints.status !== 'needs_clarification') {
      throw new GoalDraftError('目标约束状态无效', 400);
    }
    proposal.constraints = { status: constraints.status, items: stringList(constraints.items, '目标约束') };
  }

  if (input.attributes !== undefined) {
    if (!Array.isArray(input.attributes)) throw new GoalDraftError('目标属性必须是列表', 400);
    proposal.attributes = input.attributes.map((attribute, index) => {
      if (!attribute || typeof attribute !== 'object' || Array.isArray(attribute)) {
        throw new GoalDraftError(`第 ${index + 1} 个目标属性格式无效`, 400);
      }
      const record = attribute as Record<string, unknown>;
      return {
        name: nonEmptyText(record.name, `第 ${index + 1} 个目标属性名称`, true)!,
        description: nonEmptyText(record.description, `第 ${index + 1} 个目标属性描述`, true)!,
      };
    });
  }

  if (input.clarifyingQuestions !== undefined) {
    proposal.clarifyingQuestions = stringList(input.clarifyingQuestions, '待澄清问题');
  }
  return proposal;
}

function mapDraft(row: Record<string, unknown>): GoalDraftV2 {
  return {
    id: String(row.id),
    revision: Number(row.revision),
    sourceIntent: String(row.source_intent),
    title: String(row.title),
    description: String(row.description),
    constraints: JSON.parse(String(row.constraints_json)) as DraftConstraints,
    attributes: JSON.parse(String(row.attributes_json)) as DraftAttribute[],
    clarifyingQuestions: JSON.parse(String(row.clarifying_questions_json)) as string[],
    transcript: JSON.parse(String(row.transcript_json)) as DraftMessage[],
    state: row.state as DraftState,
    confirmedGoalId: row.confirmed_goal_id === null ? null : String(row.confirmed_goal_id),
    updatedAt: String(row.updated_at),
  };
}

function findDraft(database: DatabaseSync, id: string): GoalDraftV2 {
  const row = database.prepare('SELECT * FROM v2_goal_drafts WHERE id=?').get(id) as Record<string, unknown> | undefined;
  if (!row) throw new GoalDraftError('找不到目标草稿', 404);
  return mapDraft(row);
}

function saveDraft(database: DatabaseSync, draft: GoalDraftV2) {
  database.prepare(`UPDATE v2_goal_drafts SET
      revision=?, title=?, description=?, constraints_json=?, attributes_json=?,
      clarifying_questions_json=?, transcript_json=?, updated_at=? WHERE id=?`)
    .run(draft.revision, draft.title, draft.description, JSON.stringify(draft.constraints),
      JSON.stringify(draft.attributes), JSON.stringify(draft.clarifyingQuestions),
      JSON.stringify(draft.transcript), draft.updatedAt, draft.id);
}

export function createGoalDraft(messageValue: unknown, agentDraftValue: unknown, replyValue: unknown) {
  const message = nonEmptyText(messageValue, '自然语言输入', true)!;
  const reply = nonEmptyText(replyValue, 'Agent 回复', true)!;
  const proposal = validateGoalDraftProposal(agentDraftValue);
  const id = randomUUID();
  const updatedAt = new Date().toISOString();
  const draft: GoalDraftV2 = {
    id,
    revision: 1,
    sourceIntent: message,
    title: proposal.title ?? '',
    description: proposal.description ?? '',
    constraints: proposal.constraints ?? { status: 'needs_clarification', items: [] },
    attributes: proposal.attributes ?? [],
    clarifyingQuestions: proposal.clarifyingQuestions ?? initialClarifyingQuestions,
    transcript: [
      { role: 'user', message, createdAt: updatedAt },
      { role: 'assistant', message: reply, createdAt: updatedAt },
    ],
    state: 'draft',
    confirmedGoalId: null,
    updatedAt,
  };
  withDatabase(database => {
    database.prepare(`INSERT INTO v2_goal_drafts
      (id,revision,source_intent,title,description,constraints_json,attributes_json,
       clarifying_questions_json,transcript_json,state,confirmed_goal_id,confirmed_revision,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,'draft',NULL,NULL,?)`)
      .run(draft.id, draft.revision, draft.sourceIntent, draft.title, draft.description,
        JSON.stringify(draft.constraints), JSON.stringify(draft.attributes),
        JSON.stringify(draft.clarifyingQuestions), JSON.stringify(draft.transcript), draft.updatedAt);
  });
  return draft;
}

export function getGoalDraft(id: string) {
  return withDatabase(database => findDraft(database, id));
}

export function updateGoalDraft(id: string, input: { message?: unknown; revision?: unknown; proposal?: unknown; reply?: unknown }) {
  const message = nonEmptyText(input.message, '自然语言输入', true)!;
  const reply = nonEmptyText(input.reply, 'Agent 回复', true)!;
  if (!Number.isInteger(input.revision) || Number(input.revision) < 1) {
    throw new GoalDraftError('请提供当前草稿版本', 400);
  }
  const proposal = validateGoalDraftProposal(input.proposal);
  return withDatabase(database => {
    database.exec('BEGIN IMMEDIATE');
    try {
      const current = findDraft(database, id);
      if (current.state !== 'draft') throw new GoalDraftError('已启用的目标不能继续修改草稿', 409);
      if (current.revision !== Number(input.revision)) throw new GoalDraftError('草稿已有新版本，请刷新后继续', 409);
      const updated: GoalDraftV2 = {
        ...current,
        ...(proposal.title !== undefined ? { title: proposal.title } : {}),
        ...(proposal.description !== undefined ? { description: proposal.description } : {}),
        ...(proposal.constraints !== undefined ? { constraints: proposal.constraints } : {}),
        ...(proposal.attributes !== undefined ? { attributes: proposal.attributes } : {}),
        ...(proposal.clarifyingQuestions !== undefined ? { clarifyingQuestions: proposal.clarifyingQuestions } : {}),
        revision: current.revision + 1,
        transcript: [...current.transcript,
          { role: 'user', message, createdAt: new Date().toISOString() },
          { role: 'assistant', message: reply, createdAt: new Date().toISOString() },
        ],
        updatedAt: new Date().toISOString(),
      };
      saveDraft(database, updated);
      database.exec('COMMIT');
      return updated;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  });
}

function readGoal(database: DatabaseSync, id: string): GoalV2 {
  const row = database.prepare('SELECT * FROM v2_goals WHERE id=?').get(id) as Record<string, unknown> | undefined;
  if (!row) throw new GoalDraftError('找不到已启用目标', 404);
  const attributes = database.prepare('SELECT id,name,description,progress FROM v2_goal_attributes WHERE goal_id=? ORDER BY rowid').all(id) as Record<string, unknown>[];
  return {
    id: String(row.id),
    sourceDraftId: String(row.source_draft_id),
    sourceIntent: String(row.source_intent),
    title: String(row.title),
    description: String(row.description),
    constraints: JSON.parse(String(row.constraints_json)) as DraftConstraints,
    attributes: attributes.map(attribute => ({
      id: String(attribute.id), name: String(attribute.name),
      description: String(attribute.description), progress: Number(attribute.progress),
    })),
    state: 'enabled',
    createdAt: String(row.created_at),
  };
}

export function listEnabledGoals() {
  return withDatabase(database => {
    const rows = database.prepare('SELECT id FROM v2_goals ORDER BY created_at DESC').all() as { id: string }[];
    return rows.map(row => readGoal(database, row.id));
  });
}

export function getEnabledGoal(id: string) {
  return withDatabase(database => readGoal(database, id));
}

function goalDraftIssues(draft: GoalDraftV2) {
  const issues: string[] = [];
  if (!draft.title.trim()) issues.push('请补充长期目标名称。');
  if (!draft.description.trim()) issues.push('请说明目标描述和可核对的预期结果。');
  if (draft.constraints.status !== 'confirmed') issues.push('请澄清并确认目标约束。');
  if (!draft.attributes.length) issues.push('请至少确认一个用于评价成长的目标属性。');
  if (draft.clarifyingQuestions.length) issues.push('仍有待澄清问题，请先完成澄清。');
  return issues;
}

export function confirmGoalDraft(id: string, revisionValue: unknown) {
  if (!Number.isInteger(revisionValue) || Number(revisionValue) < 1) {
    throw new GoalDraftError('请提供要确认的草稿版本', 400);
  }
  return withDatabase(database => {
    database.exec('BEGIN IMMEDIATE');
    try {
      const row = database.prepare('SELECT * FROM v2_goal_drafts WHERE id=?').get(id) as Record<string, unknown> | undefined;
      if (!row) throw new GoalDraftError('找不到目标草稿', 404);
      const draft = mapDraft(row);
      if (draft.state === 'confirmed') {
        if (Number(row.confirmed_revision) !== Number(revisionValue)) {
          throw new GoalDraftError('目标已由其他草稿版本启用', 409);
        }
        const goal = readGoal(database, draft.confirmedGoalId!);
        database.exec('COMMIT');
        return { goal, idempotent: true };
      }
      if (draft.revision !== Number(revisionValue)) throw new GoalDraftError('草稿已有新版本，请刷新后再确认', 409);
      const issues = goalDraftIssues(draft);
      if (issues.length) throw new GoalDraftError('目标草稿尚未通过确认校验', 422, issues);

      const goalId = randomUUID();
      const createdAt = new Date().toISOString();
      database.prepare(`INSERT INTO v2_goals
        (id,source_draft_id,source_intent,title,description,constraints_json,created_at)
        VALUES (?,?,?,?,?,?,?)`)
        .run(goalId, draft.id, draft.sourceIntent, draft.title, draft.description,
          JSON.stringify(draft.constraints), createdAt);
      const insertAttribute = database.prepare(`INSERT INTO v2_goal_attributes (id,goal_id,name,description,progress)
        VALUES (?,?,?,?,0)`);
      for (const attribute of draft.attributes) {
        insertAttribute.run(randomUUID(), goalId, attribute.name, attribute.description);
      }
      database.prepare(`UPDATE v2_goal_drafts SET state='confirmed',confirmed_goal_id=?,confirmed_revision=? WHERE id=?`)
        .run(goalId, draft.revision, draft.id);
      const goal = readGoal(database, goalId);
      database.exec('COMMIT');
      return { goal, idempotent: false };
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  });
}

export function getGoalDraftValidation(draft: GoalDraftV2) {
  const issues = goalDraftIssues(draft);
  return { ready: issues.length === 0, issues };
}
