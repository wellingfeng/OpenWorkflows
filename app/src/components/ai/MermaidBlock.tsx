import { useEffect, useId, useState } from 'react';
import { AlertTriangle, Workflow } from 'lucide-react';
import CopyButton from './CopyButton';
import RawCodeBlock from './RawCodeBlock';

type MermaidRenderResult = {
  svg: string;
  bindFunctions?: (element: Element) => void;
};

type MermaidModule = {
  default: {
    initialize: (config: Record<string, unknown>) => void;
    render: (id: string, source: string) => Promise<MermaidRenderResult>;
  };
};

let mermaidReady = false;

export default function MermaidBlock({ code }: { code: string }) {
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setSvg('');
    setError('');

    const render = async () => {
      const renderId = `ai-mermaid-${reactId}-${hashCode(code)}`;
      try {
        const mermaid = (await import('mermaid') as MermaidModule).default;
        if (!mermaidReady) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            suppressErrorRendering: true,
            theme: 'dark',
            flowchart: { htmlLabels: false },
            sequence: { mirrorActors: false },
          });
          mermaidReady = true;
        }

        const result = await mermaid.render(renderId, code);
        if (!cancelled) setSvg(result.svg);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        cleanupMermaidRenderArtifacts(renderId);
      }
    };

    void render();
    return () => {
      cancelled = true;
    };
  }, [code, reactId]);

  if (error) {
    return (
      <div className="ai-mermaid my-2 overflow-hidden rounded-lg border border-[var(--code-border)]">
        <div className="ai-mermaid__header flex items-center justify-between gap-2 border-b border-[var(--code-border)] bg-[var(--code-header-bg)] px-3 py-1.5">
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-fg-faint">
            <AlertTriangle size={13} className="shrink-0 text-danger" />
            <span className="truncate">Mermaid 渲染失败</span>
          </span>
          <CopyButton value={code} label="复制" className="px-1 py-0.5" />
        </div>
        <div className="px-3 py-2 text-xs text-fg-dim">{error}</div>
        <RawCodeBlock raw={code} language="mermaid" compact className="border-x-0 border-b-0" />
      </div>
    );
  }

  return (
    <div className="ai-mermaid my-2 overflow-hidden rounded-lg border border-[var(--code-border)] bg-[var(--code-bg)]">
      <div className="ai-mermaid__header flex items-center justify-between gap-2 border-b border-[var(--code-border)] bg-[var(--code-header-bg)] px-3 py-1.5">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-fg-faint">
          <Workflow size={13} className="shrink-0 text-accent" />
          <span className="truncate">mermaid</span>
        </span>
        <CopyButton value={code} label="复制" className="px-1 py-0.5" />
      </div>
      <div
        className="ai-mermaid__body overflow-auto p-3"
        aria-label="Mermaid 图表"
        dangerouslySetInnerHTML={
          svg
            ? { __html: svg }
            : { __html: '<span class="ai-mermaid__status">正在渲染图表...</span>' }
        }
      />
    </div>
  );
}

function hashCode(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function cleanupMermaidRenderArtifacts(renderId: string) {
  document.getElementById(`d${renderId}`)?.remove();
  document.getElementById(`i${renderId}`)?.remove();
}
