import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { api, noteName, type Graph } from "../lib/api";

interface SimNode extends SimulationNodeDatum {
  id: string;
  label: string;
  exists: boolean;
  degree: number;
}
type SimLink = SimulationLinkDatum<SimNode> & { source: SimNode; target: SimNode };

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
    const nodes = new Map<string, SimNode>();
    for (const n of graph.nodes) {
      if (!keep.has(n.id)) continue;
      const old = prev.get(n.id);
      nodes.set(n.id, { id: n.id, label: n.exists ? noteName(n.id) : n.id, exists: n.exists, degree: 0, x: old?.x, y: old?.y });
    }
    (canvas as unknown as { _nodes?: Map<string, SimNode> })._nodes = nodes;
    const links: SimLink[] = graph.edges
      .filter(([a, b]) => keep.has(a) && keep.has(b))
      .map(([a, b]) => ({ source: nodes.get(a)!, target: nodes.get(b)! }));
    links.forEach((l) => (l.source.degree++, l.target.degree++));
    const list = [...nodes.values()];
    setCount({ notes: list.filter((n) => n.exists).length, strands: links.length });
    const neighbours = new Map<string, Set<string>>();
    for (const { source: a, target: b } of links) {
      (neighbours.get(a.id) ?? neighbours.set(a.id, new Set()).get(a.id)!).add(b.id);
      (neighbours.get(b.id) ?? neighbours.set(b.id, new Set()).get(b.id)!).add(a.id);
    }

    const radius = (n: SimNode) => 4 + Math.min(12, Math.sqrt(n.degree) * 2.2);
    // Clusters of linked notes pull together, everything pushes everything
    // else away, and loose notes drift in a ring around the middle.
    const sim = forceSimulation<SimNode>(list)
      .force("link", forceLink<SimNode, SimLink>(links).distance((l) => 40 + Math.min(60, (l.source.degree + l.target.degree) * 2)).strength(0.5))
      .force("charge", forceManyBody<SimNode>().strength((n) => -60 - n.degree * 12).distanceMax(600))
      .force("collide", forceCollide<SimNode>((n) => radius(n) + 6))
      .force("x", forceX<SimNode>(0).strength((n) => (n.degree ? 0.04 : 0.09)))
      .force("y", forceY<SimNode>(0).strength((n) => (n.degree ? 0.04 : 0.09)))
      .stop();
    // Settle the layout before the first frame, within a time budget.
    const started = performance.now();
    while (sim.alpha() > 0.02 && performance.now() - started < 250) sim.tick();

    let view = { x: 0, y: 0, k: 1 };
    // Fit the whole bowl in the window.
    const fit = () => {
      const r = canvas.getBoundingClientRect();
      if (!list.length || !r.width) return;
      const xs = list.map((n) => n.x ?? 0);
      const ys = list.map((n) => n.y ?? 0);
      const w = Math.max(...xs) - Math.min(...xs) + 120;
      const h = Math.max(...ys) - Math.min(...ys) + 120;
      const k = Math.min(2, Math.max(0.15, Math.min(r.width / w, r.height / h)));
      view = { k, x: -((Math.max(...xs) + Math.min(...xs)) / 2) * k, y: -((Math.max(...ys) + Math.min(...ys)) / 2) * k };
    };
    let hover: SimNode | null = null;
    let drag: { node: SimNode | null; sx: number; sy: number; moved: boolean; vx: number; vy: number } | null = null;
    let frame = 0;
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = r.width * dpr;
      canvas.height = r.height * dpr;
    };
    resize();
    if (!prev.size) fit();
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
        const d = Math.hypot((n.x ?? 0) - p.x, (n.y ?? 0) - p.y);
        if (d < radius(n) + 6 / view.k && d < bestD) {
          best = n;
          bestD = d;
        }
      }
      return best;
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
      for (const { source: a, target: b } of links) {
        const lit = focus && (a === focus || b === focus);
        ctx.globalAlpha = focus ? (lit ? 0.9 : 0.06) : 0.35;
        ctx.strokeStyle = lit ? accent : muted;
        ctx.lineWidth = (lit ? 2 : 1) / Math.sqrt(view.k);
        const ax = a.x ?? 0, ay = a.y ?? 0, bx = b.x ?? 0, by = b.y ?? 0;
        const bend = 0.08;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo((ax + bx) / 2 - (by - ay) * bend, (ay + by) / 2 + (bx - ax) * bend, bx, by);
        ctx.stroke();
      }
      for (const n of list) {
        const dim = focus && n !== focus && !near!.has(n.id);
        ctx.globalAlpha = dim ? 0.2 : 1;
        const r = radius(n);
        ctx.beginPath();
        ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, Math.PI * 2);
        if (n.exists) {
          ctx.fillStyle = n.id === activePath ? yellow : accent;
          ctx.fill();
        } else {
          ctx.fillStyle = surface;
          ctx.fill();
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1.2;
          ctx.strokeStyle = muted;
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Labels: big notes first, fading in as you zoom, never on top of each other.
      const placed: [number, number, number, number][] = [];
      const fontPx = 12 / view.k;
      ctx.font = `700 ${fontPx}px "Nunito Variable", Nunito, sans-serif`;
      ctx.textAlign = "center";
      const byImportance = [...list].sort((a, b) => Number(b === focus) - Number(a === focus) || b.degree - a.degree);
      for (const n of byImportance) {
        const isFocus = n === focus || n.id === activePath || (near?.has(n.id) ?? false);
        const fade = isFocus ? 1 : Math.min(1, Math.max(0, (view.k * (1 + n.degree / 8) - 0.9) / 0.5));
        if (fade <= 0.02 || (focus && !isFocus)) continue;
        const label = n.label.length > 32 ? n.label.slice(0, 30) + "…" : n.label;
        const tw = ctx.measureText(label).width;
        const x = n.x ?? 0;
        const y = (n.y ?? 0) + radius(n) + fontPx * 1.1;
        const box: [number, number, number, number] = [x - tw / 2 - 3 / view.k, y - fontPx, x + tw / 2 + 3 / view.k, y + fontPx * 0.3];
        if (!isFocus && placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue;
        placed.push(box);
        ctx.globalAlpha = fade;
        ctx.fillStyle = n.exists ? text : muted;
        ctx.fillText(label, x, y);
      }
      ctx.globalAlpha = 1;
    };

    const loop = () => {
      if (sim.alpha() > sim.alphaMin()) sim.tick();
      draw();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const node = nodeAt(e.clientX, e.clientY);
      if (node) {
        node.fx = node.x;
        node.fy = node.y;
      }
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
        drag.node.fx = p.x;
        drag.node.fy = p.y;
        if (sim.alpha() < 0.2) sim.alpha(0.2);
      } else {
        view = { ...view, x: drag.vx + e.clientX - drag.sx, y: drag.vy + e.clientY - drag.sy };
        canvas.style.cursor = "grabbing";
      }
    };
    const onUp = () => {
      if (!drag) return;
      if (drag.node) {
        drag.node.fx = null;
        drag.node.fy = null;
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
      sim.stop();
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
