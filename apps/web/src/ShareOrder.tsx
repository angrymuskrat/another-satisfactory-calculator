import { useEffect, useId, useRef, useState } from 'react';
import { Share2 } from 'lucide-react';
import type { Plan } from '../../../packages/domain/types';
import { createOrderLink } from './orderLink';
import './shareOrder.css';

export function ShareOrder({ plan }: { plan: Plan }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="secondary-button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <Share2 size={16} aria-hidden="true" />Поделиться заказом
    </button>
    {open && <ShareDialog plan={plan} onClose={() => setOpen(false)} />}
  </>;
}

function ShareDialog({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    let active = true;
    setUrl('');
    setError('');
    setNotice('');
    createOrderLink(plan, window.location.href).then(link => {
      if (active) setUrl(link);
    }, cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Не удалось создать ссылку на заказ.');
    });
    return () => { active = false; };
  }, [plan]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Ссылка скопирована.');
    } catch {
      input.current?.focus();
      input.current?.select();
      setNotice('Скопируйте выделенную ссылку вручную.');
    }
  }

  return <dialog ref={dialog} className="panel share-order-dialog" aria-labelledby={titleId} onClose={onClose}>
    <h2 id={titleId}>Поделиться заказом</h2>
    <p>По ссылке откроется снимок заказа с текущими рецептами и ограничениями.</p>
    {error ? <p className="form-error" role="alert">{error}</p> : url ? <>
      <label>Ссылка на заказ
        <input ref={input} readOnly value={url} onFocus={event => event.currentTarget.select()} />
      </label>
      {notice && <p role="status">{notice}</p>}
    </> : <p role="status">Подготовка ссылки…</p>}
    <div className="share-order-actions">
      <button type="button" className="secondary-button" onClick={() => dialog.current?.close()}>Закрыть</button>
      {url && <button type="button" className="primary-button" onClick={() => void copy()}>Скопировать ссылку</button>}
    </div>
  </dialog>;
}
