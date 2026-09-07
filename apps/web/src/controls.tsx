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
  const [notice, setNotice] = useState('');
  const id = useId();
  useEffect(() => { setText(String(value)); setNotice(''); }, [value]);
  const valid = (raw: string) => {
    const n = Number(raw.replace(',', '.'));
    return !!raw.trim() && Number.isFinite(n) && n >= min && (max === undefined || n <= max) && (step === 'any' || n % step === 0);
  };
  const invalid = !disabled && !valid(text);
  const constraint = `Введите ${step === 1 ? 'целое ' : ''}число ${max === undefined ? `не меньше ${format(min, 6)}` : `от ${format(min, 6)} до ${format(max, 6)}`}${suffix ? ` ${suffix}` : ''}.`;
  return <span className="number-control"><span className="number-field"><input type="text" inputMode="decimal" aria-label={label} aria-invalid={invalid} aria-describedby={`${id}-hint${invalid || notice ? ` ${id}-notice` : ''}`} disabled={disabled} value={text} onChange={e => { const raw = e.target.value; setText(raw); setNotice(''); if (valid(raw)) onChange(Number(raw.replace(',', '.'))); }} onBlur={() => { if (invalid) setNotice(`Значение не изменено. Восстановлено: ${format(value, 6)}${suffix ? ` ${suffix}` : ''}.`); setText(String(value)); }} />{suffix && <span>{suffix}</span>}</span><span className="sr-only" id={`${id}-hint`}>{constraint}</span><span className="number-notice" id={`${id}-notice`} role="status">{invalid ? constraint : notice}</span></span>;
}
export function ItemSelect({ items, value, onChange, label }: { items: Item[]; value: string; onChange: (id: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const id = useId(); const trigger = useRef<HTMLButtonElement>(null); const search = useRef<HTMLInputElement>(null); const options = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const selected = items.find(item => item.id === value);
  const matches = items.filter(item => normalize(`${item.name} ${item.nameEn}`).includes(normalize(query)));
  return <div className="item-select" onBlur={e => { if (open && !e.currentTarget.contains(e.relatedTarget)) setOpen(false); }} onKeyDown={e => { if (open && e.key === 'Escape') { e.stopPropagation(); close(); } }}>
    <button ref={trigger} className="item-select-trigger" type="button" aria-label={label} aria-describedby={`${id}-value`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => { setOpen(!open); setQuery(''); }}><ItemIcon item={selected} /><span id={`${id}-value`}>{selected?.name ?? 'Выберите предмет'}</span><ChevronDown size={15} /></button>
    {open && <><button className="select-backdrop" tabIndex={-1} aria-label="Закрыть выбор предмета" onClick={close} /><div className="select-popover" role="dialog" aria-label={`Выбор: ${label}`} id={id}><div className="search-field"><Search size={16} /><input ref={search} autoFocus aria-label={`Поиск: ${label}`} placeholder="Название на русском или английском" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); options.current?.querySelector('button')?.focus(); } }} /><button type="button" aria-label="Закрыть" onClick={close}><X size={15} /></button></div><p className={matches.length ? 'sr-only' : 'muted'} role="status">{matches.length ? `Найдено предметов: ${matches.length}` : 'Предметы не найдены'}</p><div className="select-options" ref={options} onKeyDown={e => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const buttons = [...e.currentTarget.querySelectorAll('button')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowUp' && index <= 0) search.current?.focus();
      else buttons[Math.min(buttons.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1))]?.focus();
    }}>{matches.map(item => <button key={item.id} type="button" aria-pressed={item.id === value} className={item.id === value ? 'selected' : ''} onClick={() => { onChange(item.id); close(); }}><ItemIcon item={item} size={26} /><span>{item.name}<small>{item.category}</small></span></button>)}</div></div></>}
  </div>;
}
