'use client';

import { useMemo, useState } from 'react';

type View = 'today' | 'goals' | 'attribute' | 'calendar' | 'review' | 'action';
type ProjectMode = 'ability' | 'logic' | 'time';
type Attribute = { id: string; name: string; progress: number; note: string; color: string; importance: number };
type Action = {
  id: string;
  goalId: string;
  title: string;
  date: string;
  mode: 'planned' | 'extra';
  status: 'todo' | 'done';
  attribute: string;
  duration: string;
  feedback?: string;
};
type Goal = {
  id: string;
  title: string;
  domain: string;
  deadline: string;
  description: string;
  progress: number;
  color: string;
  importance: number;
  attributes: Attribute[];
};
type Message = { role: 'user' | 'agent'; text: string };
type CalendarCell = { date: string; day: number; inMonth: boolean };
type AgentIntent = 'goal' | 'commitment' | 'extra' | 'feedback' | 'review' | 'unknown';
type AgentMode = 'goal' | 'global';

const TODAY = '2026-11-23';

const initialGoals: Goal[] = [
  {
    id: 'english', title: '工作场景英语表达', domain: '英语学习', deadline: '2027-02-15',
    description: '能在工作会议中清楚表达观点，并完成 5 分钟英文演示。', progress: 48, color: '#3d7569', importance: 3,
    attributes: [
      { id: 'speaking', name: '口语表达', progress: 42, note: '能完整表达，但追问时会停顿', color: '#3d7569', importance: 3 },
      { id: 'listening', name: '听力理解', progress: 58, note: '日常会议语速基本可跟上', color: '#8eaa65', importance: 2 },
      { id: 'reading', name: '专业阅读', progress: 64, note: '能抓住论文和课程的主要观点', color: '#c19a55', importance: 1 },
    ],
  },
  {
    id: 'fitness', title: '八周体能基础周期', domain: '健身', deadline: '2027-01-18',
    description: '建立稳定的有氧与力量训练习惯，提升耐力和基础力量。', progress: 61, color: '#b97045', importance: 2,
    attributes: [
      { id: 'aerobic', name: '有氧耐力', progress: 66, note: '5 公里配速比周期开始快 8%', color: '#b97045', importance: 3 },
      { id: 'strength', name: '基础力量', progress: 51, note: '下肢力量稳定，上肢还需补足', color: '#c88a4a', importance: 2 },
      { id: 'recovery', name: '恢复状态', progress: 72, note: '睡眠和训练间隔较稳定', color: '#8eaa65', importance: 1 },
    ],
  },
  {
    id: 'project', title: '性能测试工具 v1', domain: '项目', deadline: '2027-01-05',
    description: '完成可供团队使用的第一版性能测试工具和使用说明。', progress: 35, color: '#7379a9', importance: 1,
    attributes: [
      { id: 'delivery', name: '交付完整度', progress: 38, note: '核心流程已经打通', color: '#7379a9', importance: 2 },
      { id: 'quality', name: '质量可靠性', progress: 31, note: '边界场景仍需要补测试', color: '#9a83b3', importance: 3 },
      { id: 'collab', name: '协作推进', progress: 44, note: '接口约定已经同步给队友', color: '#c19a55', importance: 1 },
    ],
  },
];

const initialActions: Action[] = [
  { id: 'a1', goalId: 'english', title: '完成 3 分钟工作场景口语录音', date: TODAY, mode: 'planned', status: 'todo', attribute: '口语表达', duration: '20 分钟' },
  { id: 'a2', goalId: 'fitness', title: '慢跑 30 分钟，记录体感和配速', date: TODAY, mode: 'planned', status: 'todo', attribute: '有氧耐力', duration: '30 分钟' },
  { id: 'a3', goalId: 'project', title: '补齐测试工具的异常用例', date: TODAY, mode: 'planned', status: 'todo', attribute: '质量可靠性', duration: '45 分钟' },
  { id: 'a4', goalId: 'english', title: '整理 MOOC 第 6 讲的 10 个表达', date: '2026-11-24', mode: 'planned', status: 'todo', attribute: '专业阅读', duration: '25 分钟' },
  { id: 'a5', goalId: 'fitness', title: '力量训练：深蹲、推举、划船', date: '2026-11-25', mode: 'planned', status: 'done', attribute: '基础力量', duration: '50 分钟', feedback: '动作完成，最后两组略有疲劳' },
  { id: 'a6', goalId: 'english', title: '阅读一篇英文论文摘要并复述', date: '2026-11-26', mode: 'planned', status: 'done', attribute: '专业阅读', duration: '30 分钟', feedback: '抓住了研究问题和结论' },
  { id: 'a7', goalId: 'fitness', title: '打羽毛球 60 分钟', date: '2026-11-22', mode: 'extra', status: 'done', attribute: '有氧耐力', duration: '60 分钟', feedback: 'Agent 判断：对有氧耐力有收益，已计入属性' },
];

const weeklyReviews = [
  { date: '2026-11-22', title: '第 46 周复盘', summary: '英语阅读保持稳定；羽毛球被纳入有氧耐力。' },
];

function Progress({ value, color = '#3d7569' }: { value: number; color?: string }) {
  return <div className="progress-track"><span style={{ width: `${value}%`, background: color }} /></div>;
}

function DomainIcon({ domain }: { domain: string }) {
  return <span className={`domain-icon ${domain === '英语学习' ? 'green' : domain === '健身' ? 'orange' : 'violet'}`}>{domain === '英语学习' ? '文' : domain === '健身' ? '动' : '项'}</span>;
}

function formatCalendarDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function buildCalendarWeeks(month: string): CalendarCell[][] {
  const [year, monthNumber] = month.split('-').map(Number);
  const firstDay = new Date(year, monthNumber - 1, 1);
  const firstWeekday = (firstDay.getDay() + 6) % 7;
  return Array.from({ length: 6 }, (_, weekIndex) => Array.from({ length: 7 }, (_, weekdayIndex) => {
    const date = new Date(year, monthNumber - 1, 1 + weekIndex * 7 + weekdayIndex - firstWeekday);
    return { date: formatCalendarDate(date), day: date.getDate(), inMonth: monthKey(date) === month };
  }));
}

function classifyAgentIntent(text: string): AgentIntent {
  const value = text.trim();
  if (!value) return 'unknown';
  if (/额外|意外事项|计划外|顺便完成|另外完成|临时完成/.test(value)) return 'extra';
  if (/长期目标|想在|希望在|目标是|调试|拆解|约束|指标|逻辑图|\/goal/.test(value)) return 'goal';
  if (/老师|作业|截止|提交|考试|临时要求|通知/.test(value)) return 'commitment';
  if (/复盘|下周|回顾/.test(value)) return 'review';
  if (/完成|做了|跑步|慢跑|训练|打羽毛球|游泳|跳舞|撸铁|录音|阅读|整理/.test(value)) return 'feedback';
  return 'unknown';
}

function cleanExtraActionText(text: string) {
  return text
    .replace(/^\s*(?:今天|我|刚刚|刚才)+\s*/, '')
    .replace(/^\s*(?:额外|意外事项|计划外|顺便|另外)\s*/, '')
    .replace(/^\s*(?:完成了?|做了|记录了?|新增了?)\s*[:：]?\s*/, '')
    .trim();
}

export default function Workspace() {
  const [view, setView] = useState<View>('today');
  const [goals, setGoals] = useState(initialGoals);
  const [actions, setActions] = useState(initialActions);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentMode, setAgentMode] = useState<AgentMode>('goal');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    { role: 'agent', text: '你好，我会协助你创建、拆解和调试长期目标。' },
  ]);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackInput, setFeedbackInput] = useState('');
  const [feedbackActionId, setFeedbackActionId] = useState<string | null>(null);
  const [feedbackMessages, setFeedbackMessages] = useState<Message[]>([]);
  const [reviewFeedback, setReviewFeedback] = useState('');
  const [nextWeekNeeds, setNextWeekNeeds] = useState('');
  const [nextWeekReady, setNextWeekReady] = useState(false);
  const [feedbackApplied, setFeedbackApplied] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [projectMode, setProjectMode] = useState<ProjectMode>('ability');
  const [draggedAttributeId, setDraggedAttributeId] = useState<string | null>(null);
  const [dragOverAttributeId, setDragOverAttributeId] = useState<string | null>(null);
  const [draggedGoalId, setDraggedGoalId] = useState<string | null>(null);
  const [dragOverGoalId, setDragOverGoalId] = useState<string | null>(null);
  const [draggedActionId, setDraggedActionId] = useState<string | null>(null);
  const [dragOverActionId, setDragOverActionId] = useState<string | null>(null);
  const [calendarDate, setCalendarDate] = useState('2026-11-23');
  const [calendarMonth, setCalendarMonth] = useState('2026-11');
  const [calendarScope, setCalendarScope] = useState<'month' | 'year'>('month');
  const [actionFocus, setActionFocus] = useState<Action | null>(null);
  const [selectedAttributeName, setSelectedAttributeName] = useState<string | null>(null);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [activeGoalsOpen, setActiveGoalsOpen] = useState(false);
  const [extraActionOpen, setExtraActionOpen] = useState(false);
  const [extraActionInput, setExtraActionInput] = useState('');
  const [extraActionGoalId, setExtraActionGoalId] = useState(initialGoals[0].id);

  const selectedGoal = goals.find(goal => goal.id === selectedGoalId) ?? goals[0];
  const todayActions = actions.filter(action => action.date === TODAY);
  const completedToday = todayActions.filter(action => action.status === 'done').length;
  const weekActions = actions.filter(action => action.date >= '2026-11-21' && action.date <= '2026-11-27');
  const doneThisWeek = weekActions.filter(action => action.status === 'done').length;
  const goalActions = actions.filter(action => action.goalId === selectedGoal.id);
  const selectedAction = actions.find(action => action.id === selectedActionId) ?? null;
  const agentIntent = classifyAgentIntent(input);
  const selectedAttribute = selectedGoal.attributes.find(attribute => attribute.name === selectedAttributeName) ?? null;
  const sortedGoals = [...goals].sort((a, b) => b.importance - a.importance);
  const sortedAttributes = [...selectedGoal.attributes].sort((a, b) => b.importance - a.importance);
  const calendarWeeks = useMemo(() => buildCalendarWeeks(calendarMonth), [calendarMonth]);
  const calendarYear = Number(calendarMonth.slice(0, 4));
  const calendarMonthNumber = Number(calendarMonth.slice(5, 7));
  const calendarMonthLabel = `${calendarYear} 年 ${calendarMonthNumber} 月`;
  const yearGoalsCompleted = goals.filter(goal => goal.progress >= 100);
  const yearGoalsInProgress = goals.filter(goal => goal.progress < 100);
  const yearMonthSummary = Array.from({ length: 12 }, (_, index) => {
    const month = `${calendarYear}-${String(index + 1).padStart(2, '0')}`;
    return { month, count: actions.filter(action => action.date.startsWith(month) && action.status === 'done').length };
  });
  const goalLabel = useMemo(() => (goal: Goal) => goal.domain, []);
  const growthLabel = (value: number) => value >= 70 ? '稳定' : value >= 45 ? '进展中' : value >= 25 ? '起步' : '待定义';
  const dailyPrinciple = completedToday > 0 ? '先反馈，再继续' : '看清楚，做一件';

  function generateNextWeek() {
    setFeedbackApplied(/练腿|腿疼|无法走路|强度|恢复/i.test(`${reviewFeedback} ${nextWeekNeeds}`));
    setNextWeekReady(true);
  }

  function reorderAttribute(sourceId: string, targetId: string) {
    setGoals(current => current.map(goal => {
      if (goal.id !== selectedGoal.id) return goal;
      const ordered = [...goal.attributes].sort((a, b) => b.importance - a.importance);
      const sourceIndex = ordered.findIndex(attribute => attribute.id === sourceId);
      const targetIndex = ordered.findIndex(attribute => attribute.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return goal;
      const [moved] = ordered.splice(sourceIndex, 1);
      ordered.splice(targetIndex, 0, moved);
      const maxImportance = ordered.length;
      return { ...goal, attributes: ordered.map((attribute, position) => ({ ...attribute, importance: maxImportance - position })) };
    }));
  }

  function reorderGoal(sourceId: string, targetId: string) {
    setGoals(current => {
      const ordered = [...current].sort((a, b) => b.importance - a.importance);
      const sourceIndex = ordered.findIndex(goal => goal.id === sourceId);
      const targetIndex = ordered.findIndex(goal => goal.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return current;
      const [moved] = ordered.splice(sourceIndex, 1);
      ordered.splice(targetIndex, 0, moved);
      const maxImportance = ordered.length;
      return ordered.map((goal, position) => ({ ...goal, importance: maxImportance - position }));
    });
  }

  function reorderTodayAction(sourceId: string, targetId: string) {
    setActions(current => {
      const orderedToday = current.filter(action => action.date === TODAY);
      const sourceIndex = orderedToday.findIndex(action => action.id === sourceId);
      const targetIndex = orderedToday.findIndex(action => action.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return current;
      const [moved] = orderedToday.splice(sourceIndex, 1);
      orderedToday.splice(targetIndex, 0, moved);
      let todayIndex = 0;
      return current.map(action => action.date === TODAY ? orderedToday[todayIndex++] : action);
    });
  }

  function selectCalendarDate(date: string) {
    setCalendarDate(date);
    setCalendarMonth(date.slice(0, 7));
    setCalendarScope('month');
  }

  function shiftCalendarPeriod(direction: -1 | 1) {
    if (calendarScope === 'year') {
      const nextYear = calendarYear + direction;
      const nextMonth = `${nextYear}-${String(calendarMonthNumber).padStart(2, '0')}`;
      setCalendarMonth(nextMonth);
      setCalendarDate(`${nextMonth}-01`);
      return;
    }
    const current = new Date(calendarYear, calendarMonthNumber - 1, 1);
    current.setMonth(current.getMonth() + direction);
    const nextMonth = monthKey(current);
    setCalendarMonth(nextMonth);
    setCalendarDate(`${nextMonth}-01`);
  }

  function changeView(next: View) {
    setView(next);
    setActionFocus(null);
    setSelectedAttributeName(null);
    setSelectedActionId(null);
    setActiveGoalsOpen(false);
    if (next === 'goals') setSelectedGoalId(null);
  }

  function openAttributeDetail(attribute: Attribute) {
    setSelectedAttributeName(attribute.name);
    setSelectedActionId(null);
    setView('attribute');
  }

  function goBack() {
    if (view === 'action') {
      setSelectedActionId(null);
      setView('attribute');
      return;
    }
    if (view === 'attribute') {
      setSelectedAttributeName(null);
      setView('goals');
      return;
    }
    if (view === 'goals' && selectedGoalId) {
      setSelectedGoalId(null);
      setSelectedAttributeName(null);
      return;
    }
    setView('today');
  }

  function openGoalAgent(prefill = '') {
    setAgentMode('goal');
    setMessages([{ role: 'agent', text: '你好，我会协助你创建、拆解和调试长期目标。' }]);
    setInput(prefill);
    setAgentOpen(true);
  }

  function openGlobalAgent() {
    setAgentMode('global');
    setMessages([{ role: 'agent', text: '你好，我是综合入口。你可以描述任何与长期目标有关的事情，我会先判断它属于目标、临时要求、计划外行动还是行动反馈。' }]);
    setInput('');
    setAgentOpen(true);
  }

  function openFeedbackDialog(action?: Action, prefill = '') {
    const target = action ?? todayActions.find(item => item.status === 'todo') ?? todayActions[0] ?? null;
    setActionFocus(target);
    setFeedbackActionId(target?.id ?? null);
    setFeedbackInput(prefill);
    setFeedbackMessages([{ role: 'agent', text: target ? `这里专门记录「${target.title}」的完成情况。请用自然语言告诉我你实际做了什么，以及过程中的感受。` : '这里专门记录今日行动反馈。请告诉我今天实际完成了什么。' }]);
    setAgentOpen(false);
    setFeedbackOpen(true);
  }

  function completeAction(action: Action) {
    if (action.status === 'done') {
      openActionDetail(action);
      return;
    }
    openFeedbackDialog(action);
  }

  function openExtraActionForm(prefill = '') {
    const goalId = selectedGoalId ?? goals[0]?.id ?? initialGoals[0].id;
    const goal = goals.find(item => item.id === goalId) ?? goals[0];
    setExtraActionGoalId(goal.id);
    setExtraActionInput(prefill);
    setActionFocus(null);
    setAgentOpen(false);
    setFeedbackOpen(false);
    setExtraActionOpen(true);
  }

  function submitExtraAction() {
    const title = extraActionInput.trim();
    if (!title) return;
    const goal = goals.find(item => item.id === extraActionGoalId) ?? goals[0];
    const extraAction: Action = {
      id: `extra-${Date.now()}`,
      goalId: goal.id,
      title,
      date: TODAY,
      mode: 'extra',
      status: 'done',
      attribute: '待 Agent 评估',
      duration: '用户补充',
      feedback: '已记录为计划外行动。Agent 将在周复盘时判断是否关联一个或多个目标属性，必要时创建新的目标属性。',
    };
    setActions(current => [...current, extraAction]);
    setExtraActionInput('');
    setExtraActionOpen(false);
  }

  function openActionDetail(action: Action) {
    setSelectedActionId(action.id);
    setSelectedGoalId(action.goalId);
    setSelectedAttributeName(action.attribute);
    setView('action');
  }

  function submitFeedbackMessage() {
    const text = feedbackInput.trim();
    if (!text) return;
    const focused = actions.find(action => action.id === feedbackActionId) ?? actionFocus ?? todayActions[0];
    if (!focused) return;
    const modeLabel = focused.mode === 'extra' ? '计划外行动' : '计划内行动';
    const reply = `已记录这次${modeLabel}反馈。Agent 判断它对「${focused.attribute}」有明确收益，先计入行动记录；属性进度会在周复盘时综合评估。`;
    setActions(current => current.map(action => action.id === focused.id ? { ...action, status: 'done', feedback: text } : action));
    setFeedbackMessages(current => [...current, { role: 'user', text }, { role: 'agent', text: reply }]);
    setFeedbackInput('');
  }

  function sendMessage() {
    const text = input.trim();
    if (!text) return;
    const intent = classifyAgentIntent(text);
    if (agentMode === 'global' && intent === 'extra') {
      const cleaned = cleanExtraActionText(text);
      setInput('');
      openExtraActionForm(cleaned || text);
      return;
    }
    if (agentMode === 'global' && intent === 'feedback') {
      setInput('');
      openFeedbackDialog(undefined, text);
      return;
    }
    setMessages(current => [...current, { role: 'user', text }]);
    setInput('');
    let reply = '';
    if (intent === 'goal') {
      reply = '我先把它整理成一个长期目标草案。为了让目标可跟踪，还需要确认：希望什么时候达成？最重要的结果是什么？我会据此生成目标属性和第一周行动。';
    } else if (agentMode === 'goal') {
      reply = '当前入口只处理长期目标的创建、拆解和调试。要反馈今日行动，请点击“反馈今天的情况”；要记录计划外行动，请使用独立入口。';
    } else if (intent === 'commitment') {
      reply = '已识别为外部临时要求：我会把它放进当前长期目标的本周行动中，并标记为“计划内行动”。你可以继续告诉我截止时间和完成标准。';
    } else if (intent === 'review') {
      reply = '收到。我会先总结本周已发生的行动和属性变化，再把你的反馈转成一份“待确认的下周规划”。确认前不会直接替你改动目标。';
      setView('review');
    } else if (intent === 'feedback') {
      const focused = actionFocus ?? todayActions[0];
      if (focused) {
        setActions(current => current.map(action => action.id === focused.id ? { ...action, status: 'done', feedback: text } : action));
        const modeLabel = focused.mode === 'extra' ? '计划外行动' : '计划内行动';
        reply = `已记录这次${modeLabel}反馈。Agent 判断它对「${focused.attribute}」有明确收益，先计入行动记录；属性进度会在周复盘时综合评估。`;
      } else {
        reply = '我会先判断这件事是否对某个长期目标属性有收益。只有确认有关联，才会作为计划外行动记录。';
      }
    } else {
      reply = '这是演示模式，我会把你的描述映射到长期目标、目标属性和行动三个层级。试试输入“我完成了今天的口语录音”或“帮我复盘本周”。';
    }
    window.setTimeout(() => setMessages(current => [...current, { role: 'agent', text: reply }]), 220);
  }

  function createDemoGoal() {
    const newGoal: Goal = {
      id: `goal-${Date.now()}`, title: '新长期目标（待确认）', domain: '待分类', deadline: '待确认',
      description: '这是由 Agent 根据你的描述生成的草案，确认约束后才会进入每周规划。', progress: 0, color: '#7c8b88', importance: 0,
      attributes: [{ id: 'dimension', name: '待定义属性', progress: 0, note: '等待补充评估维度', color: '#7c8b88', importance: 0 }],
    };
    setGoals(current => [newGoal, ...current]);
    setSelectedGoalId(newGoal.id);
    setView('goals');
    setAgentOpen(false);
  }

  return (
    <main className={`demo-shell${view === 'calendar' ? ' calendar-mode' : ''}`}>
      <aside className="sidebar">
        <button className="brand" type="button" onClick={() => { changeView('today'); openGlobalAgent(); }}><span className="brand-mark">枝</span><span><strong>BuildYourself</strong><small>长期目标进程管理</small></span></button>
        <button className="add-goal" type="button" onClick={() => openGoalAgent('/goal ')}><b>＋</b> 添加长期目标 <kbd>/goal</kbd></button>
        <nav className="nav-list" aria-label="主导航">
          <button className={view === 'today' ? 'active' : ''} onClick={() => changeView('today')}>◷ <span>今日行动</span><em>{todayActions.filter(a => a.status === 'todo').length}</em></button>
          <button className={view === 'goals' ? 'active' : ''} onClick={() => changeView('goals')}>⌘ <span>长期目标</span><em>{goals.length}</em></button>
          <button className={view === 'calendar' ? 'active' : ''} onClick={() => changeView('calendar')}>▦ <span>进度日历</span></button>
          <button className={view === 'review' ? 'active' : ''} onClick={() => changeView('review')}>↻ <span>周复盘</span></button>
        </nav>
        <div className="sidebar-label">我的长期目标 <span>{goals.length} / 10</span></div>
        <div className="goal-list">
          {sortedGoals.map(goal => <button key={goal.id} className={`goal-list-item ${selectedGoalId === goal.id && (view === 'goals' || view === 'attribute' || view === 'action') ? 'selected' : ''}`} onClick={() => { setSelectedGoalId(goal.id); setSelectedAttributeName(null); setSelectedActionId(null); setView('goals'); }}><DomainIcon domain={goal.domain} /><span><strong>{goal.title}</strong><small>{goalLabel(goal)} · {growthLabel(goal.progress)}</small></span></button>)}
        </div>
        <div className="sidebar-foot"><span><i /> MOCK 演示空间</span><small>不连接模型 · 不依赖后端</small></div>
      </aside>

      <section className="main-column">
        <header className="topbar"><div className="topbar-left">{((view === 'goals' && selectedGoalId) || view === 'attribute' || view === 'action') && <button className="topbar-back" type="button" onClick={goBack}>← 返回</button>}<span>工作空间 / <b>{view === 'today' ? '今日任务' : view === 'goals' ? '长期目标' : view === 'attribute' ? '目标属性' : view === 'calendar' ? '日历' : view === 'action' ? '行动详情' : '复盘'}</b></span></div><button className="agent-trigger" onClick={() => openGoalAgent()}>✦ 长期目标 Agent</button></header>
        <div className="content">
          {view === 'today' && <>
             <div className="hero"><div><span className="overline">2026 年 11 月 23 日 · 星期一</span><h1>今天的任务清单</h1><p>这里只罗列今天需要知道的事情，不要求打卡，也不展示复杂的完成度。完成后，用自然语言告诉 Agent。</p></div><button className="primary" onClick={() => openFeedbackDialog()}>反馈今天的情况 <span>→</span></button></div>
             <div className="stat-grid"><button className={`stat-card-button active-goals-card${activeGoalsOpen ? ' open' : ''}`} onClick={() => setActiveGoalsOpen(open => !open)}><span>活跃长期目标</span><strong>{goals.length}<small> / 10</small></strong><p>点击查看名称清单</p></button><div><span>今天的行动</span><strong>{completedToday}<small> / {todayActions.length}</small></strong><p>已反馈 / 今日总数</p></div><div className="stat-accent"><span>今日原则</span><strong>{dailyPrinciple}</strong><p>每天根据行动状态合理生成</p></div></div>
            {activeGoalsOpen && <div className="active-goals-popover"><span className="overline">ACTIVE LONG-TERM GOALS</span><strong>当前活跃的长期目标</strong><div>{sortedGoals.map(goal => <button key={goal.id} onClick={() => { setSelectedGoalId(goal.id); setView('goals'); setActiveGoalsOpen(false); }}><DomainIcon domain={goal.domain} /><span>{goal.title}</span><small>查看</small></button>)}</div></div>}
             <section className="panel"><div className="section-head"><div><span className="overline">TODAY'S BOARD</span><h2>今日任务 <small>{todayActions.length}</small></h2></div><div className="today-board-actions"><span className="section-note">独立公告板 · 不做细粒度排期 · 可拖动排序</span><button className="add-action-button" onClick={() => openExtraActionForm()}>＋ 添加计划外行动</button></div></div><div className="action-list">{todayActions.map(action => { const goal = goals.find(g => g.id === action.goalId)!; return <article draggable className={`action-row ${action.status === 'done' ? 'is-done' : ''} ${dragOverActionId === action.id ? 'drag-over' : ''}`} key={action.id} onDragStart={() => setDraggedActionId(action.id)} onDragOver={event => { event.preventDefault(); setDragOverActionId(action.id); }} onDragLeave={() => setDragOverActionId(null)} onDrop={event => { event.preventDefault(); if (draggedActionId) reorderTodayAction(draggedActionId, action.id); setDraggedActionId(null); setDragOverActionId(null); }} onDragEnd={() => { setDraggedActionId(null); setDragOverActionId(null); }}><div className={`action-state ${action.status}`}>{action.status === 'done' ? '已记录' : '待反馈'}</div><div className="action-main"><div><span className="action-mode">{action.mode === 'planned' ? '计划内行动' : '计划外行动'}</span><span className="action-goal" style={{ color: goal.color, backgroundColor: `${goal.color}14`, borderColor: `${goal.color}38` }}>{goal.title}</span></div><strong>{action.title}</strong><p>影响属性：{action.attribute} · {action.duration}</p>{action.feedback && <small className="feedback">Agent 评价：{action.feedback}</small>}</div><button className="text-button" draggable={false} onClick={() => completeAction(action)}>{action.status === 'done' ? '查看评价' : '反馈给 Agent'} <span>→</span></button></article>; })}</div></section>
          </>}

           {view === 'goals' && <>
             {!selectedGoalId ? <>
                <div className="page-title"><span className="overline">LONG-TERM GOALS</span><h1>长期目标总览</h1><p>先看每个长期目标的整体状态，再进入其中一项查看目标属性和具体行动。拖动卡片可调整优先级。</p></div>
              <div className="goal-overview-grid">{sortedGoals.map(goal => <button draggable className={`goal-overview-card ${dragOverGoalId === goal.id ? 'drag-over' : ''}`} key={goal.id} onDragStart={() => setDraggedGoalId(goal.id)} onDragOver={event => { event.preventDefault(); setDragOverGoalId(goal.id); }} onDragLeave={() => setDragOverGoalId(null)} onDrop={event => { event.preventDefault(); if (draggedGoalId) reorderGoal(draggedGoalId, goal.id); setDraggedGoalId(null); setDragOverGoalId(null); }} onDragEnd={() => { setDraggedGoalId(null); setDragOverGoalId(null); }} onClick={() => { if (!draggedGoalId) setSelectedGoalId(goal.id); }}><div className="goal-overview-head"><DomainIcon domain={goal.domain} /><span><strong>{goal.title}</strong><small>{goal.domain} · 截止 {goal.deadline}</small></span><b>{growthLabel(goal.progress)}</b></div><Progress value={goal.progress} color={goal.color} /><div className="goal-overview-attrs">{[...goal.attributes].sort((a, b) => b.importance - a.importance).map(attr => <span key={attr.id}>{attr.name} · {growthLabel(attr.progress)}</span>)}</div><div className="goal-overview-foot"><span>{goal.attributes.length} 个目标属性</span><em>查看属性 →</em></div></button>)}</div>
            </> : <>
            <div className="page-title"><span className="overline">LONG-TERM GOAL</span><h1>{selectedGoal.title}</h1><p>{selectedGoal.description}</p><div className="goal-meta"><span>截止 {selectedGoal.deadline}</span><span>总进度：{growthLabel(selectedGoal.progress)}</span><span>总进度与本周行动解耦</span></div></div>
             <section className="panel"><div className="section-head"><div><span className="overline">LONG-TERM GOAL VIEWS</span><h2>进度视图（暂定）</h2></div><span className="section-note">拖动指标卡片调整重要度 · 当前保留演示占位</span></div><div className="mode-switch" role="tablist" aria-label="长期目标进度视图"><button className={projectMode === 'ability' ? 'active' : ''} onClick={() => setProjectMode('ability')}>能力条</button><button className={projectMode === 'logic' ? 'active' : ''} onClick={() => setProjectMode('logic')}>逻辑依赖</button><button className={projectMode === 'time' ? 'active' : ''} onClick={() => setProjectMode('time')}>时间依赖</button></div>
              {projectMode === 'ability' && <div className="attribute-grid">{sortedAttributes.map((attr, index) => <div className={`attribute-card-wrap ${dragOverAttributeId === attr.id ? 'drag-over' : ''}`} key={attr.id} onDragOver={event => { event.preventDefault(); setDragOverAttributeId(attr.id); }} onDragLeave={() => setDragOverAttributeId(null)} onDrop={event => { event.preventDefault(); if (draggedAttributeId) reorderAttribute(draggedAttributeId, attr.id); setDraggedAttributeId(null); setDragOverAttributeId(null); }}><button type="button" draggable className={`attribute-card ${selectedAttributeName === attr.name ? 'selected' : ''}`} style={{ borderTopColor: attr.color }} onDragStart={() => setDraggedAttributeId(attr.id)} onDragEnd={() => { setDraggedAttributeId(null); setDragOverAttributeId(null); }} onClick={() => { if (!draggedAttributeId) openAttributeDetail(attr); }}><div className="attribute-top"><span>{attr.name}</span><strong style={{ color: attr.color }}>{growthLabel(attr.progress)}</strong></div><Progress value={attr.progress} color={attr.color} /><p>{attr.note}</p><span className="attribute-card-link">拖动调整顺序 · 查看详情 <span>→</span></span></button><small className="attribute-rank">重要度 {index + 1}</small></div>)}</div>}
               {projectMode === 'logic' && <div className="logic-map"><div className="logic-intro"><strong>逻辑依赖视图</strong><p>展示前置知识如何解锁后续行动。你也可以直接告诉 Agent：“把口语演示拆成更小的前置步骤”。</p><button className="text-button" onClick={() => openGoalAgent('请帮我调试当前长期目标的逻辑依赖')}>让 Agent 调整逻辑 →</button></div><div className="logic-chain"><div className="logic-node root"><small>长期目标</small><strong>{selectedGoal.title}</strong></div><i>→</i><div className="logic-node"><small>前置能力</small><strong>核心表达与词汇</strong></div><i>→</i><div className="logic-node"><small>场景能力</small><strong>会议追问应答</strong></div><i>→</i><div className="logic-node end"><small>结果</small><strong>5 分钟英文演示</strong></div></div></div>}
              {projectMode === 'time' && <div className="time-dependency"><div className="time-intro"><strong>时间依赖视图</strong><p>只展示行动的先后关系，不把每天排成精确时间表。</p></div><div className="time-line">{goalActions.slice(0, 4).map((action, index) => <article key={action.id}><span className="time-index">{index + 1}</span><div><small>{action.date}</small><strong>{action.title}</strong><p>{index === 0 ? '先建立输入与素材' : index === 1 ? '再进行一次小规模练习' : index === 2 ? '根据反馈补足薄弱环节' : '最后进行一次综合验证'}</p></div></article>)}</div></div>}
            </section>
            </>}
          </>}

          {view === 'attribute' && selectedAttribute && <>
             <div className="page-title attribute-detail-title"><span className="overline">GOAL ATTRIBUTE</span><h1>{selectedAttribute.name}</h1><p>{selectedAttribute.note}。这里集中查看这个目标属性的指标状态，以及真正带来变化的行动。</p></div>
            <section className="panel attribute-detail-overview"><div className="attribute-detail-head"><div><span className="overline">ATTRIBUTE PULSE</span><h2>{selectedAttribute.name}</h2><p>所属长期目标：{selectedGoal.title}</p></div><strong style={{ color: selectedAttribute.color }}>{growthLabel(selectedAttribute.progress)}</strong></div><Progress value={selectedAttribute.progress} color={selectedAttribute.color} /><div className="attribute-metrics"><div><span>当前进度</span><strong>{selectedAttribute.progress}</strong><small>成长性参考值</small></div><div><span>关联行动</span><strong>{goalActions.filter(action => action.attribute === selectedAttribute.name).length}</strong><small>计划内与计划外</small></div><div><span>最近证据</span><strong>{goalActions.filter(action => action.attribute === selectedAttribute.name && action.status === 'done').length ? '已有' : '待补充'}</strong><small>{goalActions.filter(action => action.attribute === selectedAttribute.name && action.status === 'done').length ? '已完成行动' : '等待自然语言反馈'}</small></div></div></section>
            <section className="panel attribute-actions-page"><div className="section-head"><div><span className="overline">ATTRIBUTE ACTIONS</span><h2>带来「{selectedAttribute.name}」成长的行动</h2></div><span className="section-note">点击行动查看完成记录和 Agent 评价</span></div><div className="attribute-action-list">{goalActions.filter(action => action.attribute === selectedAttribute.name).length ? goalActions.filter(action => action.attribute === selectedAttribute.name).map(action => <button type="button" className="attribute-action-item" key={action.id} onClick={() => openActionDetail(action)}><span className={`trace-dot ${action.status}`} /><div><strong>{action.title}</strong><small>{action.date} · {action.mode === 'planned' ? '计划内行动' : '计划外行动'}</small>{action.feedback && <p>Agent 评价：{action.feedback}</p>}</div><em>{action.status === 'done' ? '已评价' : '等待反馈'} <span>→</span></em></button>) : <p>还没有与该属性关联的行动。</p>}</div></section>
          </>}

          {view === 'action' && selectedAction && <>
             <div className="page-title action-detail-title"><span className="overline">ACTION DETAIL</span><h1>{selectedAction.title}</h1><p>这里记录这次行动的归属、完成情况和 Agent 反馈，作为目标属性成长的可追溯依据。</p></div>
            <section className="panel action-detail-panel"><div className="section-head"><div><span className="overline">ACTION RECORD</span><h2>行动信息</h2></div><span className={`action-detail-status ${selectedAction.status}`}>{selectedAction.status === 'done' ? '已记录' : '待反馈'}</span></div><div className="action-detail-grid"><div><span>所属长期目标</span><strong>{goals.find(goal => goal.id === selectedAction.goalId)?.title ?? '未分类'}</strong></div><div><span>影响目标属性</span><strong>{selectedAction.attribute}</strong></div><div><span>行动日期</span><strong>{selectedAction.date}</strong></div><div><span>行动类型</span><strong>{selectedAction.mode === 'planned' ? '计划内行动' : '计划外行动'}</strong></div><div><span>预计时长</span><strong>{selectedAction.duration}</strong></div></div></section>
            <section className="panel action-feedback-panel"><div className="section-head"><div><span className="overline">FEEDBACK & EVALUATION</span><h2>完成情况与评价</h2></div><span className="section-note">自然语言反馈会记录在这里</span></div><div className="action-feedback-block"><span>用户完成情况</span><p>{selectedAction.feedback ?? '尚未提交反馈。完成后可以告诉 Agent 你做了什么、实际感受如何。'}</p></div><div className="action-feedback-block agent-feedback-block"><span>Agent 简短评价</span><p>{selectedAction.feedback ? `这次行动已关联到「${selectedAction.attribute}」，会在周复盘时作为属性成长证据综合评估。` : '等待用户反馈后，Agent 会判断这次行动是否完成，以及它对目标属性是否有收益。'}</p></div>{selectedAction.status === 'todo' && <button className="primary" onClick={() => openFeedbackDialog(selectedAction)}>反馈给 Agent <span>→</span></button>}</section>
          </>}

          {view === 'calendar' && <>
            <div className="page-title calendar-page-title"><span className="overline">ACTIVITY HISTORY</span><h1>进度日历</h1><p>只回看已经发生的目标相关行动。月视图看每天推进，年度视图看长期目标的年度状态。</p></div>
            <section className="panel calendar-panel">
              <div className="calendar-head"><div><div className="calendar-title-row"><h2>{calendarScope === 'month' ? calendarMonthLabel : `${calendarYear} 年`}</h2><div className="calendar-view-switch" role="tablist" aria-label="日历视图"><button className={calendarScope === 'month' ? 'active' : ''} onClick={() => setCalendarScope('month')}>月</button><button className={calendarScope === 'year' ? 'active' : ''} onClick={() => setCalendarScope('year')}>年</button></div></div><p><i className="dot planned" />已完成的计划内行动 <i className="dot extra" />已完成的计划外行动 <i className="dot review" />周复盘</p></div><div className="calendar-nav"><button aria-label="上一个周期" onClick={() => shiftCalendarPeriod(-1)}>‹</button><button aria-label="下一个周期" onClick={() => shiftCalendarPeriod(1)}>›</button></div></div>
              {calendarScope === 'month' ? <>
                <div className="calendar-week calendar-week-with-review">{['一', '二', '三', '四', '五', '六', '日'].map(d => <span key={d}>{d}</span>)}<span className="review-column-heading">周复盘</span></div>
                <div className="calendar-grid calendar-grid-with-review">{calendarWeeks.flatMap((week, weekIndex) => { const review = week.map(cell => weeklyReviews.find(item => item.date === cell.date)).find(Boolean); return [...week.map(cell => { const dayActions = actions.filter(action => action.date === cell.date && action.status === 'done'); return <button key={cell.date} className={`${cell.inMonth ? '' : 'outside-month'} ${cell.date === calendarDate ? 'selected' : ''} ${dayActions.length ? 'has-activity' : ''}`} onClick={() => selectCalendarDate(cell.date)}><b>{cell.day}</b>{dayActions.length > 0 && <small>{dayActions.length} 项完成</small>}</button>; }), <div className="calendar-review-cell" key={`review-${weekIndex}`}>{review ? <button className="calendar-review-card" onClick={() => selectCalendarDate(review.date)}><strong>{review.title}</strong><small>点击查看本周摘要</small></button> : <div className="calendar-review-empty"><strong>待生成</strong></div>}</div>]; })}</div>
                <div className="calendar-detail"><strong>{calendarDate} 的完成记录</strong>{actions.filter(a => a.date === calendarDate && a.status === 'done').length ? actions.filter(a => a.date === calendarDate && a.status === 'done').map(a => <span key={a.id}><i className={`dot ${a.mode}`} />{a.title}</span>) : <p>这一天没有已完成的目标行动。</p>}{weeklyReviews.filter(item => item.date === calendarDate).map(review => <div className="calendar-review-detail" key={review.date}><i className="dot review" /><strong>{review.title}</strong><p>{review.summary}</p><button className="text-button" onClick={() => { setView('review'); setReportOpen(true); }}>查看完整详情 →</button></div>)}</div>
              </> : <div className="calendar-year-overview"><div className="year-summary-grid"><div><span>已完成长期目标</span><strong>{yearGoalsCompleted.length}</strong><small>{yearGoalsCompleted.length ? yearGoalsCompleted.map(goal => goal.title).join('、') : '本年度暂无已完成目标'}</small></div><div><span>仍在完成</span><strong>{yearGoalsInProgress.length}</strong><small>持续维护总进度，不被单周任务打乱</small></div><div><span>年度行动记录</span><strong>{actions.filter(action => action.date.startsWith(`${calendarYear}-`) && action.status === 'done').length}</strong><small>计划内与计划外行动</small></div></div><div className="year-goal-columns"><div><h3>本年度已完成</h3>{yearGoalsCompleted.length ? yearGoalsCompleted.map(goal => <div className="year-goal-row" key={goal.id}><DomainIcon domain={goal.domain} /><span><strong>{goal.title}</strong><small>{goal.domain}</small></span><em>已完成</em></div>) : <p>暂无已完成的长期目标。</p>}</div><div><h3>仍在完成</h3>{yearGoalsInProgress.map(goal => <div className="year-goal-row" key={goal.id}><DomainIcon domain={goal.domain} /><span><strong>{goal.title}</strong><small>{goal.domain} · {growthLabel(goal.progress)}</small></span><em>进行中</em></div>)}</div></div><div className="year-month-grid">{yearMonthSummary.map(item => <button key={item.month} onClick={() => { setCalendarMonth(item.month); setCalendarDate(`${item.month}-01`); setCalendarScope('month'); }}><strong>{Number(item.month.slice(5, 7))} 月</strong><span>{item.count ? `${item.count} 项完成` : '暂无完成记录'}</span></button>)}</div></div>}
            </section>
          </>}

          {view === 'review' && <>
            <div className="page-title"><span className="overline">WEEKLY REVIEW · 11/21 — 11/27</span><h1>周复盘</h1><p>复盘不是打分，而是把实际行动、属性变化和下一步调整放在一起看。</p></div>
            <div className="review-steps"><div className="current"><b>1</b><span>总结本周</span></div><i /><div><b>2</b><span>你的反馈</span></div><i /><div><b>3</b><span>下周需求</span></div><i /><div><b>4</b><span>确认下周规划</span></div></div>
            <section className="panel review-summary"><div className="section-head"><div><span className="overline">STEP 1 · AGENT SUMMARY</span><h2>本周发生了什么？</h2></div><div className="review-actions"><span className="review-badge">演示摘要</span><button className="text-button" onClick={() => setReportOpen(true)}>查看完整 HTML 报告 →</button></div></div><div className="summary-columns"><div><strong>{doneThisWeek} / {weekActions.length}</strong><span>计划行动已反馈</span></div><div><strong>2</strong><span>个目标属性有提升证据</span></div><div><strong>1</strong><span>个计划外行动被纳入</span></div></div><p className="summary-copy">英语的专业阅读和健身的基础力量有稳定推进；羽毛球属于计划外行动，但 Agent 判断它对有氧耐力有收益，因此被记录到健身长期目标。口语表达仍是下周最值得优先投入的属性。</p></section>
            <section className="panel feedback-panel"><div className="section-head"><div><span className="overline">STEP 2 · YOUR FEEDBACK</span><h2>你对本周规划有什么意见？</h2></div><span className="section-note">告诉 Agent 哪些安排该保留、减少或调整</span></div><textarea value={reviewFeedback} onChange={e => setReviewFeedback(e.target.value)} placeholder="例如：这周工作临时变多；练腿后两天无法走路，下一周请降低腿部强度。" /></section>
            <section className="panel next-needs-panel"><div className="section-head"><div><span className="overline">STEP 3 · NEXT WEEK NEEDS</span><h2>下周还有什么需要安排？</h2></div><span className="section-note">临时考试、截止日期或必须保留的安排，都可以写在这里</span></div><textarea value={nextWeekNeeds} onChange={e => setNextWeekNeeds(e.target.value)} placeholder="例如：下周三有英语考试；周五前要提交项目汇报，请提前留出准备时间。" /><button className="primary" onClick={generateNextWeek}>生成待确认的下周规划 <span>→</span></button></section>
            {nextWeekReady && <section className="panel next-week"><div className="section-head"><div><span className="overline">STEP 4 · PENDING PLAN</span><h2>下周规划（待你确认）</h2></div><span className="pending-badge">待确认</span></div><div className="next-week-grid"><div><span>英语学习</span><strong>口语录音 × 2 · 论文摘要复述 × 1</strong><small>重点提升：口语表达</small></div><div><span>健身</span><strong>{feedbackApplied ? '慢跑 × 2 · 上肢力量 × 1' : '慢跑 × 2 · 力量训练 × 1'}</strong><small>{feedbackApplied ? '已根据反馈降低腿部强度，增加恢复日' : '重点提升：有氧耐力'}</small></div><div><span>性能测试工具长期目标</span><strong>异常用例补齐 × 2</strong><small>重点提升：质量可靠性</small></div></div>{nextWeekNeeds && <p className="plan-input-note">已纳入下周需求：{nextWeekNeeds}</p>}<div className="confirm-row"><p>确认后，这些会成为下周的计划内行动；每天只展示当天需要推进的内容。</p><button className="primary" onClick={() => setNextWeekReady(false)}>确认并进入下周 <span>✓</span></button></div></section>}
            {reportOpen && <div className="report-backdrop" onClick={() => setReportOpen(false)}><article className="report-modal" onClick={event => event.stopPropagation()}><header><div><span className="overline">WEEKLY REVIEW · HTML MOCK</span><h2>第 47 周长期目标复盘</h2></div><button onClick={() => setReportOpen(false)}>×</button></header><div className="report-body"><div className="report-kicker">BuildYourself / 周报</div><h3>这一周，你让三个长期目标都向前移动了一点。</h3><p>英语长期目标在专业阅读上保持了连续行动；健身长期目标出现了一次计划外的羽毛球活动，Agent 判断它对有氧耐力有收益并纳入记录；性能测试工具继续补齐质量边界。</p><div className="report-grid"><div><span>长期进程</span><strong>整体稳定</strong></div><div><span>最值得保留</span><strong>自然语言反馈</strong></div><div><span>下周建议</span><strong>优先口语表达</strong></div></div><h4>下周需要注意</h4><ul><li>每天只看当天任务，不提前堆积压力。</li><li>临时完成的活动先由 Agent 判断是否属于某个属性收益。</li><li>身体疲劳或临时工作变化，应在周复盘中直接反馈。</li></ul></div><footer><span>这是演示版 HTML 报告，不调用外部模型。</span><button className="primary" onClick={() => setReportOpen(false)}>返回复盘</button></footer></article></div>}
          </>}
        </div>
      </section>

      {agentOpen && <div className="agent-backdrop" onClick={() => setAgentOpen(false)}><section className={'agent-drawer ' + (agentMode === 'global' ? 'agent-drawer-global' : '')} onClick={e => e.stopPropagation()}><header><div><span className="agent-orb">✦</span><span><strong>{agentMode === 'global' ? 'BuildYourself 综合 Agent' : '长期目标 Agent'}</strong><small>纯前端 Mock 演示 · 不调用模型</small></span></div><button onClick={() => setAgentOpen(false)}>×</button></header><div className="agent-context"><span>上下文</span><b>{agentMode === 'global' ? '全局工作空间' : selectedGoal.title}</b></div><div className="messages">{messages.map((message, index) => <article className={message.role} key={index}><span>{message.role === 'agent' ? 'Agent' : '你'}</span><p>{message.text}</p></article>)}</div><div className="agent-chips">{agentMode === 'goal' ? <><button onClick={() => setInput('/goal 我想在 12 周内提升英语表达')}>创建长期目标</button><button onClick={() => setInput('请帮我调试当前长期目标的约束和行动逻辑')}>调试当前目标</button></> : <><button onClick={() => setInput('/goal 我想在 12 周内提升英语表达')}>创建长期目标</button><button onClick={() => setInput('老师通知：周三前提交英语展示大纲')}>记录临时要求</button><button onClick={() => openExtraActionForm()}>添加计划外行动</button><button onClick={() => openFeedbackDialog()}>反馈今天行动</button></>}</div><form onSubmit={e => { e.preventDefault(); sendMessage(); }}><textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} placeholder={agentMode === 'goal' ? '描述长期目标，或告诉 Agent 需要调试的地方…' : '告诉 Agent 一个目标、临时要求或行动情况…'} />{input.trim() && <div className={'agent-intent intent-' + agentIntent}><span>识别为</span><strong>{agentIntent === 'goal' ? '长期目标' : agentIntent === 'commitment' ? '临时要求' : agentIntent === 'extra' ? '计划外行动' : agentIntent === 'feedback' ? '行动反馈' : agentIntent === 'review' ? '复盘意见' : '待识别'}</strong>{agentIntent === 'extra' && <small>将打开独立录入</small>}</div>}<div className="agent-form-actions"><small>Agent 会先识别输入类型 · Enter 发送</small><button className="primary" type="submit">发送 →</button></div></form><div className="agent-note">{agentMode === 'goal' ? '此入口只处理长期目标的创建、拆解和调试。' : '综合入口会先分类，再把行动反馈和计划外行动转到对应的独立界面。'}</div>{agentMode === 'goal' && view === 'today' && <button className="demo-goal-link" onClick={createDemoGoal}>＋ 直接生成一个长期目标草案</button>}</section></div>}
      {extraActionOpen && <div className="extra-action-backdrop" onClick={() => setExtraActionOpen(false)}><section className="extra-action-modal" onClick={event => event.stopPropagation()}><header><div><span className="overline">PLAN-OUT ACTION</span><h2>添加计划外行动</h2></div><button className="extra-action-close" onClick={() => setExtraActionOpen(false)}>×</button></header><p className="extra-action-intro">只需要描述你额外完成了什么，不用手动选择目标属性。Agent 会在复盘时判断它影响了哪些属性，也可能创建新的目标属性。</p><textarea value={extraActionInput} onChange={event => setExtraActionInput(event.target.value)} placeholder="例如：午休时额外完成了一次 30 分钟羽毛球练习" autoFocus /><div className="extra-action-fields"><label>关联长期目标<select value={extraActionGoalId} onChange={event => setExtraActionGoalId(event.target.value)}>{goals.map(goal => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label></div><p className="extra-action-agent-note">目标属性：由 Agent 自动判断，可关联多个已有属性，或创建新的属性。</p><footer><button className="text-button" onClick={() => setExtraActionOpen(false)}>取消</button><button className="primary" onClick={submitExtraAction}>记录计划外行动 <span>✓</span></button></footer></section></div>}
      {feedbackOpen && <div className="feedback-backdrop" onClick={() => setFeedbackOpen(false)}><section className="feedback-modal" onClick={event => event.stopPropagation()}><header><div><span className="overline">TODAY FEEDBACK</span><h2>反馈今天的情况</h2></div><button className="feedback-close" onClick={() => setFeedbackOpen(false)}>×</button></header><p className="feedback-intro">这是独立的行动反馈对话。Agent 只负责判断今天行动的实际完成情况，并记录简短评价。</p><div className="feedback-messages">{feedbackMessages.map((message, index) => <article className={message.role} key={index}><span>{message.role === 'agent' ? 'Agent' : '你'}</span><p>{message.text}</p></article>)}</div><label className="feedback-action-picker">选择要反馈的行动<select value={feedbackActionId ?? ''} onChange={event => setFeedbackActionId(event.target.value || null)}><option value="">请选择今天的行动</option>{todayActions.map(action => <option key={action.id} value={action.id}>{action.title}</option>)}</select></label><form onSubmit={event => { event.preventDefault(); submitFeedbackMessage(); }}><textarea value={feedbackInput} onChange={event => setFeedbackInput(event.target.value)} placeholder="例如：完成了口语录音，实际用了 15 分钟，第三遍比前两遍流畅。" autoFocus /><div><small>自然语言描述即可，不需要手动打卡</small><button className="primary" type="submit">提交反馈 →</button></div></form></section></div>}
    </main>
  );
}
