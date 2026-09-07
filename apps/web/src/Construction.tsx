import { useState } from 'react';
import type { Catalog } from '../../../packages/domain/types';
import type { ConstructionGroup, ConstructionModel } from '../../../packages/domain/construction';
import { orderDependencies } from '../../../packages/domain/dependencies';
import { format, ItemIcon, unit } from './controls';
import mechanics from '../../../packages/game-data/p2-mechanics.json';
import { Schematic } from './Schematic';
import type { SchematicDestinations, SchematicMode } from '../../../packages/domain/schematic';

export function CopyNumber({ value, label, suffix = '' }: { value: number; label: string; suffix?: string }) {
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(value));
      setNotice({ text: 'Число скопировано', error: false });
    } catch { setNotice({ text: 'Не удалось скопировать. Выделите число и скопируйте вручную.', error: true }); }
  };
  return <span><button type="button" className="secondary-button" title={`Скопировать: ${label}`} aria-label={`Скопировать: ${label}`} onClick={() => void copy()}>{value !== 0 && Math.abs(value) < 1e-6 ? value.toExponential(3) : format(value, 6)}{suffix && ` ${suffix}`}</button>{notice && <small role={notice.error ? 'alert' : 'status'}>{notice.text}{notice.error && <input aria-label={`Число для ручного копирования: ${label}`} readOnly value={String(value)} onFocus={e => e.currentTarget.select()} />}</small>}</span>;
}

const storageKey = 'satisfactory:construction:v1';
type SavedMarks = { fingerprint: string; ids: string[] };
function readHistory(): SavedMarks[] {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return [];
  const stored: unknown = JSON.parse(raw);
  const valid = (entry: unknown): entry is SavedMarks => !!entry && typeof entry === 'object'
    && 'fingerprint' in entry && typeof entry.fingerprint === 'string'
    && 'ids' in entry && Array.isArray(entry.ids) && entry.ids.every(id => typeof id === 'string');
  // Migrate the initial one-configuration format on the next write.
  if (valid(stored)) return [stored];
  if (!stored || typeof stored !== 'object' || !('entries' in stored) || !Array.isArray(stored.entries) || !stored.entries.every(valid)) throw new Error('Invalid marks');
  return stored.entries.slice(-20);
}
function readBuilt(fingerprint: string): { ids: string[]; error: string } {
  try {
    return { ids: readHistory().find(entry => entry.fingerprint === fingerprint)?.ids ?? [], error: '' };
  } catch { return { ids: [], error: 'Не удалось загрузить отметки строительства из этого браузера.' }; }
}

export function Construction({ catalog, model, building, destinations }: { catalog: Catalog; model: ConstructionModel; building: boolean; destinations: SchematicDestinations }) {
  const [saved, setSaved] = useState(() => readBuilt(model.fingerprint));
  const [view, setView] = useState<'instruction' | SchematicMode>('instruction');
  const item = (id: string) => catalog.items.find(i => i.id === id);
  const mark = (id: string, checked: boolean) => {
    const ids = checked ? [...new Set([...saved.ids, id])] : saved.ids.filter(i => i !== id);
    let error = '';
    try {
      const entries = [...readHistory().filter(entry => entry.fingerprint !== model.fingerprint), { fingerprint: model.fingerprint, ids }].slice(-20);
      localStorage.setItem(storageKey, JSON.stringify({ entries }));
    }
    catch { error = 'Не удалось сохранить отметки. Они доступны только до закрытия этой инструкции.'; }
    setSaved({ ids, error });
  };
  const groups = orderDependencies(model.production.map(g => ({ recipeId: g.id, inputs: g.averageInputs, outputs: g.averageOutputs })));
  const renderGroup = (group: ConstructionGroup, index: string) => {
    const machine = group.kind === 'extraction' ? catalog.miners.find(b => b.id === group.buildingId) : catalog.buildings.find(b => b.id === group.buildingId);
    const name = (id: string) => item(id)?.name ?? id;
    return <details className="production-step" key={group.id} open={building || undefined}>
      <summary><span className="step-title"><span className="step-number">{index}</span><ItemIcon item={item(group.averageOutputs[0]?.itemId ?? group.averageInputs[0]?.itemId ?? '')} size={32} /><span><strong>{group.name}</strong><small>{machine?.name}</small></span></span><span>{group.count}<small>физических</small></span><span>{format(group.averagePower)}<small>МВт · средняя</small></span></summary>
      <div className="step-details">
        <div className="full-width"><p>Физических машин: <CopyNumber value={group.count} label={`${group.name}: число машин`} /> · Частота каждой: <CopyNumber value={group.clock} label={`${group.name}: частота`} suffix="%" /></p>
          <p>Уже есть: {group.existing ?? 0} · Добавить: {group.count - (group.existing ?? 0)} · Somersloops на машину: {group.somersloops ?? 0}</p><p>Активная доля времени: <CopyNumber value={group.activeDuty * 100} label={`${group.name}: активная доля времени`} suffix="%" />. Это средняя доля работы группы, а не настройка частоты.</p>
          {group.kind === 'sink' && <p className="hint">Утилизаторы в модели потребляют полную мощность; доля заполнения ленты не уменьшает MW. Поток на один утилизатор — равная доля входа группы при непрерывном питании.</p>}
          {building && <label><input type="checkbox" checked={saved.ids.includes(group.id)} onChange={e => mark(group.id, e.target.checked)} /> Построено: {group.name}</label>}
        </div>
        {([['Вход', group.activeInputs, group.averageInputs], ['Выход', group.activeOutputs, group.averageOutputs]] as const).map(([title, active, average]) => <div key={title}><h4>{title}</h4>{!active.length && <p className="hint">{group.kind === 'sink' && title === 'Выход' ? 'Предметы уничтожаются в AWESOME Sink.' : 'Нет предметных потоков.'}</p>}{active.map((flow, index) => <div key={flow.itemId}><strong>{name(flow.itemId)}</strong><p>Одна активная машина: <CopyNumber value={flow.rate} label={`${group.name}: ${title}, ${name(flow.itemId)}, одна активная машина`} suffix={unit(item(flow.itemId))} /></p><p>Вся группа в среднем: <CopyNumber value={average[index].rate} label={`${group.name}: ${title}, ${name(flow.itemId)}, группа в среднем`} suffix={unit(item(flow.itemId))} /></p></div>)}</div>)}
        <div className="full-width"><p>Мощность одной активной машины, средняя за рабочий цикл: <CopyNumber value={group.activePower} label={`${group.name}: мощность активной машины`} suffix="МВт" />.</p><p>Средняя группы: <CopyNumber value={group.averagePower} label={`${group.name}: средняя мощность`} suffix="МВт" /> · Консервативный пик группы: <CopyNumber value={group.peakPower} label={`${group.name}: пиковая мощность`} suffix="МВт" />.</p>{group.powerEstimated && <p className="hint">Мощность помечена в каталоге как оценочная.</p>}</div>
      </div>
    </details>;
  };
  return <div className={building ? 'construction-panel' : undefined}>
    {building && <div className="construction-views" role="group" aria-label="Вид строительства">{([['instruction', 'Инструкция'], ['types', 'По типам зданий'], ['machines', 'По отдельным зданиям']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={view === value} className={view === value ? 'primary-button' : 'secondary-button'} onClick={() => setView(value)}>{label}</button>)}</div>}
    {building && view !== 'instruction' ? <Schematic key={view} catalog={catalog} model={model} destinations={destinations} mode={view} /> : <>
    {building && <section className="panel"><h3>Инструкция для строительства</h3><p>Поставьте указанное физическое число машин и задайте каждой показанную частоту. Средний выпуск достигается долей времени работы на этой частоте.</p><p className="hint">Активные скорости рассчитаны для работающей машины до ограничения портов. Ограничение лент/труб может вызывать простои. Модель не гарантирует непрерывный стабильный поток, синхронизацию циклов или запуск без буферов. Потребление в режиме ожидания и пуски не учтены.</p><p className="hint">Отметки хранятся в этом браузере для последних 20 отмеченных конфигураций. При изменении плана отметки не переносятся; при возврате к сохранённой конфигурации восстанавливаются.</p>{saved.error && <p role="alert">{saved.error}</p>}</section>}
    <section className="panel production-panel"><div className="section-heading"><h3>Этапы производства</h3><span className="count-badge">{model.production.length}</span></div>
      <p className="hint">Поставщики показаны раньше потребителей. Связи определяются общими предметами; конкретное распределение между машинами не рассчитано.</p>
      <div className="production-table"><div className="production-header"><span>Рецепт / здание</span><span>Машины</span><span>МВт</span></div>{groups.map((group, index) => <div key={group.recipeIds.join('|')}>
        {group.cyclic && <div className="alert warning"><div><h4>Цикл {index + 1} · совместный контур</h4><p>Внутри этого блока нет линейного порядка строительства. Перед запуском заполните замкнутый контур, обеспечьте приоритет возвратной жидкости и постоянный отвод побочных продуктов. Не перекрывайте обратный поток свежей подачей. Начальный запас, объём буферов и длительность заполнения здесь не рассчитаны.</p>{group.internalFlows.map(flow => <p key={flow.itemId}>{item(flow.itemId)?.name ?? flow.itemId}: произведено внутри {format(flow.produced, 6)}, потреблено внутри {format(flow.consumed, 6)} {unit(item(flow.itemId))}.</p>)}<p>Это суммарные потоки участников контура, а не распределение по конкретным соединениям.</p></div></div>}
        {group.recipeIds.map((id, member) => renderGroup(model.production.find(g => g.id === id)!, group.cyclic ? `${index + 1}.${member + 1}` : String(index + 1)))}
      </div>)}</div>{!groups.length && <p className="hint">Производственные здания не используются: проверьте прямые внешние поставки продукта.</p>}
    </section>
    {!!model.extraction.length && <section className="panel production-panel"><h3>Добытчики</h3><div className="production-table">{model.extraction.map((g, i) => renderGroup(g, String(i + 1)))}</div></section>}
    {!!model.sinks.length && <section className="panel production-panel"><h3>Утилизаторы</h3><div className="production-table">{model.sinks.map((g, i) => renderGroup(g, String(i + 1)))}</div><p className="hint">Побочные продукты уничтожаются, бесконечное хранение не предполагается.</p></section>}
    {building && <section className="panel"><h3>Добавляемые здания</h3><p>Новых машин: {model.addedMaterials.totalMachines}. Существующие производственные линии исключены.</p>{model.addedMaterials.items.map(i => <div className="simple-row" key={i.itemId}><span>{item(i.itemId)?.name ?? i.itemId}</span><strong>{format(i.amount)}</strong></div>)}{!model.addedMaterials.complete && <p className="hint">Часть стоимости неизвестна. Ведомость неполная.</p>}</section>}{building && <section className="panel"><h3>Материалы зданий</h3><p>Известна стоимость {model.materials.knownMachines} из {model.materials.totalMachines} физических машин. {model.materials.complete ? 'Все показанные здания учтены.' : 'Ведомость неполная: неизвестные стоимости не приняты за ноль.'}</p>{model.materials.items.map(i => <div className="simple-row" key={i.itemId}><span>{item(i.itemId)?.name ?? i.itemId}</span><CopyNumber value={i.amount} label={`Материалы: ${item(i.itemId)?.name ?? i.itemId}`} suffix={item(i.itemId)?.fluid ? 'м³' : 'шт'} /></div>)}{model.materials.unknown.map(b => <p key={b.buildingId}>Стоимость неизвестна: {b.name} × {b.count}.</p>)}<p className="hint">Материалы всех показанных зданий, включая отмеченные построенными. Ленты, трубы, фундаменты, энергомодули и геометрия размещения в ведомость не включены.</p></section>}
    </>}
  </div>;
}

export function CatalogStatus({ catalog }: { catalog: Catalog }) {
  const sections = [
    { name: 'Рецепты и количества', pattern: /количеств|длительност|рецепт/i },
    { name: 'Мощность', pattern: /мощност|средн|крив|энерги/i },
    { name: 'Локализация', pattern: /названи|локализ|ru\.json|RU\/EN/i },
    { name: 'Группировка', pattern: /групп|категор|mCategory|MenuPriority/i },
  ];
  return <details className="panel"><summary>Статус данных по разделам</summary><p>Источник: {catalog.provenance.source}</p><p>Каталог: {catalog.version} · Commit: {catalog.provenance.commit} · Импорт: {catalog.provenance.importedAt}</p><p>Общий флаг каталога: {catalog.provenance.verified ? 'проверен' : 'полная сверка не подтверждена'}. Отдельные флаги аттестации разделов не заданы; ниже приведены сведения источника, без расширения их области проверки.</p>{sections.map(section => {
    const notes = catalog.provenance.notes.filter(note => section.pattern.test(note));
    return <section key={section.name}><h4>{section.name}</h4>{notes.length ? notes.map(note => <p key={note}>{note}</p>) : <p>Сведения о проверке этого раздела в provenance отсутствуют.</p>}</section>;
  })}<p>Материалы зданий: стоимость задана у {catalog.buildings.filter(b => 'buildCost' in b && Array.isArray(b.buildCost)).length} из {catalog.buildings.length} типов зданий и у {catalog.miners.filter(b => 'buildCost' in b && Array.isArray(b.buildCost)).length} из {catalog.miners.length} типов добытчиков. Наличие стоимости само по себе не подтверждает её сверку.</p>{catalog.version === mechanics.provenance.catalogVersion && <p>Стоимость компенсатора скважины и каждого спутника импортирована из строительных рецептов закреплённой сборки и включается в ведомость.</p>}</details>;
}
