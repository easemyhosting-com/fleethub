"use client";

import { useMemo } from "react";
import qrcode from "qrcode-generator";

export function QrCode({ value, label }: { value: string; label: string }) {
  const cells = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const size = qr.getModuleCount();
    const dark: [number, number][] = [];
    for (let row = 0; row < size; row += 1) for (let col = 0; col < size; col += 1) if (qr.isDark(row, col)) dark.push([row, col]);
    return { size, dark };
  }, [value]);
  const margin = 2;
  const total = cells.size + margin * 2;
  return <svg role="img" aria-label={label} viewBox={`0 0 ${total} ${total}`} className="h-44 w-44 rounded bg-white" shapeRendering="crispEdges">
    <rect width={total} height={total} fill="#fff" />
    {cells.dark.map(([row, col]) => <rect key={`${row}-${col}`} x={col + margin} y={row + margin} width="1" height="1" fill="#000" />)}
  </svg>;
}
