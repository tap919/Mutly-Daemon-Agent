import React, { useState } from 'react';
import { ScanPayload, ProjectIdeaInput, ChatResponseInput } from '@/lib/types';
import { ProjectIdeaForm } from './ProjectIdeaForm';
import { ChatResponseForm } from './ChatResponseForm';

interface ScanTypePickerProps {
  onScanSubmit: (payload: ScanPayload) => void;
  loading: boolean;
}

export const ScanTypePicker = ({ onScanSubmit, loading }: ScanTypePickerProps) => {
  const [activeType, setActiveType] = useState<'project_idea' | 'chat_response'>('project_idea');

  const handleProjectSubmit = (data: ProjectIdeaInput) => {
    onScanSubmit({ type: 'project_idea', data });
  };

  const handleChatSubmit = (data: ChatResponseInput) => {
    onScanSubmit({ type: 'chat_response', data });
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Type Selector Tabs */}
      <div className="flex border-b border-zinc-900">
        <button
          onClick={() => !loading && setActiveType('project_idea')}
          className={`flex-1 py-3.5 text-center text-sm font-semibold border-b-2 transition-all duration-300 select-none outline-none
            ${
              activeType === 'project_idea'
                ? 'border-indigo-500 text-indigo-400 font-bold'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }
            ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          Project Viability Form
        </button>
        <button
          onClick={() => !loading && setActiveType('chat_response')}
          className={`flex-1 py-3.5 text-center text-sm font-semibold border-b-2 transition-all duration-300 select-none outline-none
            ${
              activeType === 'chat_response'
                ? 'border-indigo-500 text-indigo-400 font-bold'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }
            ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          Assertion Text Auditor
        </button>
      </div>

      {/* Render selected form */}
      <div className="bg-zinc-900/10 rounded-xl border border-zinc-900 p-6">
        {activeType === 'project_idea' ? (
          <ProjectIdeaForm onSubmit={handleProjectSubmit} loading={loading} />
        ) : (
          <ChatResponseForm onSubmit={handleChatSubmit} loading={loading} />
        )}
      </div>
    </div>
  );
};
