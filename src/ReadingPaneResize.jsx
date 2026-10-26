import React, { useEffect, useRef, useState } from 'react';
import { paneWidth, resizedPaneWidth } from './reading-workspace-state.mjs';

export function useWorkspaceWidth() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return width;
}

export function useReadingPaneResize({ name, side = 'left', min, max, fallback }) {
  const storageKey = `paperdesk-pane-width:${name}`;
  const [width, setWidth] = useState(() => {
    try { return paneWidth(localStorage.getItem(storageKey), { min, max, fallback }); }
    catch { return fallback; }
  });
  const [dragging, setDragging] = useState(false), drag = useRef(null);
  const current = paneWidth(width, { min, max, fallback });
  const update = next => {
    const value = paneWidth(next, { min, max, fallback });
    setWidth(value);
    try { localStorage.setItem(storageKey, String(value)); } catch { /* Width is only a convenience preference. */ }
  };
  const finish = () => { drag.current = null; setDragging(false); };
  return {
    style: { width: current, '--pane-width': `${current}px` },
    separator: <div className={`pane-resizer ${side === 'left' ? 'shelf-resizer' : 'notes-resizer'}${dragging ? ' dragging' : ''}`}
      role="separator" tabIndex={0} aria-label={`调整${name === 'library' ? '文献栏' : '笔记面板'}宽度`} aria-orientation="vertical"
      aria-controls={name === 'library' ? 'library-panel' : 'notes-panel'} aria-valuemin={min} aria-valuemax={max} aria-valuenow={current}
      aria-valuetext={`${current} 像素`} title="拖动或方向键调整宽度；Home / End 到边界，双击恢复默认，Esc 取消拖动"
      onDoubleClick={() => update(fallback)}
      onKeyDown={event => {
        if (event.key === 'Escape' && drag.current) { event.preventDefault(); update(drag.current.width); finish(); return; }
        const key = side === 'right' ? ({ ArrowLeft: 'ArrowRight', ArrowRight: 'ArrowLeft' }[event.key] || event.key) : event.key;
        const next = resizedPaneWidth(current, key, { min, max });
        if (next !== null) { event.preventDefault(); update(next); }
      }}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointer: event.pointerId, x: event.clientX, width: current }; setDragging(true);
      }}
      onPointerMove={event => { if (drag.current?.pointer === event.pointerId) update(drag.current.width + (event.clientX - drag.current.x) * (side === 'right' ? -1 : 1)); }}
      onPointerUp={finish} onPointerCancel={() => { if (drag.current) update(drag.current.width); finish(); }} onLostPointerCapture={finish}/>,
  };
}
