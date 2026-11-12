'use client';

import { useEffect, useRef, useState } from 'react';
import type { AgentContextSelection, AgentDiscussion } from '../lib/agent-context';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  confirmation?: AgentDiscussion['confirmation'];
};

export default function AgentAssistant({ selection, breadcrumb }: {
  selection: AgentContextSelection;
  breadcrumb: string;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const selectionKey = JSON.stringify(selection);
  const selectionKeyRef = useRef(selectionKey);
  const selectionGenerationRef = useRef(0);
  const contextRevisionRef = useRef(Date.now());
  const discussionControllerRef = useRef<AbortController | null>(null);
  if (selectionKeyRef.current !== selectionKey) {
    selectionKeyRef.current = selectionKey;
    selectionGenerationRef.current += 1;
  }

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const revision = Math.max(Date.now(), contextRevisionRef.current + 1);
    contextRevisionRef.current = revision;
    discussionControllerRef.current?.abort();
    discussionControllerRef.current = null;
    setSending(false);
    setError('');
    setMessages([]);
    void fetch('/api/agent-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selection, revision }),
      signal: controller.signal,
    }).then(async response => {
      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error || '无法同步当前讨论对象');
      }
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : '无法同步当前讨论对象');
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [selectionKey]);

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    setError('');
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      text,
    };
    const messageGeneration = selectionGenerationRef.current;
    setMessages(current => [...current, userMessage]);
    setMessage('');
    const controller = new AbortController();
    discussionControllerRef.current = controller;
    try {
      const response = await fetch('/api/agent-discussion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, context: selection }),
        signal: controller.signal,
      });
      const data = await response.json() as AgentDiscussion & { error?: string };
      if (!response.ok) throw new Error(data.error || '无法继续讨论');
      if (selectionGenerationRef.current !== messageGeneration) return;
      setMessages(current => [...current, {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: data.reply,
        confirmation: data.confirmation,
      }]);
    } catch (cause) {
      if (controller.signal.aborted || selectionGenerationRef.current !== messageGeneration) return;
      setError(cause instanceof Error ? cause.message : '无法继续讨论');
    } finally {
      if (discussionControllerRef.current === controller) {
        discussionControllerRef.current = null;
        setSending(false);
      }
    }
  }

  return <aside className={`agent-assistant${open ? ' open' : ''}`} aria-label="业务 Agent">
    {open && <section className="agent-assistant-panel" aria-labelledby="agent-assistant-title">
      <header>
        <div><span className="kicker">ONE CONTEXTUAL AGENT</span><h2 id="agent-assistant-title">业务 Agent</h2></div>
        <button type="button" className="agent-assistant-close" aria-label="收起 Agent" onClick={() => setOpen(false)}>×</button>
      </header>
      <div className="agent-current-context">
        <span>正在讨论</span>
        <strong>{breadcrumb}</strong>
        <small>应用与 pi 共用这个对象上下文和同一份个人执行图谱。切换目标或行动后会开始独立的新上下文。</small>
      </div>
      <div className="agent-messages" aria-live="polite">
        {messages.length === 0 && <p className="agent-empty">可以询问下一步、当前标准、证据要求或如何推进。改变标准、外部承诺或关键取舍时会转入现有确认流程。</p>}
        {messages.map(item => <article key={item.id} className={`agent-message ${item.role}`}>
          <span>{item.role === 'user' ? '你' : '业务 Agent'}</span>
          <p>{item.text}</p>
          {item.confirmation?.required && <div className="agent-confirmation">
            <strong>{item.confirmation.title}</strong>
            <small>{item.confirmation.detail}</small>
            {item.confirmation.nextStep && <small>{item.confirmation.nextStep}</small>}
          </div>}
        </article>)}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      <form className="agent-compose" onSubmit={event => void send(event)}>
        <label htmlFor="agent-message">继续讨论「{breadcrumb}」</label>
        <textarea id="agent-message" rows={3} maxLength={4000} value={message} onChange={event => setMessage(event.target.value)} placeholder="例如：接下来最应该做什么？" />
        <button type="submit" className="primary-button" disabled={sending || !message.trim()}>{sending ? '正在核对…' : '发送'}</button>
      </form>
    </section>}
    <button type="button" className="agent-assistant-trigger" aria-expanded={open} onClick={() => setOpen(current => !current)}>
      <span>✳ Agent</span>
      <strong>正在讨论：{breadcrumb}</strong>
      <small>{open ? '收起 Agent' : '展开 Agent'}</small>
    </button>
  </aside>;
}
