"use client";

import type { ReactElement } from "react";
import { useMemo } from "react";
import QRCode from "qrcode";

export function StyledQR({ data, size = 132 }: { data: string; size?: number }) {
  const matrix = useMemo(() => {
    const qr = QRCode.create(data, { errorCorrectionLevel: "H" });
    return { modules: qr.modules, count: qr.modules.size };
  }, [data]);

  const { modules, count } = matrix;
  const cell = size / count;
  const r = cell * 0.42;

  const finders = [
    { x: 0, y: 0 },
    { x: count - 7, y: 0 },
    { x: 0, y: count - 7 },
  ];
  const inFinder = (x: number, y: number) =>
    finders.some((f) => x >= f.x && x < f.x + 7 && y >= f.y && y < f.y + 7);

  const logoModules = Math.max(5, Math.round(count * 0.18));
  const logoStart = Math.floor((count - logoModules) / 2);
  const logoEnd = logoStart + logoModules;
  const inLogo = (x: number, y: number) =>
    x >= logoStart && x < logoEnd && y >= logoStart && y < logoEnd;

  const dots: ReactElement[] = [];
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      if (inFinder(x, y) || inLogo(x, y)) continue;
      if (modules.get(x, y)) {
        dots.push(
          <circle
            key={`${x}-${y}`}
            cx={(x + 0.5) * cell}
            cy={(y + 0.5) * cell}
            r={r}
            fill="#0a0a0a"
          />,
        );
      }
    }
  }

  const logoX = logoStart * cell;
  const logoY = logoStart * cell;
  const logoW = logoModules * cell;
  const pad = cell * 0.7;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Base deposit QR code">
      <rect width={size} height={size} rx={size * 0.06} fill="#ffffff" />
      {finders.map((f, i) => {
        const fx = f.x * cell;
        const fy = f.y * cell;
        const fs = 7 * cell;
        return (
          <g key={`finder-${i}`}>
            <rect x={fx} y={fy} width={fs} height={fs} rx={fs * 0.26} fill="#0a0a0a" />
            <rect
              x={fx + cell}
              y={fy + cell}
              width={fs - 2 * cell}
              height={fs - 2 * cell}
              rx={(fs - 2 * cell) * 0.24}
              fill="#ffffff"
            />
            <rect
              x={fx + 2 * cell}
              y={fy + 2 * cell}
              width={fs - 4 * cell}
              height={fs - 4 * cell}
              rx={(fs - 4 * cell) * 0.26}
              fill="#0a0a0a"
            />
          </g>
        );
      })}
      {dots}
      <rect
        x={logoX - pad}
        y={logoY - pad}
        width={logoW + pad * 2}
        height={logoW + pad * 2}
        rx={cell * 0.6}
        fill="#ffffff"
      />
      <rect x={logoX} y={logoY} width={logoW} height={logoW} rx={cell * 0.35} fill="#0052FF" />
    </svg>
  );
}
