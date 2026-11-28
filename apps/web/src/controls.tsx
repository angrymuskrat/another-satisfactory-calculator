import { useEffect, useId, useRef, useState } from 'react';
import { Box, ChevronDown, Search, X } from 'lucide-react';
import type { Item } from '../../../packages/domain/types';
import { activeLocale, messages, useT } from './i18n';
import { gameName, searchNames } from './i18n/gameNames';

export const normalize = (value: string) => value.toLocaleLowerCase(activeLocale().tag).replaceAll('ё', 'е');
export const matchesItem = (item: Item, query: string) => normalize(`${item.name} ${item.nameEn} ${searchNames('item', item.id, item.name)}`).includes(normalize(query));
export const format = (value: number, digits = 2) => new Intl.NumberFormat(activeLocale().tag, { maximumFractionDigits: digits }).format(value);
export const unit = (item?: Item) => item?.fluid ? messages().controls.unitFluid : messages().controls.unitSolid;
export function downloadJson(raw: string, name: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
export function ItemIcon({ item, size = 32 }: { item?: { icon?: string; name: string }; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item?.icon]);
  return <span className="item-icon" style={{ width: size, height: size }}>{item?.icon && !failed ? <img src={item.icon} alt="" onError={() => setFailed(true)} /> : <Box size={size * .6} />}</span>;
}
export function NumberField({ value, onChange, label, min = 0, max, step = 'any', disabled, unlimited, suffix }: { value: number; onChange: (v: number) => void; label: string; min?: number; max?: number; step?: number | 'any'; disabled?: boolean; /** Поле без лимита: значение скрыто, чтобы не выглядеть действующим. */ unlimited?: boolean; suffix?: string }) {
  const t = useT();
  const [text, setText] = useState(String(value));
  const [notice, setNotice] = useState('');
  const id = useId();
  useEffect(() => { setText(String(value)); setNotice(''); }, [value]);
  const valid = (raw: string) => {
    const n = Number(raw.replace(',', '.'));
    return !!raw.trim() && Number.isFinite(n) && n >= min && (max === undefined || n <= max) && (step === 'any' || n % step === 0);
  };
  const invalid = !disabled && !unlimited && !valid(text);
  const constraint = t.controls.numberConstraint({ integer: step === 1, min: format(min, 6), max: max === undefined ? undefined : format(max, 6), suffix });
  return <span className="number-control"><span className="number-field"><input type="text" inputMode="decimal" aria-label={label} aria-invalid={invalid} aria-describedby={`${id}-hint${invalid || notice ? ` ${id}-notice` : ''}`} disabled={disabled || unlimited} value={unlimited ? '' : text} placeholder={unlimited ? t.controls.unlimitedPlaceholder : undefined} onChange={e => { const raw = e.target.value; setText(raw); setNotice(''); if (valid(raw)) onChange(Number(raw.replace(',', '.'))); }} onBlur={() => { if (invalid) setNotice(t.controls.numberRestored(format(value, 6), suffix)); setText(String(value)); }} />{suffix && <span>{suffix}</span>}</span><span className="sr-only" id={`${id}-hint`}>{constraint}</span><span className="number-notice" id={`${id}-notice`} role="status">{invalid ? constraint : notice}</span></span>;
}
export function ItemSelect({ items, value, onChange, label }: { items: Item[]; value: string; onChange: (id: string) => void; label: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const id = useId(); const trigger = useRef<HTMLButtonElement>(null); const search = useRef<HTMLInputElement>(null); const options = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const selected = items.find(item => item.id === value);
  const matches = items.filter(item => matchesItem(item, query));
  return <div className="item-select" onBlur={e => { if (open && !e.currentTarget.contains(e.relatedTarget)) setOpen(false); }} onKeyDown={e => { if (open && e.key === 'Escape') { e.stopPropagation(); close(); } }}>
    <button ref={trigger} className="item-select-trigger" type="button" aria-label={label} aria-describedby={`${id}-value`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => { setOpen(!open); setQuery(''); }}><ItemIcon item={selected} /><span id={`${id}-value`}>{selected ? gameName('item', selected.id, selected.name) : t.controls.selectItem}</span><ChevronDown size={15} /></button>
    {open && <><button className="select-backdrop" tabIndex={-1} aria-label={t.controls.closeItemSelect} onClick={close} /><div className="select-popover" role="dialog" aria-label={t.controls.selectDialog(label)} id={id}><div className="search-field"><Search size={16} /><input ref={search} autoFocus aria-label={t.controls.searchLabel(label)} placeholder={t.controls.searchPlaceholder} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); options.current?.querySelector('button')?.focus(); } }} /><button type="button" aria-label={t.controls.close} onClick={close}><X size={15} /></button></div><p className={matches.length ? 'sr-only' : 'muted'} role="status">{matches.length ? t.controls.itemsFound(matches.length) : t.controls.noItemsFound}</p><div className="select-options" ref={options} onKeyDown={e => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const buttons = [...e.currentTarget.querySelectorAll('button')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowUp' && index <= 0) search.current?.focus();
      else buttons[Math.min(buttons.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1))]?.focus();
    }}>{matches.map(item => <button key={item.id} type="button" aria-pressed={item.id === value} className={item.id === value ? 'selected' : ''} onClick={() => { onChange(item.id); close(); }}><ItemIcon item={item} size={26} /><span>{gameName('item', item.id, item.name)}<small>{gameName('category', item.category, item.category)}</small></span></button>)}</div></div></>}
  </div>;
}
