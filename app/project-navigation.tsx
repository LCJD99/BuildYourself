'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GoalProject } from '@/lib/goal-plans';

export default function ProjectNavigation({ selectedProjectId, onSelect, onProjectsChange }: {
  selectedProjectId?: string | null;
  onSelect: (project: GoalProject) => void;
  onProjectsChange: (projects: GoalProject[]) => void;
}) {
  const [projects, setProjects] = useState<GoalProject[]>([]);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/projects', { cache: 'no-store' });
      if (response.ok) {
        const data = (await response.json() as { projects: GoalProject[] }).projects;
        setProjects(data);
        onProjectsChange(data);
      }
    } catch { /* the navigation remains available when the local service returns */ }
  }, [onProjectsChange]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (!projects.length) return null;
  return <>
    <div className="tree-label project-tree-label">共享项目</div>
    <div className="tree project-tree">
      {projects.map(project => {
        const primary = project.goals.find(goal => goal.goalPlanId === project.primaryGoalPlanId);
        const aliases = project.goals.filter(goal => goal.goalPlanId !== project.primaryGoalPlanId);
        return <div className="project-tree-group" key={project.id}>
          <button className={`${selectedProjectId === project.id ? 'active ' : ''}project-tree-primary`} onClick={() => onSelect(project)}>
            <span className="node-icon">▣</span>
            <span>{project.title}<small>主要位置 · {primary?.title ?? '目标已归档'} · {project.id.slice(0, 6)}</small></span>
          </button>
          {aliases.map(goal => <button key={goal.goalPlanId} className={`${selectedProjectId === project.id ? 'active ' : ''}child project-tree-alias`} onClick={() => onSelect(project)}>
            <span className="node-icon">↗</span><span>{goal.title} · {project.title} · {project.id.slice(0, 6)}</span>
          </button>)}
        </div>;
      })}
    </div>
  </>;
}
