import {
  SPRAY_HIT_BALL_OUTLINE,
  SPRAY_HIT_SHADOW,
} from "@/lib/mlb/sprayChartStyle";

interface SprayTrajectoryProps {
  homeX: number;
  homeY: number;
  x: number;
  y: number;
  color: string;
  selected?: boolean;
  lineWidth?: number;
  ballRadius?: number;
}

/** Hit line + landing dot with shadow underlay for field contrast. */
export function SprayTrajectory({
  homeX,
  homeY,
  x,
  y,
  color,
  selected = false,
  lineWidth,
  ballRadius = 2.4,
}: SprayTrajectoryProps) {
  const strokeW = lineWidth ?? (selected ? 0.85 : 0.65);
  const haloW = strokeW + 0.55;
  const r = selected ? Math.max(ballRadius, 3.2) : ballRadius;
  const haloR = r + 0.85;

  return (
    <g>
      <line
        x1={homeX}
        y1={homeY}
        x2={x}
        y2={y}
        stroke={SPRAY_HIT_SHADOW}
        strokeWidth={haloW}
        strokeLinecap="round"
        opacity={0.6}
      />
      <line
        x1={homeX}
        y1={homeY}
        x2={x}
        y2={y}
        stroke={color}
        strokeWidth={strokeW}
        strokeLinecap="round"
        opacity={selected ? 1 : 0.95}
      />
      <circle cx={x} cy={y} r={haloR} fill={SPRAY_HIT_SHADOW} opacity={0.55} />
      <circle
        cx={x}
        cy={y}
        r={r}
        fill={color}
        stroke={SPRAY_HIT_BALL_OUTLINE}
        strokeWidth={selected ? 0.85 : 0.65}
      />
    </g>
  );
}
