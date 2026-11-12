import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { listGoalProjects } from './goal-plans';
import { openDatabase } from './store';

export type ProjectMeasurementSeries = {
  id: string;
  projectId: string;
  name: string;
  basis: string;
  confirmedComparableAt: string;
  createdAt: string;
  updatedAt: string;
  evidence: Array<{ evidenceId: string; confirmedAt: string }>;
};

type SeriesRow = {
  id: string;
  project_id: string;
  name: string;
  basis: string;
  confirmed_comparable_at: string;
  created_at: string;
  updated_at: string;
};

function openForProject(projectId: string): DatabaseSync {
  if (!projectId.trim()) throw new Error('项目 ID 无效');
  if (!listGoalProjects().some(project => project.id === projectId)) throw new Error('找不到共享项目');
  const database = openDatabase();
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS goal_project_measurement_series (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES goal_projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      basis TEXT NOT NULL,
      confirmed_comparable_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS goal_project_measurement_series_unique_name
      ON goal_project_measurement_series(project_id, name COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS goal_project_measurement_series_evidence (
      project_id TEXT NOT NULL REFERENCES goal_projects(id) ON DELETE CASCADE,
      series_id TEXT NOT NULL REFERENCES goal_project_measurement_series(id) ON DELETE CASCADE,
      evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
      linked_at TEXT NOT NULL,
      PRIMARY KEY(project_id,series_id,evidence_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS goal_project_measurement_series_one_per_evidence
      ON goal_project_measurement_series_evidence(project_id,evidence_id)`);
  } catch (error) {
    database.close();
    throw error;
  }
  return database;
}

function normalizedText(value: unknown, label: string, limit: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`请填写${label}`);
  const text = value.trim();
  if (text.length > limit) throw new Error(`${label}不能超过 ${limit} 个字符`);
  return text;
}

function readSeries(database: DatabaseSync, projectId: string): ProjectMeasurementSeries[] {
  const rows = database.prepare('SELECT * FROM goal_project_measurement_series WHERE project_id=? ORDER BY created_at, id').all(projectId) as SeriesRow[];
  const seriesEvidence = database.prepare('SELECT evidence_id,linked_at FROM goal_project_measurement_series_evidence WHERE project_id=? AND series_id=? ORDER BY linked_at, evidence_id');
  return rows.map(row => ({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    basis: row.basis,
    confirmedComparableAt: row.confirmed_comparable_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    evidence: (seriesEvidence.all(projectId, row.id) as { evidence_id: string; linked_at: string }[])
      .map(item => ({ evidenceId: item.evidence_id, confirmedAt: item.linked_at })),
  }));
}

function projectWithEvidence(projectId: string) {
  const project = listGoalProjects().find(item => item.id === projectId);
  if (!project) throw new Error('找不到共享项目');
  return project;
}

function isComparableMeasurement(evidence: ReturnType<typeof projectWithEvidence>['evidence'][number]) {
  return evidence.links.includes('milestone') && evidence.benchmarkComplete === true
    && typeof evidence.latencyMs === 'number' && Number.isFinite(evidence.latencyMs)
    && Number.isFinite(Date.parse(evidence.observedAt));
}

export function listProjectMeasurementSeries(projectId: string): ProjectMeasurementSeries[] {
  const database = openForProject(projectId);
  try {
    return readSeries(database, projectId);
  } finally {
    database.close();
  }
}

export function createProjectMeasurementSeries(projectId: string, input: unknown): ProjectMeasurementSeries[] {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const name = normalizedText(value.name, '序列名称', 100);
  const basis = normalizedText(value.basis, '可比较口径说明', 1000);
  if (value.confirmedComparable !== true) throw new Error('请确认此序列中的观测使用相同工作负载、测试环境和指标口径');
  const database = openForProject(projectId);
  try {
    const now = new Date().toISOString();
    try {
      database.prepare(`INSERT INTO goal_project_measurement_series
        (id,project_id,name,basis,confirmed_comparable_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
        .run(randomUUID(), projectId, name, basis, now, now, now);
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) throw new Error('此项目已存在同名测量序列');
      throw error;
    }
    return readSeries(database, projectId);
  } finally {
    database.close();
  }
}

export function assignProjectEvidenceToSeries(projectId: string, seriesId: string, evidenceId: string): ProjectMeasurementSeries[] {
  const project = projectWithEvidence(projectId);
  const evidence = project.evidence.find(item => item.id === evidenceId);
  if (!evidence) throw new Error('请先将证据明确关联到此项目');
  if (!isComparableMeasurement(evidence)) throw new Error('只有带有完整基准标记的延迟观测可以加入比较序列');
  const database = openForProject(projectId);
  try {
    if (!database.prepare('SELECT id FROM goal_project_measurement_series WHERE id=? AND project_id=?').get(seriesId, projectId)) {
      throw new Error('找不到此项目的测量序列');
    }
    try {
      const existing = database.prepare('SELECT series_id FROM goal_project_measurement_series_evidence WHERE project_id=? AND evidence_id=?').get(projectId, evidenceId) as { series_id: string } | undefined;
      const confirmedAt = new Date().toISOString();
      if (existing?.series_id === seriesId) {
        database.prepare('UPDATE goal_project_measurement_series_evidence SET linked_at=? WHERE project_id=? AND series_id=? AND evidence_id=?')
          .run(confirmedAt, projectId, seriesId, evidenceId);
      } else {
        database.prepare('INSERT INTO goal_project_measurement_series_evidence (project_id,series_id,evidence_id,linked_at) VALUES (?,?,?,?)')
          .run(projectId, seriesId, evidenceId, confirmedAt);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) throw new Error('此证据已归入一个比较序列');
      throw error;
    }
    return readSeries(database, projectId);
  } finally {
    database.close();
  }
}

export function removeProjectEvidenceFromSeries(projectId: string, seriesId: string, evidenceId: string): ProjectMeasurementSeries[] {
  const database = openForProject(projectId);
  try {
    const result = database.prepare(`DELETE FROM goal_project_measurement_series_evidence
      WHERE project_id=? AND series_id=? AND evidence_id=?`).run(projectId, seriesId, evidenceId);
    if (Number(result.changes) !== 1) throw new Error('找不到此序列中的证据');
    return readSeries(database, projectId);
  } finally {
    database.close();
  }
}

export function deleteProjectMeasurementSeries(projectId: string, seriesId: string): ProjectMeasurementSeries[] {
  const database = openForProject(projectId);
  try {
    const result = database.prepare('DELETE FROM goal_project_measurement_series WHERE id=? AND project_id=?').run(seriesId, projectId);
    if (Number(result.changes) !== 1) throw new Error('找不到此项目的测量序列');
    return readSeries(database, projectId);
  } finally {
    database.close();
  }
}
