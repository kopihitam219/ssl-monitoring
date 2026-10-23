'use client';
import { useEffect, useState } from 'react';
import { Trash2, Undo2 } from 'lucide-react';
import { api, fmtDateTime } from './ui';

/** Settings → Domain yang dihapus admin: tidak dipantau lagi, bisa dikembalikan. */
export default function DeletedDomains({ setMsg }) {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(null);
  const load = () => api('/api/domains/deleted').then((r) => setList(r.deleted)).catch(() => setList([]));
  useEffect(() => { load(); }, []);

  async function restore(d) {
    setBusy(d.id);
    try {
      await api(`/api/domains/deleted/${d.id}`, { method: 'DELETE' });
      setMsg({ ok: true, text: `${d.domain} dikembalikan dan dipantau lagi.` });
      load();
    } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(null); }
  }

  return (
    <section className="panel">
      <h2><Trash2 size={16} className="h-icon" /> Domain yang dihapus</h2>
      <p className="muted small">
        Domain yang dihapus admin tidak dipantau lagi, tapi riwayat scan-nya tetap tersimpan. Klik <b>Kembalikan</b> untuk memantaunya lagi
        (menambahkan domain yang sama secara manual atau lewat upload Excel juga mengembalikannya).
      </p>
      {list === null ? <p className="muted">Memuat…</p> : list.length === 0 ? <p className="muted">Belum ada domain yang dihapus.</p> : (
        <div className="table-wrap">
          <table className="mini-table">
            <thead><tr><th>Domain</th><th>File</th><th>Dihapus</th><th aria-label="Aksi" /></tr></thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id}>
                  <td><b>{d.domain}</b>{d.port !== 443 ? `:${d.port}` : ''}</td>
                  <td>{d.file_name || '—'}</td>
                  <td>{fmtDateTime(d.deleted_at)}</td>
                  <td><button className="btn ghost small" disabled={busy === d.id} onClick={() => restore(d)}><Undo2 size={14} /> Kembalikan</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
