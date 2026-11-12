'use client';

import { useEffect, useState } from 'react';
import type { WeeklyReviewAdjustment, WeeklyReviewRecord } from '@/lib/weekly-review-store';

function localDateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function currentWeekStart() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  today.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return localDateString(today);
}

function readableDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + amount);
  return localDateString(date);
}

export default function WeeklyReviewPanel() {
  const [weekStart, setWeekStart] = useState('');
  const [record, setRecord] = useState<WeeklyReviewRecord | null>(null);
  const [adjustment, setAdjustment] = useState<WeeklyReviewAdjustment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const lastWeek = window.localStorage.getItem('weeklyReviewWeekStart');
    setWeekStart(lastWeek ?? currentWeekStart());
  }, []);

  useEffect(() => {
    if (!weekStart) return;
    window.localStorage.setItem('weeklyReviewWeekStart', weekStart);
    let active = true;
    setRecord(null);
    setAdjustment(null);
    void fetch(`/api/weekly-review?weekStart=${encodeURIComponent(weekStart)}`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json() as WeeklyReviewRecord & { error?: string };
        if (!response.ok) throw new Error(data.error || '无法读取周复盘');
        if (active) {
          setRecord(data);
          setAdjustment(data.review.adjustment);
          setError('');
        }
      })
      .catch(cause => {
        if (active) setError(cause instanceof Error ? cause.message : '无法读取周复盘');
      });
    return () => { active = false; };
  }, [weekStart]);

  async function save() {
    if (!weekStart || !adjustment) return;
    setBusy(true);
    try {
      const response = await fetch('/api/weekly-review', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStart, adjustment }),
      });
      const data = await response.json() as WeeklyReviewRecord & { error?: string };
      if (!response.ok) throw new Error(data.error || '无法保存周复盘');
      setRecord(data);
      setAdjustment(data.review.adjustment);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存周复盘');
    } finally {
      setBusy(false);
    }
  }

  const saved = record?.status === 'saved';
  const review = record?.review;

  return (
    <section className="weekly-review" aria-labelledby="weekly-review-title">
      <div className="weekly-review-head">
        <div><span className="kicker">WEEKLY REFLECTION</span><h2 id="weekly-review-title">周复盘</h2></div>
        <span className={`weekly-review-state ${saved ? 'saved' : ''}`}>{saved ? '已保存' : '待核对'}</span>
      </div>
      <label className="weekly-review-week">复盘周一
        <input type="date" value={weekStart} onChange={event => setWeekStart(event.target.value)} />
      </label>
      <p className="weekly-review-intro">查看 {weekStart ? `${readableDate(weekStart)} 至 ${readableDate(review?.weekEnd ?? weekStart)}` : '本周'} 的执行投入、交付、能力进展和证据缺口。计划时长是估算，不代表实际工时。</p>
      {error && <p role="alert" className="error">{error} 复盘日期需要选择周一。</p>}
      {!review && !error && <p className="weekly-review-empty">正在读取本周记录…</p>}
      {review && adjustment && <>
        <div className="weekly-review-summary">
          <article><span>执行投入</span><strong>{review.executionEffort.plannedMinutes} 分钟计划估算</strong><small>{review.executionEffort.plannedActionCount} 项已安排 · {review.executionEffort.unplacedActionCount} 项未排入</small></article>
          <article><span>示例目标「{review.exampleGraph.goalTitle}」· 交付</span><strong>{review.exampleGraph.delivery.status}</strong><small>{review.exampleGraph.delivery.detail}</small></article>
          <article><span>示例目标「{review.exampleGraph.goalTitle}」· 里程碑</span><strong>{review.exampleGraph.capability.status}</strong><small>{review.exampleGraph.capability.detail}</small></article>
        </div>
        <details className="weekly-review-sources">
          <summary>本周计划安排与证据记录</summary>
          {review.plannedActions.length ? <ul>{review.plannedActions.map(action => <li key={action}>{action}</li>)}</ul> : <p>没有已安排的行动。</p>}
          {review.evidence.length ? <ul className="weekly-review-evidence">{review.evidence.map(item => <li key={item.id}><strong>{item.level} · {item.source}</strong><span>{item.text}</span><small>{item.reference} · {new Date(item.observedAt).toLocaleString('zh-CN')}</small></li>)}</ul> : <p>本周没有关联证据记录。</p>}
        </details>
        <div className="weekly-review-columns">
          <section><h3>事实</h3><ul>{review.facts.map((fact, index) => <li key={`${index}-${fact}`}>{fact}</li>)}</ul></section>
          <section><h3>待验证推断</h3><ul>{review.hypotheses.map((hypothesis, index) => <li key={`${index}-${hypothesis}`}>{hypothesis}</li>)}</ul></section>
        </div>
        <section className="weekly-review-gaps"><h3>证据缺口与计划偏差</h3>
          {review.exampleGraph.evidenceGaps.length ? <ul>{review.exampleGraph.evidenceGaps.map(gap => <li key={gap}>{gap}</li>)}</ul> : <p>本周记录没有显示证据缺口。</p>}
          {review.deviations.length ? <ul>{review.deviations.map((deviation, index) => <li key={`${index}-${deviation}`}>{deviation}</li>)}</ul> : <p>没有已记录的未排入事项或重排变化。</p>}
        </section>
        <section className="weekly-review-adjustment" aria-labelledby="weekly-review-adjustment-title">
          <div><span className="kicker">ONE VERIFIABLE CHANGE</span><h3 id="weekly-review-adjustment-title">下周只做一项调整</h3></div>
          <p className="weekly-review-milestone">示例目标：{adjustment.goalTitle} · 关联里程碑：{adjustment.milestoneTitle}</p>
          <label>调整建议<input value={adjustment.title} disabled={saved || busy} onChange={event => setAdjustment({ ...adjustment, title: event.target.value })} /></label>
          <label>依据<textarea value={adjustment.rationale} disabled={saved || busy} rows={2} onChange={event => setAdjustment({ ...adjustment, rationale: event.target.value })} /></label>
          <label>预期结果<textarea value={adjustment.expectedResult} disabled={saved || busy} rows={2} onChange={event => setAdjustment({ ...adjustment, expectedResult: event.target.value })} /></label>
          <label>验证日期<input type="date" min={addDays(review.weekEnd, 1)} value={adjustment.verificationDate} disabled={saved || busy} onChange={event => setAdjustment({ ...adjustment, verificationDate: event.target.value })} /></label>
          {saved ? <p className="weekly-review-saved-at">已于 {new Date(record.savedAt!).toLocaleString('zh-CN')} 核对保存{adjustment.modifiedByUser ? '，并记录了你的调整' : ''}；再次打开该周会恢复同一份复盘。</p> : <button className="primary-button" disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : '核对并保存本周复盘'}</button>}
        </section>
      </>}
    </section>
  );
}
