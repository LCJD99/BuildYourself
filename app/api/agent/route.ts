import { saveExternalCommitment } from '@/lib/commitments';
import { ensureDemoData } from '@/lib/demo-seed';
import { listGoalPlans, saveGoalPlanDraft } from '@/lib/goal-plans';
import { saveEvidence } from '@/lib/store';

export const dynamic = 'force-dynamic';

type MockIntent = 'goal' | 'commitment' | 'evidence' | 'help';

function classify(message: string): MockIntent {
  if (message.startsWith('/goal')) return 'goal';
  if (message.startsWith('/commitment')) return 'commitment';
  if (message.startsWith('/evidence')) return 'evidence';
  if (/(作业|通知|截止|提交|老师|任务)/.test(message)) return 'commitment';
  if (/(完成|反馈|录音|跑了|跑步|训练记录|成绩)/.test(message)) return 'evidence';
  if (/(目标|想学|想提升|计划|提升|保持|健身|英语|项目)/.test(message)) return 'goal';
  return 'help';
}

function clean(message: string) {
  return message.replace(/^\/(goal|commitment|evidence)\s*/i, '').trim();
}

function goalType(message: string): 'learning' | 'fitness' | 'project' | 'general' {
  if (/(健身|跑步|力量|运动|体能|游泳|羽毛球)/.test(message)) return 'fitness';
  if (/(项目|测试|开发|论文|产品)/.test(message)) return 'project';
  if (/(英语|学习|课程|阅读|口语|考试)/.test(message)) return 'learning';
  return 'general';
}

function titleFrom(message: string) {
  const value = clean(message).replace(/[。！？!?]/g, '');
  if (!value) return '新的长期目标';
  return value.length > 24 ? `${value.slice(0, 24)}…` : value;
}

function createMockGoal(message: string) {
  const text = clean(message) || '建立一个长期目标';
  const domain = goalType(text);
  const title = titleFrom(text);
  const result = domain === 'fitness'
    ? '用连续四周的训练记录证明基础能力变化，并完成一次阶段测试。'
    : domain === 'learning'
      ? '在真实场景中完成一次可量化的输出，并留下可复用的反馈证据。'
      : domain === 'project'
        ? '完成一个可以被他人复现和验收的阶段性交付。'
        : '在真实场景中留下至少两项可验证的结果证据。';

  return saveGoalPlanDraft({
    sourceIntent: text,
    title,
    domain,
    context: '由演示 Agent 根据当前输入生成的测试场景',
    successDescription: result,
    observableResult: result,
    baselineStatus: 'to_measure',
    baselineAction: '先完成一次低压力基线练习，并记录当前表现。',
    milestones: [
      {
        title: '完成基线观察',
        stage: 'near',
        successCriteria: '完成一次可复盘的基线活动。',
        standardAssessment: 'reasonable',
        evidenceAvailability: 'available',
        reviewNote: '演示数据：基线证据可以立即获得。',
        evidenceRequirement: '可验证产出一份（E2）。',
      },
      {
        title: '完成一次真实应用',
        stage: 'future',
        successCriteria: '在真实场景中迁移并得到反馈。',
        standardAssessment: 'provisional',
        evidenceAvailability: 'future',
        reviewNote: '演示模式：进入下一阶段后再细化标准。',
        evidenceRequirement: '真实应用或外部反馈（E2 或 E3）。',
      },
    ],
    nextActions: [
      {
        title: `完成「${title}」的基线行动`,
        details: '用一次低压力练习记录当前水平和主要问题。',
        estimateMinutes: 30,
        priority: 'high',
        hardDeadline: null,
        milestoneId: null,
        dependsOn: [],
        specificity: 'concrete',
      },
      {
        title: '整理第一轮反馈',
        details: '记录哪些做法有效，哪些需要调整。',
        estimateMinutes: 20,
        priority: 'medium',
        hardDeadline: null,
        milestoneId: null,
        dependsOn: [],
        specificity: 'concrete',
      },
    ],
    constraints: { status: 'confirmed', items: ['演示模式：暂不设置额外限制'] },
    evidenceRequirements: [
      {
        item: '基线证据',
        description: '一份可以复盘的产出、记录或外部反馈。',
        minimumLevel: 'E2',
      },
    ],
    reviewCycleDays: 7,
  });
}

function createMockCommitment(message: string) {
  const text = clean(message) || '老师布置了一项新的课程作业。';
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + 4);
  const goal = listGoalPlans().find(item => item.status === 'active' && item.domain === 'learning')
    ?? listGoalPlans().find(item => item.status === 'active');
  return saveExternalCommitment({
    sourceText: text,
    deliverable: text.length > 32 ? `${text.slice(0, 32)}…` : text,
    deadline: deadline.toISOString().slice(0, 10),
    goalPlanId: goal?.id ?? null,
    tasks: [
      {
        title: '确认要求并拆分交付',
        details: '演示 Agent 根据通知生成的任务。',
        deadline: deadline.toISOString().slice(0, 10),
        estimateMinutes: 45,
        dependencies: [],
        acceptanceCriteria: '交付内容完整，能够按通知要求验收。',
      },
      {
        title: '完成最终提交',
        details: '保存一版可验证的最终产出。',
        deadline: deadline.toISOString().slice(0, 10),
        estimateMinutes: 30,
        dependencies: ['确认要求并拆分交付'],
        acceptanceCriteria: '最终产出已经提交并留下记录。',
      },
    ],
    uncertainFields: [],
  });
}

function createMockEvidence(message: string) {
  const text = clean(message) || '完成了一次目标相关练习，并记录了当前表现。';
  return saveEvidence({
    text,
    source: '演示 Agent',
    reference: `mock-evidence-${Date.now()}`,
    observedAt: new Date().toISOString(),
    links: ['task', 'milestone'],
    level: 'E2',
    reportSubmitted: true,
    benchmarkComplete: true,
    latencyMs: 230,
  });
}

export async function GET() {
  await ensureDemoData();
  return Response.json({ configured: true, mode: 'mock' });
}

export async function POST(request: Request) {
  await ensureDemoData();
  let body: { message?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ message: '请求格式无效。' }, { status: 400 });
  }
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return Response.json({ message: '请输入内容。' }, { status: 400 });

  await new Promise(resolve => setTimeout(resolve, 450));
  try {
    const intent = classify(message);
    if (intent === 'goal') {
      const draft = createMockGoal(message);
      return Response.json({
        reply: `已生成目标草稿「${draft.title}」。\n\n我建议先核对成功描述、两个里程碑和证据要求；确认后点击“核对并启用”，近期行动才会进入待排池。\n\n这是演示模式生成的确定性数据，不会调用外部模型。`,
        intent,
        draftId: draft.id,
      });
    }
    if (intent === 'commitment') {
      const commitment = createMockCommitment(message);
      return Response.json({
        reply: `已登记外部承诺「${commitment.deliverable}」。\n\n识别到 2 项任务，归属：${commitment.goalTitle || '杂项'}。承诺当前状态为“已确认 · 尚未排入”，原计划没有被自动修改。\n\n这是演示模式生成的确定性数据。`,
        intent,
        commitmentId: commitment.id,
      });
    }
    if (intent === 'evidence') {
      const evidence = createMockEvidence(message);
      return Response.json({
        reply: `已记录一条 E2 证据，并关联到任务与里程碑。\n\n执行记录会更新，但能力进展仍按证据和里程碑标准独立判断。\n\n演示引用：${evidence.reference}`,
        intent,
        evidenceId: evidence.id,
      });
    }
    return Response.json({
      reply: '我可以模拟三类操作：\n\n1. 输入“我想在 12 周内提升英语表达”，生成目标草稿。\n2. 粘贴老师通知，生成外部承诺。\n3. 输入“完成了一次 3 分钟口语录音”，生成执行证据。\n\n当前为演示模式，不需要登录模型。',
      intent,
    });
  } catch (error) {
    return Response.json({
      message: error instanceof Error ? error.message : '演示 Agent 处理失败。',
    }, { status: 400 });
  }
}
