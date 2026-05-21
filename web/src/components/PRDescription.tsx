import { useEffect, useRef, useState } from 'react';

interface Props {
  bodyHtml: string | null;
}

const COLLAPSED_MAX_PX = 320;

export function PRDescription({ bodyHtml }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    setOverflows(ref.current.scrollHeight > COLLAPSED_MAX_PX + 8);
  }, [bodyHtml]);

  if (!bodyHtml || bodyHtml.trim() === '') return null;

  return (
    <section className="pr-description">
      <div
        ref={ref}
        className={`markdown-body${overflows && !expanded ? ' markdown-body-collapsed' : ''}`}
        style={overflows && !expanded ? { maxHeight: COLLAPSED_MAX_PX } : undefined}
        dangerouslySetInnerHTML={{ __html: bodyHtml }}
      />
      {overflows && (
        <button
          type="button"
          className="pr-description-toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </section>
  );
}
