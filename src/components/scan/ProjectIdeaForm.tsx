import React, { useState } from 'react';
import { ProjectIdeaInput, ExperienceLevel, BudgetTier, ProjectType, TimelineMonths, AIUsageLevel } from '@/lib/types';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { SubmitScanButton } from './SubmitScanButton';

interface ProjectIdeaFormProps {
  onSubmit: (data: ProjectIdeaInput) => void;
  loading: boolean;
}

export const ProjectIdeaForm = ({ onSubmit, loading }: ProjectIdeaFormProps) => {
  const [experience, setExperience] = useState<ExperienceLevel>('intermediate');
  const [budget, setBudget] = useState<BudgetTier>('medium');
  const [hoursPerWeek, setHoursPerWeek] = useState<number>(20);
  const [projectType, setProjectType] = useState<ProjectType>('saas');
  const [coreIncome, setCoreIncome] = useState<boolean>(false);
  const [timelineMonths, setTimelineMonths] = useState<TimelineMonths>(6);
  const [aiUsage, setAiUsage] = useState<AIUsageLevel>('moderate');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      experience,
      budget,
      hoursPerWeek,
      projectType,
      coreIncome,
      timelineMonths,
      aiUsage,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select
          label="Your Experience Level"
          value={experience}
          onChange={(e) => setExperience(e.target.value as ExperienceLevel)}
          options={[
            { value: 'beginner', label: 'Beginner (0-2 years)' },
            { value: 'intermediate', label: 'Intermediate (2-5 years)' },
            { value: 'advanced', label: 'Advanced (5+ years / Elite)' },
          ]}
        />

        <Select
          label="Available Funding Budget"
          value={budget}
          onChange={(e) => setBudget(e.target.value as BudgetTier)}
          options={[
            { value: 'free', label: 'Zero Budget ($0 / Self-Funded)' },
            { value: 'low', label: 'Low ($100 - $1,000)' },
            { value: 'medium', label: 'Medium ($1,000 - $10,000)' },
            { value: 'high', label: 'High ($10,000+ / Venture)' },
          ]}
        />

        <Input
          label="Available Hours per Week"
          type="number"
          min={1}
          max={168}
          value={hoursPerWeek}
          onChange={(e) => setHoursPerWeek(Math.max(1, parseInt(e.target.value) || 0))}
        />

        <Select
          label="Project Domain / Type"
          value={projectType}
          onChange={(e) => setProjectType(e.target.value as ProjectType)}
          options={[
            { value: 'saas', label: 'SaaS (Software-as-a-Service)' },
            { value: 'mobile', label: 'Mobile Application' },
            { value: 'web', label: 'Web Application / Portal' },
            { value: 'desktop', label: 'Desktop Software' },
            { value: 'cli', label: 'Command-Line Interface (CLI)' },
            { value: 'library', label: 'Open-Source Library / Package' },
            { value: 'other', label: 'Other/Custom' },
          ]}
        />

        <Select
          label="Is this for your primary core income?"
          value={coreIncome ? 'yes' : 'no'}
          onChange={(e) => setCoreIncome(e.target.value === 'yes')}
          options={[
            { value: 'no', label: 'No (Side-Project / Hobby / Secondary)' },
            { value: 'yes', label: 'Yes (Sole/Primary Income Source)' },
          ]}
        />

        <Select
          label="Target Timeline to Launch"
          value={timelineMonths}
          onChange={(e) => setTimelineMonths(parseInt(e.target.value) as TimelineMonths)}
          options={[
            { value: 1, label: '1 Month' },
            { value: 2, label: '2 Months' },
            { value: 3, label: '3 Months (Standard MVP)' },
            { value: 6, label: '6 Months' },
            { value: 12, label: '12 Months (1 Year)' },
            { value: 18, label: '18 Months' },
            { value: 24, label: '24 Months (2 Years)' },
          ]}
        />
      </div>

      <Select
        label="Planned AI Generation Usage Level"
        value={aiUsage}
        onChange={(e) => setAiUsage(e.target.value as AIUsageLevel)}
        options={[
          { value: 'none', label: 'None (Pure Manual Coding)' },
          { value: 'light', label: 'Light (GitHub Copilot / Inline Autocomplete)' },
          { value: 'moderate', label: 'Moderate (Heuristics, Refactoring, Spec Generation)' },
          { value: 'heavy', label: 'Heavy (Fully Autonomous Agent Scaffolding)' },
        ]}
      />

      <SubmitScanButton loading={loading}>
        Generate Reality Report
      </SubmitScanButton>
    </form>
  );
};
