import React, { useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Terminal,
} from 'lucide-react';
import type { AgentToolStep } from '../types/relay';

interface AgentTraceBlockProps {
  thinking?: string;
  toolSteps?: AgentToolStep[];
  elapsedMs?: number;
  streaming?: boolean;
}

/**
 * Meta Muse-inspired Three-Layer Status Component:
 * Layer 1: Calm single-line summary of what the agent is doing / did
 * Layer 2: Expandable step-by-step tool execution timeline
 * Layer 3: Under-the-hood reasoning transcript & raw tool details
 */
export const AgentTraceBlock: React.FC<AgentTraceBlockProps> = ({
  thinking,
  toolSteps,
  elapsedMs,
  streaming,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [showUnderHood, setShowUnderHood] = useState(false);

  const hasThinking = Boolean(thinking && thinking.trim());
  const hasTools = Boolean(toolSteps && toolSteps.length > 0);

  if (!hasThinking && !hasTools && !streaming) return null;

  const runningTool = toolSteps?.find((t) => t.status === 'running');
  const durationLabel =
    elapsedMs && elapsedMs >= 300 ? `${(elapsedMs / 1000).toFixed(1)}s` : undefined;

  let summaryText = '已完成处理';
  if (streaming) {
    if (runningTool) {
      summaryText = `正在执行 · ${runningTool.name}`;
    } else if (hasThinking) {
      summaryText = '正在思考…';
    } else {
      summaryText = '正在连接云端 Agent…';
    }
  } else {
    const parts: string[] = [];
    if (hasThinking) parts.push('已完成思考');
    if (hasTools) parts.push(`调用 ${toolSteps!.length} 项工具`);
    if (durationLabel) parts.push(durationLabel);
    summaryText = parts.join(' · ') || '已完成';
  }

  const canExpand = hasThinking || hasTools;

  return (
    <div className="mb-2.5">
      {/* Layer 1: Essentials single-line calm status */}
      <button
        type="button"
        disabled={!canExpand}
        onClick={() => canExpand && setExpanded((prev) => !prev)}
        className={`inline-flex items-center gap-2 rounded-full border border-black/[0.07] px-3 py-1.5 text-xs transition-colors dark:border-white/10 ${
          canExpand
            ? 'bg-white text-zinc-600 shadow-xs hover:bg-zinc-50 hover:text-zinc-950 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
            : 'bg-white/90 text-zinc-500 dark:bg-zinc-900/70 dark:text-zinc-400 cursor-default'
        }`}
      >
        {streaming ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#1B6EF3] dark:text-blue-400 shrink-0" />
        ) : (
          <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
        )}
        <span className="font-medium">{summaryText}</span>
        {canExpand &&
          (expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
          ))}
      </button>

      {/* Layer 2: Structured Process Steps */}
      {expanded && canExpand && (
        <div className="mt-2 rounded-2xl border border-black/[0.07] bg-white p-3.5 text-xs shadow-sm dark:border-zinc-800 dark:bg-[#15171C] space-y-3">
          {hasTools && (
            <div className="space-y-2">
              {toolSteps!.map((step) => (
                <div key={step.id} className="flex items-start gap-2.5">
                  <div className="mt-0.5 shrink-0">
                    {step.status === 'running' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#1B6EF3]" />
                    ) : step.status === 'error' ? (
                      <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
                    ) : (
                      <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 font-mono-tabular font-medium text-zinc-800 dark:text-zinc-200">
                      <Terminal className="h-3 w-3 text-zinc-400 shrink-0" />
                      <span className="truncate">{step.name}</span>
                    </div>
                    {step.detail && (
                      <p className="mt-0.5 truncate font-mono-tabular text-[11px] text-zinc-500 dark:text-zinc-400">
                        {step.detail}
                      </p>
                    )}
                    {step.output && (
                      <pre className="mt-1.5 max-h-28 overflow-auto rounded-lg bg-stone-100 p-2 font-mono-tabular text-[11px] text-zinc-700 whitespace-pre-wrap break-all dark:bg-zinc-900 dark:text-zinc-300">
                        {step.output}
                      </pre>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Layer 3: Under-the-Hood Reasoning Transcript */}
          {hasThinking && (
            <div className={hasTools ? 'border-t border-stone-100 pt-2.5 dark:border-zinc-800/80' : ''}>
              {hasTools ? (
                <button
                  type="button"
                  onClick={() => setShowUnderHood((prev) => !prev)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  {showUnderHood ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  <span>{showUnderHood ? '收起完整思考与底层输出' : '查看完整思考与底层输出'}</span>
                </button>
              ) : null}

              {(!hasTools || showUnderHood) && (
                <div className="mt-1.5 max-h-56 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                  {thinking}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
