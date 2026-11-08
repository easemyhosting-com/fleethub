"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { tourSteps, type TourAction } from "@/lib/tour/steps";

interface Props { onClose: () => void; onAction: (action: TourAction) => void }

export function GuidedTour({ onClose, onAction }: Props) {
  const [index, setIndex] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const step = tourSteps[index];
  const last = index === tourSteps.length - 1;

  useEffect(() => {
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") setIndex(value => Math.min(value + 1, tourSteps.length - 1));
      if (event.key === "ArrowLeft") setIndex(value => Math.max(value - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="tour-title" className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-950 p-6 shadow-2xl outline-none">
      <div className="flex items-start justify-between gap-3">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-emerald-400">Guided tour · {index + 1} of {tourSteps.length}</p>
        <button type="button" onClick={onClose} aria-label="Close guided tour" className="rounded p-1 text-zinc-400 hover:text-white"><X className="h-4 w-4" /></button>
      </div>
      <h2 id="tour-title" className="mt-3 text-lg font-semibold text-white">{step.title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-6 text-zinc-300">{step.body.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</div>
      {step.note ? <p className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-5 text-amber-200">{step.note}</p> : null}
      {step.action ? <button type="button" onClick={() => onAction(step.action!.kind)} className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20">{step.action.label}</button> : null}
      <div className="mt-6 flex items-center justify-between gap-3">
        <div className="flex gap-1.5" aria-hidden="true">{tourSteps.map((item, position) => <span key={item.id} className={`h-1.5 w-6 rounded-full ${position === index ? "bg-emerald-400" : "bg-zinc-700"}`} />)}</div>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs text-zinc-400 hover:text-white">{last ? "Close" : "Skip tour"}</button>
          {index > 0 ? <button type="button" onClick={() => setIndex(index - 1)} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-800">Back</button> : null}
          {last ? <button type="button" onClick={onClose} className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-black hover:bg-emerald-400">Finish</button> : <button type="button" onClick={() => setIndex(index + 1)} className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-black hover:bg-emerald-400">Next</button>}
        </div>
      </div>
    </div>
  </div>;
}
