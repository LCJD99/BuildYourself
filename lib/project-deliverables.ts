import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { listGoalProjects } from './goal-plans';
import { openDatabase } from './store';

export type ProjectDeliverable = {
  id: string;
  projectId: string;
  title: string;
  completed: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
};

type ProjectDeliverableRow = {
  id: string;
  project_id: string;
  title: string;
  completed: number;
  position: number;
  created_at: string;
  updated_at: string;
};

function openForProject(projectId: string): DatabaseSync {
  if (!projectId.trim()) throw new Error('项目 ID 无效');
  if (!listGoalProjects().some(project => project.id === projectId)) throw new Error('找不到共享项目');
  const database = openDatabase();
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS goal_project_deliverables (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES goal_projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS goal_project_deliverables_unique_title
      ON goal_project_deliverables(project_id, title COLLATE NOCASE)`);
  } catch (error) {
    database.close();
    throw error;
  }
  return database;
}

function fromRow(row: ProjectDeliverableRow): ProjectDeliverable {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    completed: row.completed === 1,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readDeliverables(database: DatabaseSync, projectId: string): ProjectDeliverable[] {
  const rows = database.prepare('SELECT * FROM goal_project_deliverables WHERE project_id=? ORDER BY position, created_at, id').all(projectId) as ProjectDeliverableRow[];
  return rows.map(fromRow);
}

function normalizedTitle(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('请填写交付物名称');
  const title = value.trim();
  if (title.length > 240) throw new Error('交付物名称不能超过 240 个字符');
  return title;
}

export function listProjectDeliverables(projectId: string): ProjectDeliverable[] {
  const database = openForProject(projectId);
  try {
    return readDeliverables(database, projectId);
  } finally {
    database.close();
  }
}

export function createProjectDeliverable(projectId: string, input: unknown): ProjectDeliverable[] {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const title = normalizedTitle(value.title);
  const database = openForProject(projectId);
  try {
    const now = new Date().toISOString();
    const row = database.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM goal_project_deliverables WHERE project_id=?').get(projectId) as { position: number };
    try {
      database.prepare(`INSERT INTO goal_project_deliverables (id,project_id,title,completed,position,created_at,updated_at)
        VALUES (?,?,?,0,?,?,?)`).run(randomUUID(), projectId, title, row.position, now, now);
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) throw new Error('此项目已存在同名交付物');
      throw error;
    }
    return readDeliverables(database, projectId);
  } finally {
    database.close();
  }
}

export function updateProjectDeliverable(projectId: string, deliverableId: string, input: unknown): ProjectDeliverable[] {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const hasTitle = Object.hasOwn(value, 'title');
  const hasCompleted = Object.hasOwn(value, 'completed');
  if (!hasTitle && !hasCompleted) throw new Error('没有可保存的交付物更改');
  const title = hasTitle ? normalizedTitle(value.title) : null;
  if (hasCompleted && typeof value.completed !== 'boolean') throw new Error('交付物状态无效');
  const database = openForProject(projectId);
  try {
    const current = database.prepare('SELECT id FROM goal_project_deliverables WHERE id=? AND project_id=?').get(deliverableId, projectId);
    if (!current) throw new Error('找不到项目交付物');
    const updatedAt = new Date().toISOString();
    try {
      if (hasTitle && hasCompleted) {
        database.prepare('UPDATE goal_project_deliverables SET title=?,completed=?,updated_at=? WHERE id=? AND project_id=?')
          .run(title, Number(value.completed), updatedAt, deliverableId, projectId);
      } else if (hasTitle) {
        database.prepare('UPDATE goal_project_deliverables SET title=?,updated_at=? WHERE id=? AND project_id=?')
          .run(title, updatedAt, deliverableId, projectId);
      } else {
        database.prepare('UPDATE goal_project_deliverables SET completed=?,updated_at=? WHERE id=? AND project_id=?')
          .run(Number(value.completed), updatedAt, deliverableId, projectId);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) throw new Error('此项目已存在同名交付物');
      throw error;
    }
    return readDeliverables(database, projectId);
  } finally {
    database.close();
  }
}

export function deleteProjectDeliverable(projectId: string, deliverableId: string): ProjectDeliverable[] {
  const database = openForProject(projectId);
  try {
    const result = database.prepare('DELETE FROM goal_project_deliverables WHERE id=? AND project_id=?').run(deliverableId, projectId);
    if (Number(result.changes) !== 1) throw new Error('找不到项目交付物');
    return readDeliverables(database, projectId);
  } finally {
    database.close();
  }
}
