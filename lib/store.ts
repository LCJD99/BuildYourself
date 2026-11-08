import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Evidence, NodeId, nodes } from './model';

function db() {
  const path = resolve(process.env.BUILDYOURSELF_DB || './data/graph.sqlite');
  mkdirSync(dirname(path), { recursive: true });
  const d = new DatabaseSync(path);
  d.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, text TEXT NOT NULL, source TEXT NOT NULL, reference TEXT NOT NULL, observed_at TEXT NOT NULL, created_at TEXT NOT NULL, report_submitted INTEGER, latency_ms REAL, benchmark_complete INTEGER);
    CREATE TABLE IF NOT EXISTS evidence_links (evidence_id TEXT NOT NULL REFERENCES evidence(id), node_id TEXT NOT NULL, PRIMARY KEY(evidence_id,node_id));
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  return d;
}
const validId = (id: unknown): id is NodeId => nodes.some(n => n.id === id);
export function getContext(): NodeId { const d=db(); try { const row=d.prepare("SELECT value FROM settings WHERE key='context'").get() as {value:string}|undefined; return validId(row?.value) ? row.value : 'task'; } finally {d.close();} }
export function setContext(id: unknown) { if (!validId(id)) throw new Error('无效的对象'); const d=db(); try {d.prepare("INSERT INTO settings VALUES ('context', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(id);} finally {d.close();} }
export function listEvidence(): Evidence[] { const d=db(); try { const rows=d.prepare('SELECT * FROM evidence ORDER BY created_at DESC').all() as Record<string, unknown>[]; const links=d.prepare('SELECT node_id FROM evidence_links WHERE evidence_id=?'); return rows.map(r=>({id:String(r.id),text:String(r.text),source:String(r.source),reference:String(r.reference),observedAt:String(r.observed_at),createdAt:String(r.created_at),links:(links.all(String(r.id)) as {node_id:NodeId}[]).map(x=>x.node_id),reportSubmitted:r.report_submitted===null?null:Boolean(r.report_submitted),latencyMs:r.latency_ms===null?null:Number(r.latency_ms),benchmarkComplete:r.benchmark_complete===null?null:Boolean(r.benchmark_complete)})); } finally {d.close();} }
export function saveEvidence(input: unknown): Evidence {
  if (!input || typeof input !== 'object') throw new Error('无效的证据');
  const v=input as Record<string,unknown>;
  if (typeof v.text!=='string' || !v.text.trim() || typeof v.source!=='string' || !v.source.trim() || typeof v.reference!=='string' || !v.reference.trim() || typeof v.observedAt!=='string' || !Number.isFinite(Date.parse(v.observedAt))) throw new Error('请填写证据原文、来源、引用和有效时间');
  if (!Array.isArray(v.links) || !v.links.length || !v.links.every(validId) || new Set(v.links).size !== v.links.length) throw new Error('请选择有效的关联对象');
  if (![true,false,null].includes(v.reportSubmitted as boolean|null) || ![true,false,null].includes(v.benchmarkComplete as boolean|null) || !(v.latencyMs === null || (typeof v.latencyMs === 'number' && Number.isFinite(v.latencyMs) && v.latencyMs >= 0))) throw new Error('无效的核对结果');
  const id=randomUUID(), createdAt=new Date().toISOString(); const d=db();
  try {d.exec('BEGIN IMMEDIATE'); d.prepare('INSERT INTO evidence VALUES (?,?,?,?,?,?,?,?,?)').run(id,v.text,v.source,v.reference,new Date(v.observedAt).toISOString(),createdAt,v.reportSubmitted===null?null:Number(v.reportSubmitted),v.latencyMs as number|null,v.benchmarkComplete===null?null:Number(v.benchmarkComplete)); const insert=d.prepare('INSERT INTO evidence_links VALUES (?,?)'); for(const link of v.links) insert.run(id,link as string); d.exec('COMMIT');} catch(e) {d.exec('ROLLBACK'); throw e;} finally {d.close();}
  return listEvidence().find(e=>e.id===id)!;
}
