import { useEffect, useId, useRef, useState } from 'react';
import { Box, ChevronDown, Search, X } from 'lucide-react';
import type { Item } from '../../../packages/domain/types';

export const normalize = (value: string) => value.toLocaleLowerCase('ru').replaceAll('ё', 'е');
export const format = (value: number, digits = 2) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value);
export const unit = (item?: Item) => item?.fluid ? 'м³/мин' : 'шт/мин';
export function ItemIcon({ item, size = 32 }: { item?: { icon?: string; name: string }; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item?.icon]);
  return <span className="item-icon" style={{ width: size, height: size }}>{item?.icon && !failed ? <img src={item.icon} alt="" onError={() => setFailed(true)} /> : <Box size={size * .6} />}</span>;
}
export function NumberField({ value, onChange, label, min = 0, max, step = 'any', disabled, suffix }: { value: number; onChange: (v: number) => void; label: string; min?: number; max?: number; step?: number | 'any'; disabled?: boolean; suffix?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const valid = (v: number) => Number.isFinite(v) && v >= min && (max === undefined || v <= max);
  return <span className="number-field"><span className="sr-only">{label}</span><input type="text" inputMode="decimal" aria-label={label} disabled={disabled} value={text} onChange={e => { const raw = e.target.value; setText(raw); const n = Number(raw.replace(',', '.')); if (raw.trim() && valid(n) && (step === 'any' || n % step === 0)) onChange(n); }} onBlur={() => setText(String(value))} />{suffix && <span>{suffix}</span>}</span>;
}
export function ItemSelect({ items, value, onChange, label }: { items: Item[]; value: string; onChange: (id: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const id = useId(); const trigger = useRef<HTMLButtonElement>(null); const close = () => { setOpen(false); trigger.current?.focus(); };
  const selected = items.find(item => item.id === value);
  const matches = items.filter(item => normalize(`${item.name} ${item.nameEn}`).includes(normalize(query)));
  return <div className="item-select" onKeyDown={e => { if (e.key === 'Escape') close(); }}>
    <button ref={trigger} className="item-select-trigger" type="button" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => { setOpen(!open); setQuery(''); }}><ItemIcon item={selected} /><span>{selected?.name ?? 'Выберите предмет'}</span><ChevronDown size={15} /></button>
    {open && <><button className="select-backdrop" aria-label="Закрыть выбор предмета" onClick={() => setOpen(false)} /><div className="select-popover" id={id}><div className="search-field"><Search size={16} /><input autoFocus aria-label={`Поиск: ${label}`} placeholder="Название на русском или английском" value={query} onChange={e => setQuery(e.target.value)} /><button aria-label="Закрыть" onClick={() => setOpen(false)}><X size={15} /></button></div><div className="select-options">{matches.map(item => <button key={item.id} type="button" className={item.id === value ? 'selected' : ''} onClick={() => { onChange(item.id); close(); }}><ItemIcon item={item} size={26} /><span>{item.name}<small>{item.category}</small></span></button>)}{!matches.length && <p className="muted">Предметы не найдены</p>}</div></div></>}
  </div>;
}
