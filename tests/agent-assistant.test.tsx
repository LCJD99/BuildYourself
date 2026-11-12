import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AgentAssistant from '../app/agent-assistant';

describe('应用内 Agent 入口', () => {
  it('始终展示当前讨论对象及其层级路径', () => {
    const markup = renderToStaticMarkup(<AgentAssistant
      selection={{ layer: 'task', goalPlanId: 'goal-1', actionId: 'action-1' }}
      breadcrumb="目标组合 / 英语展示 / 录制演示"
    />);

    expect(markup).toContain('正在讨论');
    expect(markup).toContain('目标组合 / 英语展示 / 录制演示');
    expect(markup).toContain('展开 Agent');
  });
});
