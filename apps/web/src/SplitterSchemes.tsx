import { useEffect, useMemo, useRef, useState } from 'react';
import type { Distribution, RoutingGraph } from '../../../packages/domain/beltRouting';
import type { CatalogResponse } from './splitterCatalog.worker';
import { useT, type Messages } from './i18n';
import './splitterSchemes.css';

type Fraction = Distribution['shares'][number];
const fraction = (value: Fraction) => `${value.numerator}/${value.denominator}`;
const amount = (value: Fraction) => value.numerator / value.denominator;
const format = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 4 });
const PAGE_SIZE = 25;

function makeFilter(query: string, t: Messages): { matches: (value: Distribution) => boolean; error?: string } {
  const text = query.replace(/\s/g, '');
  if (!text) return { matches: () => true };
  if (/^\d+\/\d+$/.test(text)) {
    const [numerator, denominator] = text.split('/').map(Number);
    if (numerator > 0 && denominator > 0 && Number.isSafeInteger(numerator) && Number.isSafeInteger(denominator)) {
      return { matches: value => value.shares.some(share => BigInt(share.numerator) * BigInt(denominator) === BigInt(numerator) * BigInt(share.denominator)) };
    }
  }
  if (/^\d+(:\d+)+$/.test(text)) {
    const parts = text.split(':').map(Number).sort((a, b) => a - b);
    const total = parts.reduce((sum, part) => sum + part, 0);
    if (parts.every(part => part > 0 && Number.isSafeInteger(part)) && Number.isSafeInteger(total)) {
      return { matches: value => value.shares.length === parts.length && [...value.shares].sort((a, b) => amount(a) - amount(b)).every((share, index) => BigInt(share.numerator) * BigInt(total) === BigInt(parts[index]) * BigInt(share.denominator)) };
    }
  }
  return { matches: () => false, error: t.splitterSchemes.filterError };
}

function graphLabels(graph: RoutingGraph, t: Messages): Map<string, string> {
  const counters = { input: 0, split: 0, merge: 0, output: 0 };
  const names = t.splitterSchemes.nodeNames;
  return new Map(graph.nodes.map(node => [node.id, `${names[node.kind]} ${++counters[node.kind]}`]));
}

function DistributionGraph({ distribution, labels }: { distribution: Distribution; labels: Map<string, string> }) {
  const t = useT();
  const { graph } = distribution;
  const layers = new Map<number, RoutingGraph['nodes']>();
  for (const node of graph.nodes) {
    const layer = node.kind === 'output' ? distribution.depth + 1 : node.depth;
    layers.set(layer, [...(layers.get(layer) ?? []), node]);
  }
  const height = Math.max(150, ...[...layers.values()].map(nodes => nodes.length * 68 + 30));
  const width = (distribution.depth + 2) * 180;
  const positions = new Map(graph.nodes.map(node => {
    const layer = node.kind === 'output' ? distribution.depth + 1 : node.depth;
    const nodes = layers.get(layer)!;
    return [node.id, { x: layer * 180 + 90, y: (nodes.indexOf(node) + 0.5) * (height - 30) / nodes.length + 15 }];
  }));
  return <div className="splitter-graph-scroll" tabIndex={0} aria-label={t.splitterSchemes.scrollableScheme}><svg role="img" aria-label={t.splitterSchemes.graphLabel} viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
    <title>{t.splitterSchemes.graphTitle}</title>
    {graph.edges.map((edge, index) => {
      const from = positions.get(edge.from)!, to = positions.get(edge.to)!;
      const parallel = graph.edges.filter(other => other.from === edge.from && other.to === edge.to);
      const offset = (parallel.indexOf(edge) - (parallel.length - 1) / 2) * 12;
      return <path key={index} d={`M ${from.x + 64} ${from.y + offset} C ${from.x + 95} ${from.y + offset}, ${to.x - 95} ${to.y + offset}, ${to.x - 64} ${to.y + offset}`}><title>{labels.get(edge.from)} → {labels.get(edge.to)}: {fraction(edge)}</title></path>;
    })}
    {graph.nodes.map(node => {
      const position = positions.get(node.id)!;
      return <g key={node.id} transform={`translate(${position.x},${position.y})`} className={`splitter-node ${node.kind}`}><rect x={-64} y={-19} width={128} height={38} rx={7} /><text textAnchor="middle" dominantBaseline="central">{labels.get(node.id)}</text></g>;
    })}
  </svg></div>;
}

export function SplitterSchemes() {
  const t = useT();
  const [depth, setDepth] = useState<1 | 2 | 3 | 4>(1);
  const [catalog, setCatalog] = useState<Distribution[]>([]);
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(true);
  const [visited, setVisited] = useState(0);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [outputs, setOutputs] = useState('');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [inputRate, setInputRate] = useState('');
  const [beltRate, setBeltRate] = useState('');
  const worker = useRef<Worker | null>(null);

  useEffect(() => {
    setCatalog([]); setComplete(false); setVisited(0); setBusy(true); setError(''); setSelectedId(''); setPage(0);
    let instance: Worker;
    try {
      instance = new Worker(new URL('./splitterCatalog.worker.ts', import.meta.url), { type: 'module' });
      worker.current = instance;
      instance.onmessage = (event: MessageEvent<CatalogResponse>) => {
        if (worker.current !== instance) return;
        const batch = event.data;
        setBusy(false);
        if (batch.errorKey || batch.error) { setError(batch.errorKey ? t.splitterCatalogWorker[batch.errorKey] : batch.error!); instance.terminate(); worker.current = null; return; }
        setCatalog(previous => [...previous, ...batch.results]); setComplete(batch.complete); setVisited(batch.visited);
        if (batch.complete) { instance.terminate(); worker.current = null; }
      };
      instance.onerror = () => {
        if (worker.current !== instance) return;
        setError(t.splitterSchemes.loadFailed); setBusy(false); instance.terminate(); worker.current = null;
      };
      instance.postMessage({ maxDepth: depth });
    } catch {
      setBusy(false); setError(t.splitterSchemes.startFailed);
    }
    return () => { worker.current = null; instance?.terminate(); };
  }, [depth, t]);

  const filter = useMemo(() => makeFilter(query, t), [query, t]);
  const filtered = useMemo(() => catalog.filter(value => (!outputs || value.shares.length === Number(outputs)) && filter.matches(value)), [catalog, outputs, filter]);
  const selected = filtered.find(value => value.id === selectedId) ?? filtered[0];
  const labels = useMemo(() => selected ? graphLabels(selected.graph, t) : new Map<string, string>(), [selected, t]);
  const rate = inputRate.trim() === '' ? null : Number(inputRate.replace(',', '.'));
  const capacity = beltRate.trim() === '' ? null : Number(beltRate.replace(',', '.'));
  const validRate = rate !== null && Number.isFinite(rate) && rate >= 0;
  const validCapacity = capacity !== null && Number.isFinite(capacity) && capacity > 0;
  const overloaded = selected && validRate && validCapacity ? selected.graph.edges.filter(edge => rate * amount(edge) > capacity + 1e-9) : [];

  return <section className="splitter-schemes panel" aria-label={t.splitterSchemes.catalogLabel}>
    <h2>{t.splitterSchemes.title}</h2>
    <p className="hint">{t.splitterSchemes.intro}</p>
    <div className="splitter-filters">
      <label>{t.splitterSchemes.depth}<select value={depth} onChange={event => { const next = Number(event.target.value) as typeof depth; setDepth(next); if (Number(outputs) > 3 ** next) setOutputs(''); }}>{[1, 2, 3, 4].map(value => <option key={value} value={value}>{t.splitterSchemes.upTo(value)}</option>)}</select></label>
      <label>{t.splitterSchemes.fractionOrRatio}<input value={query} placeholder={t.splitterSchemes.fractionPlaceholder} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
      <label>{t.splitterSchemes.outputCount}<select value={outputs} onChange={event => { setOutputs(event.target.value); setPage(0); }}><option value="">{t.splitterSchemes.any}</option>{Array.from({ length: 3 ** depth }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>
    </div>
    <p role="status" aria-live="polite">{t.splitterSchemes.status(format(catalog.length), complete, format(visited))}{busy && t.splitterSchemes.generatingNext}</p>
    {!complete && <p className="hint">{t.splitterSchemes.filtersHint}</p>}
    {error && <p role="alert" className="alert warning">{error}</p>}
    {filter.error && <p role="alert" className="alert warning">{filter.error}</p>}
    {!complete && !error && <button className="secondary-button" disabled={busy} onClick={() => { if (worker.current) { setBusy(true); worker.current.postMessage({}); } }}>{t.splitterSchemes.continueSearch}</button>}
    <div className="splitter-catalog-layout">
      <div className="splitter-distributions"><h3>{t.splitterSchemes.foundByFilter(format(filtered.length))}</h3>
        {filtered.length === 0 && !busy && <p>{t.splitterSchemes.noMatches}</p>}
        {filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(value => <button key={value.id} className="splitter-distribution" aria-label={t.splitterSchemes.distributionLabel(value.shares.map(fraction).join(' + '))} aria-pressed={selected?.id === value.id} onClick={() => setSelectedId(value.id)}><strong>{value.shares.map(fraction).join(' + ')}</strong><small>{t.splitterSchemes.distributionMeta(value.shares.length, value.depth, value.splitters + value.mergers)}</small></button>)}
        {filtered.length > PAGE_SIZE && <nav className="splitter-pagination" aria-label={t.splitterSchemes.pages}><button className="secondary-button" disabled={page === 0} onClick={() => setPage(value => value - 1)}>{t.splitterSchemes.previous}</button><span>{page + 1} / {Math.ceil(filtered.length / PAGE_SIZE)}</span><button className="secondary-button" disabled={(page + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage(value => value + 1)}>{t.splitterSchemes.next}</button></nav>}
      </div>
      {selected && <article className="splitter-details"><h3>{t.splitterSchemes.verified}</h3>
        <p>{t.splitterSchemes.verifiedMeta(selected.depth, selected.splitters, selected.mergers)}</p>
        <div className="splitter-filters"><label>{t.splitterSchemes.trialInput}<input inputMode="decimal" value={inputRate} placeholder={t.splitterSchemes.notSet} onChange={event => setInputRate(event.target.value)} /></label><label>{t.splitterSchemes.beltCapacity}<input inputMode="decimal" value={beltRate} placeholder={t.splitterSchemes.notSetFeminine} onChange={event => setBeltRate(event.target.value)} /></label></div>
        {(rate !== null && !validRate || capacity !== null && !validCapacity) && <p role="alert">{t.splitterSchemes.invalidRates}</p>}
        {validRate && validCapacity && (overloaded.length ? <p role="alert" className="alert warning">{t.splitterSchemes.overloaded(overloaded.length)}</p> : <p className="green">{t.splitterSchemes.allFit}</p>)}
        <table aria-label={t.splitterSchemes.finalOutputs}><thead><tr><th>{t.splitterSchemes.outputHeader}</th><th>{t.splitterSchemes.shareHeader}</th><th>%</th>{validRate && <th>{t.splitterSchemes.itemsPerMinute}</th>}</tr></thead><tbody>{selected.graph.nodes.filter(node => node.kind === 'output').map(node => {
          const edge = selected.graph.edges.find(value => value.to === node.id)!;
          return <tr key={node.id}><td>{labels.get(node.id)}</td><td>{fraction(edge)}</td><td>{format(amount(edge) * 100)}</td>{validRate && <td>{format(rate * amount(edge))}</td>}</tr>;
        })}</tbody></table>
        <DistributionGraph distribution={selected} labels={labels} />
        <details><summary>{t.splitterSchemes.allConnections}</summary><ul aria-label={t.splitterSchemes.connectionsLabel}>{selected.graph.edges.map((edge, index) => <li key={index}>{labels.get(edge.from)} → {labels.get(edge.to)}: {fraction(edge)} ({format(amount(edge) * 100)}%){validRate && t.splitterSchemes.edgeRate(format(rate * amount(edge)))}{overloaded.includes(edge) && t.splitterSchemes.edgeOverload}</li>)}</ul></details>
        <p className="hint">{t.splitterSchemes.detailsHint}</p>
      </article>}
    </div>
  </section>;
}
