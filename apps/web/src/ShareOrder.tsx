import { useEffect, useId, useRef, useState } from 'react';
import { Share2 } from 'lucide-react';
import type { Plan } from '../../../packages/domain/types';
import { useT } from './i18n';
import { createOrderLink } from './orderLink';
import './shareOrder.css';

export function ShareOrder({ plan }: { plan: Plan }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="secondary-button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <Share2 size={16} aria-hidden="true" />{t.shareOrder.share}
    </button>
    {open && <ShareDialog plan={plan} onClose={() => setOpen(false)} />}
  </>;
}

function ShareDialog({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const t = useT();
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
    createOrderLink(plan, window.location.href, t).then(link => {
      if (active) setUrl(link);
    }, cause => {
      if (active) setError(cause instanceof Error ? cause.message : t.shareOrder.createFailed);
    });
    return () => { active = false; };
  }, [plan, t]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setNotice(t.shareOrder.copied);
    } catch {
      input.current?.focus();
      input.current?.select();
      setNotice(t.shareOrder.copyManually);
    }
  }

  return <dialog ref={dialog} className="panel share-order-dialog" aria-labelledby={titleId} onClose={onClose}>
    <h2 id={titleId}>{t.shareOrder.share}</h2>
    <p>{t.shareOrder.intro}</p>
    {error ? <p className="form-error" role="alert">{error}</p> : url ? <>
      <label>{t.shareOrder.linkLabel}
        <input ref={input} readOnly value={url} onFocus={event => event.currentTarget.select()} />
      </label>
      {notice && <p role="status">{notice}</p>}
    </> : <p role="status">{t.shareOrder.preparing}</p>}
    <div className="share-order-actions">
      <button type="button" className="secondary-button" onClick={() => dialog.current?.close()}>{t.shareOrder.close}</button>
      {url && <button type="button" className="primary-button" onClick={() => void copy()}>{t.shareOrder.copy}</button>}
    </div>
  </dialog>;
}
