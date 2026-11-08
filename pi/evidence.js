/** pi extension: /evidence opens a reviewable evidence intake flow. */
const base = process.env.BUILDYOURSELF_URL || 'http://127.0.0.1:3000';
async function api(path, options) { const r=await fetch(`${base}${path}`,options); const data=await r.json(); if(!r.ok) throw new Error(data.error || `HTTP ${r.status}`); return data; }
export default function(pi) {
 pi.registerCommand('evidence', {description:'记录并核对一条文本证据', handler:async(args,ctx)=>{
  try {
   const graph=await api('/api/graph'); const available=graph.nodes; const current=available.find(n=>n.id===graph.context);
   const currentChoice=await ctx.ui.select(`当前对象：${current.title}（${current.type}）`, ['使用当前对象','选择其他对象','取消']);
   if(!currentChoice || currentChoice==='取消') return;
   let primary=current;
   if(currentChoice==='选择其他对象'){const choice=await ctx.ui.select('选择当前对象',available.map(n=>`${n.type}：${n.title}`)); if(!choice)return; primary=available.find(n=>`${n.type}：${n.title}`===choice); await api('/api/context',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:primary.id})});}
   const links=[primary.id];
   for(const n of available.filter(n=>n.id!==primary.id)){if(await ctx.ui.confirm('补充关联',`同时关联${n.type}「${n.title}」？`)) links.push(n.id);}
   const text=args.trim() || await ctx.ui.editor('证据原文',''); if(!text?.trim())return;
   const source=await ctx.ui.input('证据来源（例如：用户反馈）','用户反馈'); if(!source?.trim())return;
   const reference=await ctx.ui.input('证据引用（例如：报告路径或链接；没有外部引用可填“本条反馈”）','本条反馈'); if(!reference?.trim())return;
   const observed=await ctx.ui.input('证据时间（ISO 格式；留空使用当前时间）',new Date().toISOString()); if(observed===undefined)return;
   const observedAt=observed.trim() || new Date().toISOString(); if(!Number.isFinite(Date.parse(observedAt)))throw new Error('时间格式无效');
   let reportSubmitted=null, benchmarkComplete=null, latencyMs=null;
   if(links.includes('task')){const choice=await ctx.ui.select('核对：报告是否按要求提交？',['是','否','证据未说明']); if(!choice)return; reportSubmitted=choice==='证据未说明'?null:choice==='是';}
   if(links.includes('milestone')){const choice=await ctx.ui.select('核对：是否完成完整基准测试？',['是','否','证据未说明']); if(!choice)return; benchmarkComplete=choice==='证据未说明'?null:choice==='是'; const value=await ctx.ui.input('核对实测延迟（ms；无测量请留空）',''); if(value===undefined)return; if(value.trim()){latencyMs=Number(value); if(!Number.isFinite(latencyMs)||latencyMs<0)throw new Error('延迟必须是非负数');}}
   const summary=`原文：${text}\n来源：${source}\n引用：${reference}\n时间：${observedAt}\n关联：${links.map(id=>available.find(n=>n.id===id).title).join('、')}\n报告已提交：${reportSubmitted===null?'未说明':reportSubmitted?'是':'否'}\n完整基准测试：${benchmarkComplete===null?'未说明':benchmarkComplete?'是':'否'}\n延迟：${latencyMs===null?'未提供':`${latencyMs} ms`}`;
   if(!await ctx.ui.confirm('核对并保存证据',summary))return;
   await api('/api/evidence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,source,reference,observedAt,links,reportSubmitted,benchmarkComplete,latencyMs})});
   ctx.ui.notify('证据已保存，可在浏览器查看独立判定。','info');
  }catch(e){ctx.ui.notify(`证据未保存：${e.message}`,'error');}
 }});
}
