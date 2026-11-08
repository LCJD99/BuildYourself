import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultEvidenceRequirements, Evidence, EvidenceLevel, EvidenceNodeId, isEvidenceLevel, isMinimumEvidenceLevel, MinimumEvidenceLevel, NodeId, nodes, TaskExecution } from './model';

export function openDatabase() {
  const path = resolve(process.env.BUILDYOURSELF_DB || './data/graph.sqlite');
  mkdirSync(dirname(path), { recursive: true });
  const d = new DatabaseSync(path);
  d.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, text TEXT NOT NULL, source TEXT NOT NULL, reference TEXT NOT NULL, observed_at TEXT NOT NULL, created_at TEXT NOT NULL, report_submitted INTEGER, latency_ms REAL, benchmark_complete INTEGER, level TEXT NOT NULL DEFAULT 'E1');
    CREATE TABLE IF NOT EXISTS evidence_links (evidence_id TEXT NOT NULL REFERENCES evidence(id), node_id TEXT NOT NULL, PRIMARY KEY(evidence_id,node_id));
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const columns = d.prepare('PRAGMA table_info(evidence)').all() as { name: string }[];
  if (!columns.some(column => column.name === 'level')) d.exec("ALTER TABLE evidence ADD COLUMN level TEXT NOT NULL DEFAULT 'E1'");
  return d;
}
const validId = (id: unknown): id is NodeId => nodes.some(n => n.id === id);
const evidenceNodeId = (id: unknown): id is EvidenceNodeId => id === 'task' || id === 'milestone';
export function getContext(): NodeId { const d=openDatabase(); try { const row=d.prepare("SELECT value FROM settings WHERE key='context'").get() as {value:string}|undefined; return validId(row?.value) ? row.value : 'task'; } finally {d.close();} }
export function setContext(id: unknown) { if (!validId(id)) throw new Error('无效的对象'); const d=openDatabase(); try {d.prepare("INSERT INTO settings VALUES ('context', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(id);} finally {d.close();} }
export function getTaskExecution(): TaskExecution { const d=openDatabase(); try { const row=d.prepare("SELECT value FROM settings WHERE key='taskCompletedAt'").get() as {value:string}|undefined; return {completedAt:row && Number.isFinite(Date.parse(row.value)) ? row.value : null}; } finally {d.close();} }
export function setTaskExecution(completed: boolean): TaskExecution {
  if (typeof completed !== 'boolean') throw new Error('无效的执行状态');
  const d=openDatabase();
  try {
    if (!completed) d.prepare("DELETE FROM settings WHERE key='taskCompletedAt'").run();
    else {
      const existing=d.prepare("SELECT value FROM settings WHERE key='taskCompletedAt'").get() as {value:string}|undefined;
      if (!existing) d.prepare("INSERT INTO settings VALUES ('taskCompletedAt', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(new Date().toISOString());
    }
  } finally {d.close();}
  return getTaskExecution();
}
export function getEvidenceRequirements(): Record<EvidenceNodeId, MinimumEvidenceLevel> {
  const d=openDatabase();
  try {
    const row=d.prepare("SELECT key, value FROM settings WHERE key IN ('minimumEvidence:task','minimumEvidence:milestone')").all() as {key:string;value:string}[];
    const saved=new Map(row.map(item=>[item.key,item.value]));
    return {
      task: isMinimumEvidenceLevel(saved.get('minimumEvidence:task')) ? saved.get('minimumEvidence:task') as MinimumEvidenceLevel : defaultEvidenceRequirements.task,
      milestone: isMinimumEvidenceLevel(saved.get('minimumEvidence:milestone')) ? saved.get('minimumEvidence:milestone') as MinimumEvidenceLevel : defaultEvidenceRequirements.milestone,
    };
  } finally {d.close();}
}
export function setEvidenceRequirement(id: unknown, level: unknown): void {
  if (!evidenceNodeId(id) || !isMinimumEvidenceLevel(level)) throw new Error('无效的证据要求');
  const d=openDatabase();
  try { d.prepare("INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(`minimumEvidence:${id}`, level); } finally {d.close();}
}
export function readEvidence(database: DatabaseSync): Evidence[] { const rows=database.prepare('SELECT * FROM evidence ORDER BY created_at DESC').all() as Record<string, unknown>[]; const links=database.prepare('SELECT node_id FROM evidence_links WHERE evidence_id=?'); return rows.map(r=>({id:String(r.id),text:String(r.text),source:String(r.source),reference:String(r.reference),observedAt:String(r.observed_at),createdAt:String(r.created_at),links:(links.all(String(r.id)) as {node_id:NodeId}[]).map(x=>x.node_id),level:isEvidenceLevel(r.level)?r.level:'E1',reportSubmitted:r.report_submitted===null?null:Boolean(r.report_submitted),latencyMs:r.latency_ms===null?null:Number(r.latency_ms),benchmarkComplete:r.benchmark_complete===null?null:Boolean(r.benchmark_complete)})); }
export function listEvidence(): Evidence[] { const d=openDatabase(); try { return readEvidence(d); } finally {d.close();} }
export function saveEvidence(input: unknown): Evidence {
  if (!input || typeof input !== 'object') throw new Error('无效的证据');
  const v=input as Record<string,unknown>;
  if (typeof v.text!=='string' || !v.text.trim() || typeof v.source!=='string' || !v.source.trim() || typeof v.reference!=='string' || !v.reference.trim() || typeof v.observedAt!=='string' || !Number.isFinite(Date.parse(v.observedAt))) throw new Error('请填写证据原文、来源、引用和有效时间');
  if (!Array.isArray(v.links) || !v.links.length || !v.links.every(validId) || new Set(v.links).size !== v.links.length) throw new Error('请选择有效的关联对象');
  const level:EvidenceLevel = v.level === undefined ? 'E1' : isEvidenceLevel(v.level) ? v.level : (()=>{throw new Error('请选择有效的证据等级')})();
  if (![true,false,null].includes(v.reportSubmitted as boolean|null) || ![true,false,null].includes(v.benchmarkComplete as boolean|null) || !(v.latencyMs === null || (typeof v.latencyMs === 'number' && Number.isFinite(v.latencyMs) && v.latencyMs >= 0))) throw new Error('无效的核对结果');
  const id=randomUUID(), createdAt=new Date().toISOString(); const d=openDatabase();
  try {d.exec('BEGIN IMMEDIATE'); d.prepare('INSERT INTO evidence (id,text,source,reference,observed_at,created_at,report_submitted,latency_ms,benchmark_complete,level) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,v.text,v.source,v.reference,new Date(v.observedAt).toISOString(),createdAt,v.reportSubmitted===null?null:Number(v.reportSubmitted),v.latencyMs as number|null,v.benchmarkComplete===null?null:Number(v.benchmarkComplete),level); const insert=d.prepare('INSERT INTO evidence_links VALUES (?,?)'); for(const link of v.links) insert.run(id,link as string); d.exec('COMMIT');} catch(e) {d.exec('ROLLBACK'); throw e;} finally {d.close();}
  return listEvidence().find(e=>e.id===id)!;
}
