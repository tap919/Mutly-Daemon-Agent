import React, { useState } from 'react';
import { ChatResponseInput } from '@/lib/types';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { SubmitScanButton } from './SubmitScanButton';

interface ChatResponseFormProps {
  onSubmit: (data: ChatResponseInput) => void;
  loading: boolean;
}

export const ChatResponseForm = ({ onSubmit, loading }: ChatResponseFormProps) => {
  const [text, setText] = useState<string>('');
  const [source, setSource] = useState<string>('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSubmit({
      text,
      source: source.trim() || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Textarea
        label="Copy-Paste Response / Assertions Text"
        placeholder="Insert the text or assertions you want analyzed for factuality, overclaiming, risk profiles, and structural logic..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        required
      />

      <Input
        label="Stated Citation Source (Optional URL/Origin)"
        placeholder="https://example.com/source-doc"
        type="text"
        value={source}
        onChange={(e) => setSource(e.target.value)}
      />

      <div className="rounded-lg bg-zinc-900/40 border border-zinc-850 p-3">
        <p className="text-[11px] text-zinc-500 font-mono leading-relaxed">
          <span className="font-semibold text-zinc-400">Heuristic Engine Notice:</span> This scan utilizes syntax, complexity indexes, semantic metrics, transition frequencies, and statistical linguistic structures to run deterministic algorithmic audits. No external LLM is contacted.
        </p>
      </div>

      <SubmitScanButton loading={loading} disabled={!text.trim()}>
        Run Heuristic Audit Scan
      </SubmitScanButton>
    </form>
  );
};
