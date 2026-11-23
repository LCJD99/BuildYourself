import { saveEvidence } from './store';
import { saveExternalCommitment } from './commitments';
import { activateGoalPlan, listGoalPlans, saveGoalPlanDraft } from './goal-plans';

let seedPromise: Promise<void> | null = null;

function day(offset: number) {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  return value.toISOString().slice(0, 10);
}

function plan(overrides: {
  sourceIntent: string;
  title: string;
  domain: 'learning' | 'fitness' | 'project';
  context: string;
  successDescription: string;
  observableResult: string;
  milestones: Array<{ title: string; stage: 'near' | 'future'; successCriteria: string; evidenceRequirement: string }>;
  nextActions: Array<{ title: string; details: string; estimateMinutes: number; priority: 'high' | 'medium'; hardDeadline?: string }>;
  constraints: string[];
  evidence: { item: string; description: string };
}) {
  return {
    sourceIntent: overrides.sourceIntent,
    title: overrides.title,
    domain: overrides.domain,
    context: overrides.context,
    successDescription: overrides.successDescription,
    observableResult: overrides.observableResult,
    baselineStatus: 'to_measure',
    baselineAction: '先用一次低压力练习记录当前水平。',
    milestones: overrides.milestones.map(item => ({
      ...item,
      standardAssessment: 'reasonable',
      evidenceAvailability: 'available',
      reviewNote: '标准和证据都可以通过实际产出核对。',
    })),
    nextActions: overrides.nextActions.map(item => ({
      ...item,
      hardDeadline: item.hardDeadline ?? null,
      milestoneId: null,
      dependsOn: [],
      specificity: 'concrete',
    })),
    constraints: { status: 'confirmed', items: overrides.constraints },
    evidenceRequirements: [{
      item: overrides.evidence.item,
      description: overrides.evidence.description,
      minimumLevel: 'E2',
    }],
    reviewCycleDays: 7,
  };
}

async function seed() {
  if (listGoalPlans().length > 0) return;

  const english = activateGoalPlan(saveGoalPlanDraft(plan({
    sourceIntent: '我想把英语表达练到能在会议里独立讲清楚项目。',
    title: '工作场景英语表达',
    domain: 'learning',
    context: '跨团队英文项目同步和临时问答',
    successDescription: '能在真实会议中独立完成 8 分钟项目说明并回答问题。',
    observableResult: '完成一次英文项目同步，并留下导师或同伴反馈。',
    milestones: [
      { title: '完成当前口语基线', stage: 'near', successCriteria: '录制 3 分钟完整英文项目介绍。', evidenceRequirement: '完整录音（E2）' },
      { title: '独立完成英文项目同步', stage: 'future', successCriteria: '能说明进度并回答三个追问。', evidenceRequirement: '会议录音或导师反馈（E3）' },
    ],
    nextActions: [
      { title: '录制 3 分钟英文项目介绍', details: '选一个正在做的项目，连续讲清背景、进度和下一步。', estimateMinutes: 25, priority: 'high' },
      { title: '整理本周展示提纲', details: '为课程展示准备结构。', estimateMinutes: 40, priority: 'high', hardDeadline: day(3) },
      { title: '复盘口语录音', details: '标记停顿、词汇缺口和需要重说的句子。', estimateMinutes: 20, priority: 'medium' },
    ],
    constraints: ['工作日晚上最多安排 45 分钟'],
    evidence: { item: '口语基线', description: '保存完整录音，并用同一标准复听。' },
  })).id);

  activateGoalPlan(saveGoalPlanDraft(plan({
    sourceIntent: '我想在八周里提升有氧和基础力量，同时保持羽毛球状态。',
    title: '八周体能基础周期',
    domain: 'fitness',
    context: '每周跑步、力量训练和一次羽毛球',
    successDescription: '8 周后能以更低的疲劳完成连续两次长距离有氧，并稳定完成基础力量训练。',
    observableResult: '同配速主观疲劳下降，深蹲达到阶段目标。',
    milestones: [
      { title: '建立四周训练基线', stage: 'near', successCriteria: '连续四周完成每周两次有氧和两次力量。', evidenceRequirement: '训练日志（E2）' },
      { title: '完成体能阶段测试', stage: 'future', successCriteria: '同配速下 RPE 下降，深蹲达到阶段重量。', evidenceRequirement: '训练记录与测试数据（E2）' },
    ],
    nextActions: [
      { title: '完成 30 分钟低强度跑步', details: '保持能正常对话的强度，结束后记录配速和 RPE。', estimateMinutes: 35, priority: 'medium' },
      { title: '完成上肢基础力量训练', details: '卧推和划船各四组，记录重量和 RPE。', estimateMinutes: 45, priority: 'medium' },
    ],
    constraints: ['高强度训练不与课程展示安排在同一天'],
    evidence: { item: '训练负荷', description: '记录动作、组数、重量和 RPE。' },
  })).id);

  activateGoalPlan(saveGoalPlanDraft(plan({
    sourceIntent: '我想把性能测试工具做成一个可持续迭代的项目。',
    title: '性能测试工具 v1',
    domain: 'project',
    context: '桌面端基准测试和报告生成',
    successDescription: '完成一个可重复运行的基准测试报告，并由同伴复现。',
    observableResult: '提交测试报告，完整基准测试延迟低于 200ms。',
    milestones: [
      { title: '完成首份基准报告', stage: 'near', successCriteria: '报告包含环境、命令和完整测量结果。', evidenceRequirement: '报告链接（E2）' },
      { title: '达到目标延迟', stage: 'near', successCriteria: '完整基准测试小于 200ms。', evidenceRequirement: '完整测量记录（E2）' },
    ],
    nextActions: [
      { title: '补齐基准测试环境信息', details: '记录硬件、依赖版本和运行命令。', estimateMinutes: 30, priority: 'high' },
      { title: '复跑一次完整基准测试', details: '保存完整输出并核对延迟。', estimateMinutes: 45, priority: 'high' },
    ],
    constraints: ['报告必须在周五前提交'],
    evidence: { item: '测试报告', description: '包含完整测量结果和复现步骤。' },
  })).id);

  const today = new Date();
  saveEvidence({
    text: '完成 3 分钟英文项目介绍录音。背景和进度讲清楚了，但在第二个追问处停顿明显。',
    source: '自评录音',
    reference: 'english-baseline-demo',
    observedAt: today.toISOString(),
    links: ['task', 'milestone'],
    level: 'E2',
    reportSubmitted: true,
    benchmarkComplete: true,
    latencyMs: 230,
  });

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  saveEvidence({
    text: '同伴反馈：结构完整，建议下一轮把开场压缩到 30 秒，并准备两个常见追问。',
    source: '同伴反馈',
    reference: 'peer-review-demo',
    observedAt: yesterday.toISOString(),
    links: ['goal'],
    level: 'E3',
    reportSubmitted: null,
    benchmarkComplete: null,
    latencyMs: null,
  });

  saveExternalCommitment({
    sourceText: '英语老师通知：周三前提交展示大纲，周五前完成 3 分钟口语录音。',
    deliverable: '英语课程展示',
    deadline: day(5),
    goalPlanId: english.id,
    tasks: [
      {
        title: '提交展示大纲',
        details: '包含开场、两个主体部分和总结。',
        deadline: day(3),
        estimateMinutes: 45,
        dependencies: [],
        acceptanceCriteria: '结构完整，可以直接用于展示准备。',
      },
      {
        title: '完成 3 分钟口语录音',
        details: '按展示稿录制成片，保留一次完整版本。',
        deadline: day(5),
        estimateMinutes: 30,
        dependencies: ['展示大纲'],
        acceptanceCriteria: '时长 3 分钟左右，内容完整。',
      },
    ],
    uncertainFields: [],
  });
}

export function ensureDemoData() {
  if (listGoalPlans().length > 0) return Promise.resolve();
  if (!seedPromise) {
    seedPromise = seed().finally(() => {
      seedPromise = null;
    });
  }
  return seedPromise;
}
