export type GoalDomain = 'learning' | 'fitness' | 'project' | 'general';

export type GoalDomainTemplateSource = {
  id: string;
  title: string;
  authors: string;
  version: string;
  url: string;
  supports: string;
  applicability: string;
  limitations: string;
};

export type GoalDomainTemplate = {
  id: GoalDomain;
  version: string;
  domain: GoalDomain;
  title: string;
  summary: string;
  applicabilityConditions: string[];
  limitations: string[];
  outcomeDimensions: string[];
  milestoneGuidance: string[];
  actionGuidance: string[];
  evidenceGuidance: string[];
  reviewQuestions: string[];
  sourceReferences: GoalDomainTemplateSource[];
};

const productSpec: GoalDomainTemplateSource = {
  id: 'buildyourself-mvp-prd-v0.1',
  title: 'BuildYourself MVP PRD',
  authors: 'BuildYourself project specification',
  version: 'v0.1 · §§8.2, 8.7, 8.8',
  url: 'https://github.com/LCJD99/BuildYourself/blob/main/docs/prds/MVP-PRD-v0.1.md',
  supports: '产品要求的目标结构、近期行动、里程碑、证据要求与复盘周期；学习、健身和项目型目标的评价维度。',
  applicability: 'BuildYourself 的目标创建与跟踪流程。',
  limitations: '产品需求文档描述产品约定，不是领域研究或个人专业建议。',
};

const learningEvidence: GoalDomainTemplateSource = {
  id: 'dunlosky-2013',
  title: 'Improving Students’ Learning With Effective Learning Techniques',
  authors: 'John Dunlosky, Katherine A. Rawson, Elizabeth J. Marsh, Mitchell J. Nathan, Daniel T. Willingham',
  version: 'Psychological Science in the Public Interest 14(1), 4–58 (2013); DOI 10.1177/1529100612453266',
  url: 'https://doi.org/10.1177/1529100612453266',
  supports: '综述评估多种学习策略；练习测验与分散练习在其评估中属于高效用策略，可作为学习计划的候选方法。',
  applicability: '有可回忆、练习或检查内容的学习目标；具体策略效果仍取决于学习内容、任务和反馈条件。',
  limitations: '不是个体化方案，不规定统一复习间隔，也不保证迁移或真实任务表现。',
};

const acsmResistanceTraining: GoalDomainTemplateSource = {
  id: 'acsm-resistance-training-2026',
  title: 'Resistance Training Prescription for Muscle Function, Hypertrophy, and Physical Performance in Healthy Adults: An Overview of Reviews',
  authors: 'American College of Sports Medicine',
  version: 'ACSM Position Stand (2026); DOI 10.1249/MSS.0000000000003897',
  url: 'https://pubmed.ncbi.nlm.nih.gov/41843416/',
  supports: '面向健康成年人的抗阻训练综述，为按表现结果设计训练与观察负荷变化提供参考。',
  applicability: '目标涉及健康成年人抗阻训练时。',
  limitations: '不用于诊断、康复或处理疾病/疼痛；不替用户决定安全负荷、动作或进阶幅度。非抗阻目标不套用其训练细节。',
};

const nasaSystemsEngineering: GoalDomainTemplateSource = {
  id: 'nasa-se-handbook-rev2',
  title: 'NASA Systems Engineering Handbook',
  authors: 'NASA',
  version: 'NASA/SP-2016-6105 Rev 2 (2016)',
  url: 'https://www.nasa.gov/wp-content/uploads/2018/09/nasa_systems_engineering_handbook_0.pdf',
  supports: '技术项目的生命周期、阶段安排，以及以要求和客观证据区分验证与确认。',
  applicability: '技术或系统工程项目，尤其存在正式要求、阶段审查和验证/确认活动时。',
  limitations: 'NASA 系统工程方法不应默认套用于个人创作、日常事务或不需要系统级工程流程的项目。',
};

const scrumGuide: GoalDomainTemplateSource = {
  id: 'scrum-guide-2020',
  title: 'The Scrum Guide',
  authors: 'Ken Schwaber and Jeff Sutherland',
  version: 'Official version, November 2020',
  url: 'https://scrumguides.org/scrum-guide.html',
  supports: 'Scrum 产品团队的 Product Goal、可用 Increment 与 Definition of Done（质量承诺）。',
  applicability: '用户的项目确实采用 Scrum 或以迭代产品交付为工作方式时。',
  limitations: 'Scrum 是特定框架，不是所有项目的必需流程；Definition of Done 必须由实际负责团队定义。',
};

const templates: GoalDomainTemplate[] = [
  {
    id: 'learning', version: '1.0.0', domain: 'learning', title: '学习目标模板',
    summary: '围绕掌握、留存、迁移和真实输出形成可编辑的阶段与证据。',
    applicabilityConditions: ['目标是学习知识、技能或语言，并能描述练习场景或产出。'],
    limitations: ['模板建议是待核对的计划草案，不保证学习效果。', '练习频率、难度、测验方式和成功阈值由用户结合课程与场景确定。'],
    outcomeDimensions: ['掌握', '留存', '迁移', '真实输出'],
    milestoneGuidance: ['分别描述当前水平、可独立完成的表现和真实场景输出。', '为可观察的阶段表现写明用户认可的质量标准和证据；远期标准可以暂定。'],
    actionGuidance: ['若基础未知，可由用户确认一次低风险基线练习。', '根据内容考虑练习测验、间隔安排或应用任务；不要为任何学习内容机械套用同一方法。', '把真实输出拆为近期可执行的练习，并记录反馈。'],
    evidenceGuidance: ['可选用自测记录、课程/教师反馈、作品或真实场景表现；明确证据分别能说明什么。', '完成练习只说明执行，不自动证明已经掌握、留存或迁移。'],
    reviewQuestions: ['能否不看材料解释或完成目标内容？', '过一段时间后还能否独立回忆？', '换一个问题或真实场景时能否使用？', '用户认可的输出质量标准是什么？'],
    sourceReferences: [productSpec, learningEvidence],
  },
  {
    id: 'fitness', version: '1.0.0', domain: 'fitness', title: '健身目标模板',
    summary: '围绕用户定义的表现、训练负荷和恢复记录形成可编辑计划。',
    applicabilityConditions: ['用户希望管理可观察的健身表现、训练习惯或能力趋势。', 'ACSM 抗阻训练资料只适用于健康成年人的抗阻训练目标。'],
    limitations: ['不提供诊断、康复或医疗处方；存在疾病、疼痛、伤病史或不确定安全性时，应由合格专业人员指导。', '不自动设定重量、训练量、进阶幅度或恢复天数；须结合个人情况由用户核对。'],
    outcomeDimensions: ['表现', '训练负荷', '恢复'],
    milestoneGuidance: ['先确认项目类型、当前能力和用户希望改善的表现。', '阶段标准采用用户选择且可安全观察的表现/能力指标，并记录测量条件。'],
    actionGuidance: ['基线可以是一次用户认为安全且可重复的记录或测量。', '记录实际完成的训练内容、负荷/时长/频率和主观恢复情况。', '加量或改变训练方式必须结合用户反馈后由用户确认，不自动进阶。'],
    evidenceGuidance: ['保留训练日志、重复条件下的表现记录与恢复自评。', '训练执行记录和表现变化是不同证据；不因单次波动推断长期适应。'],
    reviewQuestions: ['用户关注的表现是否有可重复的基线和评价条件？', '实际训练量与计划有何差异？', '恢复感受、疼痛或其他限制是否要求暂停并寻求专业建议？'],
    sourceReferences: [productSpec, acsmResistanceTraining],
  },
  {
    id: 'project', version: '1.0.0', domain: 'project', title: '项目目标模板',
    summary: '围绕交付物、阶段里程碑、用户定义的质量标准和验收证据组织项目。',
    applicabilityConditions: ['目标有明确交付物或可被验收的结果。', 'NASA 来源仅适合技术/系统工程；Scrum 来源仅适合确实采用 Scrum 或迭代产品交付的项目。'],
    limitations: ['不强制采用 NASA 生命周期或 Scrum；先识别项目类型和真实工作方式。', '质量阈值、验收人、截止时间和依赖必须来自用户或可核验的项目要求。'],
    outcomeDimensions: ['里程碑', '质量', '交付验收'],
    milestoneGuidance: ['把项目结果拆为阶段交付物，说明每个阶段的进入/退出条件。', '质量标准由用户、客户或正式要求确认；无法确认时标为待核对。'],
    actionGuidance: ['近期行动应产出可检查的项目对象或推进一项明确决策。', '为依赖关系、评审和交付设置行动；只有有来源支持时才写硬截止。', '远期交付可以保留为里程碑，实施路径根据反馈细化。'],
    evidenceGuidance: ['可使用交付文件、演示、测试/评审结果、验收记录或客户反馈。', '区分完成某项工作与交付物通过验收。'],
    reviewQuestions: ['交付物、责任方、质量标准和验收人是否明确？', '当前阶段的完成证据是什么？', '阶段变化是否要求修订范围、时间或质量约束？'],
    sourceReferences: [productSpec, nasaSystemsEngineering, scrumGuide],
  },
  {
    id: 'general', version: '1.0.0', domain: 'general', title: '通用目标模板',
    summary: '对没有专用领域模板的目标使用相同的意图、结果、基线、行动、证据和复盘流程。',
    applicabilityConditions: ['目标不属于学习、健身或项目型目标，或用户选择先使用通用框架。'],
    limitations: ['不因缺少专用模板阻止建目标。', '不补写未经用户确认的领域标准、专业方法或来源。'],
    outcomeDimensions: ['用户认可的成功结果', '可观察的基线与变化', '现实场景验证'],
    milestoneGuidance: ['将目标转成可观察结果；不确定的阶段标准可以保持暂定。', '每个近期里程碑需能被用户核对，远期标准可以说明以后如何细化。'],
    actionGuidance: ['优先选择一项具体、可执行且能提供反馈的近期行动。', '未知基线时询问用户是否接受一个低成本测量或试做。'],
    evidenceGuidance: ['先确认什么记录能够支持用户关心的结果。', '将完成状态、自评和外部/现实场景证据区分展示。'],
    reviewQuestions: ['结果是否可观察？', '有哪些限制会改变行动？', '能获得什么证据？', '何时复盘是否需要调整？'],
    sourceReferences: [productSpec],
  },
];

export function listGoalDomainTemplates(): GoalDomainTemplate[] {
  return templates.map(template => structuredClone(template));
}

export function getGoalDomainTemplate(id: string, version: string): GoalDomainTemplate | null {
  const template = templates.find(candidate => candidate.id === id && candidate.version === version);
  return template ? structuredClone(template) : null;
}
