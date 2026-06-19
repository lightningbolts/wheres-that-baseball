"use client";

import { useEffect, useState } from "react";

import { useTheme } from "@/components/providers/ThemeProvider";
import {
  FIELD_SEGMENT_STYLES,
  type FieldSegmentStyle,
} from "@/lib/mlb/ballparkPaths";

export interface FieldChartColors {
  chartBg: string;
  canvasBg: string;
  segmentStyles: Record<string, FieldSegmentStyle>;
}

const FALLBACK: FieldChartColors = {
  chartBg: "#1a2e1a",
  canvasBg: "#0f1a12",
  segmentStyles: FIELD_SEGMENT_STYLES,
};

function readFieldChartColors(): FieldChartColors {
  if (typeof window === "undefined") return FALLBACK;

  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;

  const segmentStyles: Record<string, FieldSegmentStyle> = {
    outfield_outer: {
      fill: read("--field-outfield-fill", "#243524"),
      stroke: read("--field-outfield-stroke", "#3d5c3d"),
      strokeWidth: 0.5,
    },
    outfield_inner: {
      fill: "none",
      stroke: read("--field-outfield-stroke", "#3d5c3d"),
      strokeWidth: 0.25,
      opacity: 0.4,
    },
    infield_outer: {
      fill: read("--field-infield-fill", "#2a3f2a"),
      stroke: read("--field-infield-stroke", "#4a6b4a"),
      strokeWidth: 0.4,
    },
    infield_inner: {
      fill: "none",
      stroke: read("--field-infield-stroke", "#4a6b4a"),
      strokeWidth: 0.25,
      opacity: 0.5,
    },
    foul_lines: {
      fill: "none",
      stroke: read("--field-line-stroke", "#4a6b4a"),
      strokeWidth: 0.3,
      opacity: 0.6,
    },
    home_plate: {
      fill: read("--field-home-plate-fill", "#e5e5e5"),
      stroke: read("--field-home-plate-stroke", "#ffffff"),
      strokeWidth: 0.3,
    },
  };

  return {
    chartBg: read("--field-chart-bg", "#1a2e1a"),
    canvasBg: read("--field-chart-canvas-bg", "#0f1a12"),
    segmentStyles,
  };
}

/** Resolved field-chart palette for WebGL (CSS variables are not valid Three.js colors). */
export function useFieldChartColors(): FieldChartColors {
  const { theme } = useTheme();
  const [colors, setColors] = useState(readFieldChartColors);

  useEffect(() => {
    setColors(readFieldChartColors());
  }, [theme]);

  return colors;
}
