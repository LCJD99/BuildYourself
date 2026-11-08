import { describe,it,expect } from 'vitest';
import { assessEvidence, evaluate, type Evidence } from '../lib/model';
const e:Evidence={id:'1',text:'测试报告已按要求提交，完整基准测试测得延迟 230 ms',source:'用户反馈',reference:'测试报告',observedAt:'2026-11-08T00:00:00Z',createdAt:'2026-11-08T00:00:00Z',links:['task','milestone'],level:'E1',reportSubmitted:true,latencyMs:230,benchmarkComplete:true};
describe('独立评价',()=>{it('一份证据可支持不同结论',()=>{const [task,milestone]=evaluate([e]);expect(task.status).toBe('交付已验收');expect(milestone.status).toBe('本次实测未达标');expect(task.evidence[0].id).toBe(milestone.evidence[0].id)});it('报告不等于测量',()=>{const r=evaluate([{...e,latencyMs:null,benchmarkComplete:null}]);expect(r[0].status).toBe('交付已验收');expect(r[1].gap).toContain('延迟测量')});it('边界与不完整测试',()=>{expect(evaluate([{...e,latencyMs:200}])[1].status).toBe('本次实测未达标');expect(evaluate([{...e,latencyMs:199}])[1].status).toBe('达到标准，待确认');expect(evaluate([{...e,benchmarkComplete:false}])[1].status).toBe('证据不足')});it('只评价关联对象',()=>{const r=evaluate([{...e,links:['task']}]);expect(r[0].status).toBe('交付已验收');expect(r[1].status).toBe('证据不足')})});

describe('证据门槛',()=>{
 it('显示缺少的等级，并在符合门槛后转为充足',()=>{
  const initial=assessEvidence([e],'task','E2');
  expect(initial.status).toBe('证据不足');
  expect(initial.gap).toContain('E2');
  const qualified=assessEvidence([{...e,level:'E2'}],'task','E2');
  expect(qualified.status).toBe('证据充足');
  expect(qualified.highestLevel).toBe('E2');
 });
 it('E0 无需证据，E3 满足 E2 门槛',()=>{
  expect(assessEvidence([],'milestone','E0').status).toBe('无需证据');
  expect(assessEvidence([{...e,level:'E3'}],'milestone','E2').status).toBe('证据充足');
 });
 it('补充证据状态不会改变既有结果判定',()=>{
  const before=evaluate([e]);
  const after=evaluate([{...e,level:'E3'}]);
  expect(after.map(result=>result.status)).toEqual(before.map(result=>result.status));
 });
});
