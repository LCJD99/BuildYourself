import { afterAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate } from '../lib/model';
import { getContext, getEvidenceRequirements, getTaskExecution, listEvidence, saveEvidence, setContext, setEvidenceRequirement, setTaskExecution } from '../lib/store';
const dir=mkdtempSync(join(tmpdir(),'buildyourself-test-'));
process.env.BUILDYOURSELF_DB=join(dir,'graph.sqlite');
afterAll(()=>rmSync(dir,{recursive:true,force:true}));
describe('本地图谱',()=>{
 it('保存一份原文和多个关联，并从独立连接重新读取',()=>{
  setContext('milestone'); expect(getContext()).toBe('milestone');
  const item=saveEvidence({text:'测试报告已提交，延迟 230 ms',source:'用户反馈',reference:'报告 #1',observedAt:'2026-11-08T12:00:00+08:00',links:['task','milestone'],level:'E2',reportSubmitted:true,benchmarkComplete:true,latencyMs:230});
  const saved=listEvidence(); expect(saved).toHaveLength(1); expect(saved[0]).toEqual(item); expect(saved[0].links.sort()).toEqual(['milestone','task']);
 });
 it('拒绝无效关联，避免写入部分记录',()=>{
  expect(()=>saveEvidence({text:'反馈',source:'用户',reference:'本条反馈',observedAt:'2026-11-08',links:['task','unknown'],level:'E1',reportSubmitted:true,benchmarkComplete:null,latencyMs:null})).toThrow();
  expect(listEvidence()).toHaveLength(1);
 });
 it('保存独立的执行时间与对象证据门槛',()=>{
  expect(getTaskExecution()).toEqual({completedAt:null});
  expect(getEvidenceRequirements()).toEqual({task:'E1',milestone:'E2'});
  const resultStatuses=evaluate(listEvidence()).map(result=>result.status);
  const execution=setTaskExecution(true);
  expect(execution.completedAt).toBeTruthy();
  expect(Date.parse(execution.completedAt!)).not.toBeNaN();
  expect(getTaskExecution()).toEqual(execution);
  expect(evaluate(listEvidence()).map(result=>result.status)).toEqual(resultStatuses);
  expect(setTaskExecution(false)).toEqual({completedAt:null});
  setEvidenceRequirement('task','E2');
  expect(getEvidenceRequirements().task).toBe('E2');
  expect(()=>setEvidenceRequirement('goal','E1')).toThrow();
  expect(()=>setEvidenceRequirement('task','E4')).toThrow();
 });
 it('升级旧数据库时保留原证据并默认按 E1 处理',()=>{
  const legacyPath=join(dir,'legacy.sqlite');
  const legacy=new DatabaseSync(legacyPath);
  legacy.exec("CREATE TABLE evidence (id TEXT PRIMARY KEY, text TEXT NOT NULL, source TEXT NOT NULL, reference TEXT NOT NULL, observed_at TEXT NOT NULL, created_at TEXT NOT NULL, report_submitted INTEGER, latency_ms REAL, benchmark_complete INTEGER); CREATE TABLE evidence_links (evidence_id TEXT NOT NULL, node_id TEXT NOT NULL, PRIMARY KEY(evidence_id,node_id)); INSERT INTO evidence VALUES ('legacy-1','旧反馈','用户','旧记录','2026-11-08T00:00:00.000Z','2026-11-08T00:00:00.000Z',1,NULL,NULL); INSERT INTO evidence_links VALUES ('legacy-1','task');");
  legacy.close();
  const previousPath=process.env.BUILDYOURSELF_DB;
  process.env.BUILDYOURSELF_DB=legacyPath;
  try {
   const [item]=listEvidence();
   expect(item).toMatchObject({id:'legacy-1',text:'旧反馈',level:'E1',links:['task']});
  } finally {
   process.env.BUILDYOURSELF_DB=previousPath;
  }
 });
});
