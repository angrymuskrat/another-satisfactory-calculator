import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent, type RefObject } from 'react';

const MIN_ZOOM = .25, MAX_ZOOM = 1.5;

/** Mouse navigation only; touch scrolling and keyboard navigation stay native. */
export function useSchematicNavigation(viewport: RefObject<HTMLDivElement | null>) {
  const [zoom, setZoom] = useState(.75), [dragging, setDragging] = useState(false);
  const requestedZoom = useRef(zoom), renderedZoom = useRef(zoom);
  const anchor = useRef<{ x: number; y: number; contentX: number; contentY: number } | null>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const zoomTo = useCallback((value: number, clientX?: number, clientY?: number) => {
    const element = viewport.current;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
    if (!element || next === requestedZoom.current) return;
    const rect = element.getBoundingClientRect();
    const x = clientX === undefined ? element.clientWidth / 2 : clientX - rect.left - element.clientLeft;
    const y = clientY === undefined ? element.clientHeight / 2 : clientY - rect.top - element.clientTop;
    anchor.current = { x, y, contentX: (element.scrollLeft + x) / renderedZoom.current, contentY: (element.scrollTop + y) / renderedZoom.current };
    requestedZoom.current = next;
    setZoom(next);
  }, [viewport]);
  useLayoutEffect(() => {
    renderedZoom.current = zoom;
    const element = viewport.current, point = anchor.current;
    if (element && point) {
      element.scrollLeft = point.contentX * zoom - point.x;
      element.scrollTop = point.contentY * zoom - point.y;
      anchor.current = null;
      // Finish an in-flight drag before switching to a wheel gesture.
      const gesture = drag.current;
      if (gesture) {
        suppressClick.current ||= gesture.moved;
        drag.current = null;
        if (element.hasPointerCapture(gesture.pointerId)) element.releasePointerCapture(gesture.pointerId);
      }
      setDragging(false);
    }
  }, [zoom, viewport]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      const delta = Math.max(-240, Math.min(240, event.deltaY * unit));
      zoomTo(requestedZoom.current * Math.exp(-delta * .0015), event.clientX, event.clientY);
    };
    const cancel = () => {
      const pointerId = drag.current?.pointerId;
      drag.current = null; suppressClick.current = false; setDragging(false);
      if (pointerId !== undefined && element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('blur', cancel);
    return () => { element.removeEventListener('wheel', wheel); window.removeEventListener('blur', cancel); };
  }, [viewport, zoomTo]);
  const finish = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const gesture = drag.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    suppressClick.current = !cancelled && gesture.moved;
    drag.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return { zoom, zoomTo, dragging, bindings: {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== 'mouse' || ![0, 1].includes(event.button)) return;
      const element = event.currentTarget, rect = element.getBoundingClientRect();
      if (event.clientX - rect.left >= element.clientWidth + element.clientLeft || event.clientY - rect.top >= element.clientHeight + element.clientTop) return;
      if (event.button === 1) event.preventDefault();
      suppressClick.current = false;
      drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop, moved: false };
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const gesture = drag.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      if ((event.buttons & 5) === 0) { finish(event, true); return; }
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
      if (!gesture.moved && Math.hypot(dx, dy) < 4) return;
      if (!gesture.moved) {
        gesture.moved = true; setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus({ preventScroll: true });
      }
      event.preventDefault();
      event.currentTarget.scrollLeft = gesture.left - dx;
      event.currentTarget.scrollTop = gesture.top - dy;
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => finish(event),
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => finish(event, true),
    onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => finish(event, true),
    onClickCapture: (event: MouseEvent<HTMLDivElement>) => {
      if (suppressClick.current && event.detail > 0) { event.preventDefault(); event.stopPropagation(); }
      suppressClick.current = false;
    },
    onDragStart: (event: DragEvent<HTMLDivElement>) => event.preventDefault(),
  } };
}
