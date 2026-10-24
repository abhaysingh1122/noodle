import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { api, noteName, type Graph } from "../lib/api";

interface SimNode {
  id: string;
  label: string;
  exists: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
  /** Pinned while being dragged. */
  fixed: boolean;
}

interface Props {
  activePath: string | null;
  /** Opens a note by path, or (for notes that don't exist yet) by link target. */
  onOpen(id: string, exists: boolean): void;
  onClose(): void;
  /** Bumped when the vault changes, to reload the graph. */
  version: number;
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * The whole vault as a bowl of noodles: every note is a dot, every strand a
 * gently curved line. Drag dots around, scroll to zoom, click to open.
 */
export function GraphView({ activePath, onOpen, onClose, version }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [showMissing, setShowMissing] = useState(true);
  const [count, setCount] = useState({ notes: 0, strands: 0 });

  useEffect(() => {
    api.graph().then(setGraph);
  }, [version]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !graph) return;
    const ctx = canvas.getContext("2d")!;

    // Keep positions of nodes we already had, so reloads don't jump.
    const prev = (canvas as unknown as { _nodes?: Map<string, SimNode> })._nodes ?? new Map<string, SimNode>();
    const keep = new Set(graph.nodes.filter((n) => showMissing || n.exists).map((n) => n.id));
    const edges = graph.edges.filter(([a, b]) => keep.has(a) && keep.has(b));
    const nodes = new Map<string, SimNode>();
    graph.nodes.forEach((n, i) => {
      if (!keep.has(n.id)) return;
      const old = prev.get(n.id);
      const angle = i * 2.399963; // golden angle spiral for a tidy start
      const radius = 18 * Math.sqrt(i + 1);
      nodes.set(n.id, {
        id: n.id,
        label: n.exists ? noteName(n.id) : n.id,
        exists: n.exists,
        x: old?.x ?? Math.cos(angle) * radius,
        y: old?.y ?? Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        degree: 0,
        fixed: false,
      });
    });
    (canvas as unknown as { _nodes?: Map<string, SimNode> })._nodes = nodes;
    const links = edges.map(([a, b]) => [nodes.get(a)!, nodes.get(b)!] as const);
    links.forEach(([a, b]) => (a.degree++, b.degree++));
    const list = [...nodes.values()];
    setCount({ notes: list.filter((n) => n.exists).length, strands: links.length });
    const neighbours = new Map<string, Set<string>>();
    links.forEach(([a, b]) => {
      (neighbours.get(a.id) ?? neighbours.set(a.id, new Set()).get(a.id)!).add(b.id);
      (neighbours.get(b.id) ?? neighbours.set(b.id, new Set()).get(b.id)!).add(a.id);
    });

    const radius = (n: SimNode) => 5 + Math.min(10, Math.sqrt(n.degree) * 2.4);
    let view = { x: 0, y: 0, k: 1 };
    let alpha = 1;
    let hover: SimNode | null = null;
    let drag: { node: SimNode | null; sx: number; sy: number; moved: boolean; vx: number; vy: number } | null = null;
    let frame = 0;
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = r.width * dpr;
      canvas.height = r.height * dpr;
      alpha = Math.max(alpha, 0.05);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const toWorld = (px: number, py: number) => {
      const r = canvas.getBoundingClientRect();
      return { x: (px - r.left - r.width / 2 - view.x) / view.k, y: (py - r.top - r.height / 2 - view.y) / view.k };
    };
    const nodeAt = (px: number, py: number) => {
      const p = toWorld(px, py);
      let best: SimNode | null = null;
      let bestD = Infinity;
      for (const n of list) {
        const d = Math.hypot(n.x - p.x, n.y - p.y);
        if (d < radius(n) + 6 / view.k && d < bestD) {
          best = n;
          bestD = d;
        }
      }
      return best;
    };

    const step = () => {
      // Repulsion between every pair, springs along strands, and a soft pull to the middle.
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) {
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
            d2 = 0.25;
          }
          if (d2 > 250000) continue;
          const f = (900 / d2) * alpha;
          a.vx += dx * f;
          a.vy += dy * f;
          b.vx -= dx * f;
          b.vy -= dy * f;
        }
      }
      for (const [a, b] of links) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const f = ((d - 70) / d) * 0.06 * alpha;
        a.vx += dx * f;
        a.vy += dy * f;
        b.vx -= dx * f;
        b.vy -= dy * f;
      }
      for (const n of list) {
        n.vx -= n.x * 0.004 * alpha;
        n.vy -= n.y * 0.004 * alpha;
        if (n.fixed) {
          n.vx = n.vy = 0;
          continue;
        }
        n.vx *= 0.6;
        n.vy *= 0.6;
        n.x += n.vx;
        n.y += n.vy;
      }
      alpha *= 0.985;
    };

    const draw = () => {
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(w / 2 + view.x, h / 2 + view.y);
      ctx.scale(view.k, view.k);
      const accent = css("--accent") || "#7db46c";
      const muted = css("--muted") || "#7a8270";
      const text = css("--text") || "#2e3326";
      const yellow = css("--yellow-strong") || "#f4d66c";
      const surface = css("--surface") || "#fff";
      const focus = hover ?? null;
      const near = focus ? neighbours.get(focus.id) ?? new Set<string>() : null;

      // Strands: soft curves, so the graph looks more like noodles than wires.
      for (const [a, b] of links) {
        const lit = focus && (a === focus || b === focus);
        ctx.globalAlpha = focus ? (lit ? 0.9 : 0.12) : 0.45;
        ctx.strokeStyle = lit ? accent : muted;
        ctx.lineWidth = (lit ? 2.2 : 1.3) / Math.sqrt(view.k);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const bend = 0.12;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(mx - (b.y - a.y) * bend, my + (b.x - a.x) * bend, b.x, b.y);
        ctx.stroke();
      }
      for (const n of list) {
        const dim = focus && n !== focus && !near!.has(n.id);
        ctx.globalAlpha = dim ? 0.25 : 1;
        const r = radius(n);
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        if (n.exists) {
          ctx.fillStyle = n.id === activePath ? yellow : accent;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = surface;
          ctx.stroke();
        } else {
          ctx.fillStyle = surface;
          ctx.fill();
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = muted;
          ctx.stroke();
          ctx.setLineDash([]);
        }
        const showLabel = view.k > 0.7 || n === focus || n.id === activePath || n.degree > 3;
        if (showLabel && !dim) {
          ctx.fillStyle = n.exists ? text : muted;
          ctx.font = `${n === focus ? 800 : 650} ${12 / Math.min(view.k, 1.4)}px "Nunito Variable", Nunito, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(n.label, n.x, n.y + r + 13 / Math.min(view.k, 1.4));
        }
      }
      ctx.globalAlpha = 1;
    };

    const loop = () => {
      if (alpha > 0.004) step();
      draw();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const node = nodeAt(e.clientX, e.clientY);
      if (node) node.fixed = true;
      drag = { node, sx: e.clientX, sy: e.clientY, moved: false, vx: view.x, vy: view.y };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) {
        const h = nodeAt(e.clientX, e.clientY);
        if (h !== hover) {
          hover = h;
          canvas.style.cursor = h ? "pointer" : "grab";
        }
        return;
      }
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3) drag.moved = true;
      if (drag.node) {
        const p = toWorld(e.clientX, e.clientY);
        drag.node.x = p.x;
        drag.node.y = p.y;
        alpha = Math.max(alpha, 0.3);
      } else {
        view = { ...view, x: drag.vx + e.clientX - drag.sx, y: drag.vy + e.clientY - drag.sy };
        canvas.style.cursor = "grabbing";
      }
    };
    const onUp = () => {
      if (!drag) return;
      if (drag.node) {
        drag.node.fixed = false;
        if (!drag.moved) onOpen(drag.node.id, drag.node.exists);
      }
      drag = null;
      canvas.style.cursor = hover ? "pointer" : "grab";
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const k = Math.min(4, Math.max(0.2, view.k * Math.exp(-e.deltaY * 0.0015)));
      // Zoom around the mouse.
      const mx = e.clientX - r.left - r.width / 2;
      const my = e.clientY - r.top - r.height / 2;
      view = { k, x: mx - ((mx - view.x) * k) / view.k, y: my - ((my - view.y) * k) / view.k };
    };
    const onLeave = () => (hover = null);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [graph, showMissing, activePath, onOpen]);

  return (
    <div className="graph-view">
      <div className="graph-bar">
        <span className="graph-title">The bowl</span>
        <span className="muted small">
          {count.notes} notes · {count.strands} strands
        </span>
        <label className="graph-toggle">
          <input type="checkbox" checked={showMissing} onChange={(e) => setShowMissing(e.target.checked)} /> Notes not written yet
        </label>
        <button className="graph-close" title="Back to the note (Esc)" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <canvas ref={canvasRef} className="graph-canvas" />
      <p className="graph-hint muted small">Drag to move · scroll to zoom · click a dot to open it</p>
    </div>
  );
}
