'use client';

import { useEffect, useMemo, useState } from 'react';
import type { HistoryCalendar, HistoryCalendarDay } from '@/lib/history-calendar';

const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const goalStatusLabels = { active: '活跃', completed: '已完成', paused: '已暂停', archived: '已归档', abandoned: '已放弃', draft: '草稿' };

function localDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dayLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('zh-CN', { dateStyle: 'full' });
}

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export default function HistoryCalendarPanel() {
  const today = new Date();
  const [history, setHistory] = useState<HistoryCalendar | null>(null);
  const [month, setMonth] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selectedDate, setSelectedDate] = useState(localDateKey(today.getFullYear(), today.getMonth(), today.getDate()));
  const [selectedGoalId, setSelectedGoalId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const response = await fetch(`/api/history-calendar?timeZone=${encodeURIComponent(timeZone)}`, { cache: 'no-store' });
        if (!response.ok) throw new Error('无法读取历史日历');
        const result = await response.json() as HistoryCalendar;
        if (live) {
          setHistory(result);
          setError('');
        }
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : '无法读取历史日历');
      }
    };
    void load();
    const timer = window.setInterval(load, 5000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);

  const monthDays = useMemo(() => {
    const count = new Date(month.year, month.month + 1, 0).getDate();
    const offset = (new Date(month.year, month.month, 1).getDay() + 6) % 7;
    return [...Array.from({ length: offset }, () => null), ...Array.from({ length: count }, (_, index) => index + 1)];
  }, [month]);
  const monthTitle = new Date(month.year, month.month, 1).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });
  const selectedDay: HistoryCalendarDay | undefined = history?.days.find(day => day.date === selectedDate);
  const activities = (selectedDay?.activities ?? []).filter(activity => !selectedGoalId || activity.goalPlanId === selectedGoalId);
  const evidence = (selectedDay?.evidence ?? []).filter(item => !selectedGoalId || item.goalPlanId === selectedGoalId);
  const filteredUndated = (history?.undatedActivities ?? []).filter(activity => !selectedGoalId || activity.goalPlanId === selectedGoalId);

  function moveMonth(amount: number) {
    const next = new Date(month.year, month.month + amount, 1);
    setMonth({ year: next.getFullYear(), month: next.getMonth() });
    setSelectedDate(localDateKey(next.getFullYear(), next.getMonth(), 1));
  }

  function entriesForDate(date: string) {
    const day = history?.days.find(item => item.date === date);
    return {
      activities: (day?.activities ?? []).filter(activity => !selectedGoalId || activity.goalPlanId === selectedGoalId),
      evidence: (day?.evidence ?? []).filter(item => !selectedGoalId || item.goalPlanId === selectedGoalId),
    };
  }

  return (
    <section className="history-calendar" aria-labelledby="history-calendar-title">
      <div className="section-title history-calendar-heading">
        <div><span className="kicker">ACTIVITY HISTORY</span><h2 id="history-calendar-title">历史日历</h2></div>
        <span className="subtle">只读回查已记录的活动和证据</span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="history-calendar-toolbar">
        <div className="history-calendar-month"><button type="button" aria-label="上个月" onClick={() => moveMonth(-1)}>‹</button><strong>{monthTitle}</strong><button type="button" aria-label="下个月" onClick={() => moveMonth(1)}>›</button></div>
        <label>按目标筛选
          <select value={selectedGoalId} onChange={event => setSelectedGoalId(event.target.value)}>
            <option value="">全部目标</option>
            {(history?.goals ?? []).map(goal => <option key={goal.id} value={goal.id}>{goal.title}（{goalStatusLabels[goal.status]}）</option>)}
          </select>
        </label>
      </div>
      <div className="history-calendar-layout">
        <div className="history-calendar-grid" role="grid" aria-label={`${monthTitle}历史日历`}>
          {weekdays.map(day => <span className="history-calendar-weekday" role="columnheader" key={day}>{day}</span>)}
          {monthDays.map((day, index) => {
            if (day === null) return <span className="history-calendar-blank" aria-hidden="true" key={`blank-${index}`} />;
            const date = localDateKey(month.year, month.month, day);
            const entries = entriesForDate(date);
            const hasEntries = entries.activities.length > 0 || entries.evidence.length > 0;
            return <button type="button" role="gridcell" aria-pressed={selectedDate === date} aria-label={`${date}${hasEntries ? `，${entries.activities.length} 项活动，${entries.evidence.length} 项证据` : ''}`} className={`history-calendar-day${selectedDate === date ? ' selected' : ''}${hasEntries ? ' has-entry' : ''}`} key={date} onClick={() => setSelectedDate(date)}>
              <span>{day}</span>{hasEntries && <small>{entries.activities.length + entries.evidence.length} 条</small>}
            </button>;
          })}
        </div>
        <section className="history-calendar-detail" aria-live="polite" aria-label="当天历史记录">
          <h3>{dayLabel(selectedDate)}</h3>
          {activities.length || evidence.length ? <>
            {activities.length > 0 && <div><h4>已完成活动</h4><ul>{activities.map(activity => <li key={activity.id}>
              <strong>{activity.title}</strong><span>{activity.goalTitle} · {timeLabel(activity.completedAt)}</span>
              {activity.evidenceRequirement && <small>证据要求：{activity.evidenceRequirement}</small>}
            </li>)}</ul></div>}
            {evidence.length > 0 && <div><h4>证据标记</h4><ul>{evidence.map(item => <li key={item.id}>
              <strong><span className={`history-evidence-level ${item.level}`}>{item.level}</span> {item.requirement || '目标证据'}</strong>
              <span>{item.goalTitle}</span><small>{item.description}</small>
            </li>)}</ul></div>}
          </> : <p className="history-calendar-empty">这一天没有已记录的目标活动或证据。</p>}
        </section>
      </div>
      {filteredUndated.length > 0 && <div className="history-undated"><strong>日期不详的旧完成记录（{filteredUndated.length}）</strong><p>这些旧记录没有保存实际完成时间，因此不会放入具体日期。</p><ul>{filteredUndated.map(item => <li key={item.id}>{item.goalTitle} · {item.title}</li>)}</ul></div>}
      <p className="history-calendar-note">只显示明确关联到具体目标的活动和证据。未关联目标的通用证据仍可在证据区查看，不计入目标历史。</p>
      {history?.goals.length === 0 && <p className="history-calendar-empty">启用目标并记录完成行动后，这里会显示目标历史。</p>}
    </section>
  );
}
