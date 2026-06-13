"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Eraser } from "lucide-react";

/**
 * A small HTML-canvas signature pad. Supports mouse + touch + pen via pointer
 * events. Exposes the drawn signature as a transparent PNG data-url through the
 * `onChange` callback (null when the canvas is empty after a clear).
 */
export function SignaturePad({
  onChange,
  height = 160,
}: {
  onChange: (dataUrl: string | null) => void;
  height?: number;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const drawing = React.useRef(false);
  const hasInk = React.useRef(false);
  const last = React.useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = React.useState(true);

  // Size the canvas backing store to its CSS box * devicePixelRatio for crisp ink.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#0f1115";
    }
  }, []);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pos(e);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !last.current) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!hasInk.current) {
      hasInk.current = true;
      setEmpty(false);
    }
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    if (hasInk.current && canvasRef.current) {
      onChange(canvasRef.current.toDataURL("image/png"));
    }
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    hasInk.current = false;
    setEmpty(true);
    onChange(null);
  }

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-lg border bg-white">
        <canvas
          ref={canvasRef}
          style={{ height, width: "100%", touchAction: "none" }}
          className="block cursor-crosshair"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          onPointerCancel={end}
        />
        {empty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Draw your signature here
          </div>
        )}
        <div className="pointer-events-none absolute bottom-3 left-4 right-4 border-b border-dashed border-muted-foreground/30" />
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={empty}>
          <Eraser className="h-3.5 w-3.5" /> Clear
        </Button>
      </div>
    </div>
  );
}
