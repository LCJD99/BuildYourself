import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getContext, listEvidence, saveEvidence, setContext } from '../lib/store';
const dir=mkdtempSync(join(tmpdir(),'buildyourself-test-'));
process.env.BUILDYOURSELF_DB=join(dir,'graph.sqlite');
afterAll(()=>rmSync(dir,{recursive:true,force:true}));
describe('本地图谱',()=>{
 it('保存一份原文和多个关联，并从独立连接重新读取',()=>{
  setContext('milestone'); expect(getContext()).toBe('milestone');
  const item=saveEvidence({text:'测试报告已提交，延迟 230 ms',source:'用户反馈',reference:'报告 #1',observedAt:'2026-11-08T12:00:00+08:00',links:['task','milestone'],reportSubmitted:true,benchmarkComplete:true,latencyMs:230});
  const saved=listEvidence(); expect(saved).toHaveLength(1); expect(saved[0]).toEqual(item); expect(saved[0].links.sort()).toEqual(['milestone','task']);
 });
 it('拒绝无效关联，避免写入部分记录',()=>{
  expect(()=>saveEvidence({text:'反馈',source:'用户',reference:'本条反馈',observedAt:'2026-11-08',links:['task','unknown'],reportSubmitted:true,benchmarkComplete:null,latencyMs:null})).toThrow();
  expect(listEvidence()).toHaveLength(1);
 });
});
