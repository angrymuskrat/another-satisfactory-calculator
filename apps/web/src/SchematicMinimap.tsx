import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import type { SchematicLayout } from './schematicLayout';

const WIDTH = 180, HEIGHT = 120;
type Scroll = { scrollLeft: number; scrollTop: number };

/** Mouse overview of the current level; the canvas keeps keyboard and wheel control. */
export function SchematicMinimap({ layout, viewport, zoom, onMove }: {
  layout: SchematicLayout; viewport: RefObject<HTMLDivElement | null>; zoom: number; onMove: (scroll: Scroll) => void;
}) {
  const [view, setView] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const map = useRef<SVGSVGElement>(null), pointer = useRef<number | null>(null);
  useEffect(() => {
    const element = viewport.current, svg = map.current;
    if (!element || !svg) return;
    let frame = 0;
    const read = () => { frame = 0; setView({ left: element.scrollLeft, top: element.scrollTop, width: element.clientWidth, height: element.clientHeight }); };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(read); };
    // Wheel over the map zooms the canvas around the same screen point.
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      element.dispatchEvent(new WheelEvent('wheel', { deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, clientX: event.clientX, clientY: event.clientY, cancelable: true }));
    };
    read();
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    element.addEventListener('scroll', schedule, { passive: true });
    svg.addEventListener('wheel', wheel, { passive: false });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); element.removeEventListener('scroll', schedule); svg.removeEventListener('wheel', wheel); };
  }, [viewport]);
  const scale = Math.min(WIDTH / Math.max(1, layout.width), HEIGHT / Math.max(1, layout.height));
  const width = layout.width * scale, height = layout.height * scale;
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(width, event.clientX - box.left)) / scale, y = Math.max(0, Math.min(height, event.clientY - box.top)) / scale;
    onMove({ scrollLeft: Math.max(0, x * zoom - view.width / 2), scrollTop: Math.max(0, y * zoom - view.height / 2) });
  };
  const frame = { x: view.left / zoom * scale, y: view.top / zoom * scale, width: view.width / zoom * scale, height: view.height / zoom * scale };
  return <div className="schematic-minimap" aria-hidden="true">
    <svg ref={map} width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      onPointerDown={event => { if (event.button !== 0) return; pointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); move(event); }}
      onPointerMove={event => { if (pointer.current === event.pointerId) move(event); }}
      onPointerUp={event => { if (pointer.current === event.pointerId) pointer.current = null; }}
      onPointerCancel={() => { pointer.current = null; }}>
      {Object.entries(layout.rects).map(([id, r]) => <rect key={id} x={r.x * scale} y={r.y * scale} width={Math.max(1, r.width * scale)} height={Math.max(1, r.height * scale)} />)}
      <rect className="schematic-minimap-frame" x={frame.x} y={frame.y} width={Math.max(0, Math.min(frame.width, width - frame.x))} height={Math.max(0, Math.min(frame.height, height - frame.y))} />
    </svg>
  </div>;
}
