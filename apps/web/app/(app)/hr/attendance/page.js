'use client';

// Phase 42 Track 2: Staff Attendance — monthly grid (employee rows x day columns)
// + summary cards + "Check in / Check out" self button.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, Spinner, EmptyState, ErrorBanner, Field, Modal } from '../../../../components/ui';

const STATUS_META = {
  present: { label: 'P', color: '#22c55e', title: 'Present' },
  late: { label: 'L', color: '#f59e0b', title: 'Late' },
  absent: { label: 'A', color: '#ef4444', title: 'Absent' },
  half_day: { label: 'H', color: '#3b82f6', title: 'Half day' },
  on_leave: { label: 'O', color: '#8b5cf6', title: 'On leave' },
};

function monthDays(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const days = [];
  const d = new Date(Date.UTC(y, m - 1, 1));
  while (d.getUTCMonth() === m - 1) {
    days.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

export default function StaffAttendancePage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [summary, setSummary] = useState(null);
  const [grid, setGrid] = useState([]); // raw attendance rows for the month
  const [myRec, setMyRec] = useState(null); // my today's record
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [correcting, setCorrecting] = useState(null); // record for manual correction modal
  const [cform, setCform] = useState({ status: '', note: '' });

  const days = useMemo(() => monthDays(month), [month]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [s, a] = await Promise.all([
        api.get(`/staff-attendance/summary?month=${month}`),
        api.get(`/staff-attendance?from=${month}-01&to=${month}-31`),
      ]);
      setSummary(s.data);
      setGrid(a.data.attendance || []);
    } catch (e) {
      setError(e?.response?.data?.error || 'load_failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [month]);

  // My today's record — for the check in/out button state.
  async function loadMine() {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const r = await api.get(`/staff-attendance?date=${today}`);
      const rows = r.data.attendance || [];
      setMyRec(rows.length ? rows[0] : null);
    } catch { /* 404/403 — button still usable */ }
  }
  useEffect(() => { loadMine(); }, []);

  const byEmpDate = useMemo(() => {
    const m = new Map();
    for (const r of grid) m.set(`${r.employeeId}|${r.date.slice(0, 10)}`, r);
    return m;
  }, [grid]);

  async function checkInOut(action) {
    setBusy(true);
    try {
      const r = await api.post(`/staff-attendance/${action}`);
      setMyRec(r.data.attendance);
      load();
    } catch (e) {
      setError(e?.response?.data?.error || `${action}_failed`);
    } finally {
      setBusy(false);
    }
  }

  async function saveCorrection() {
    try {
      await api.patch(`/staff-attendance/${correcting.id}`, {
        status: cform.status || undefined,
        note: cform.note || null,
      });
      setCorrecting(null);
      load();
    } catch (e) {
      setError(e?.response?.data?.error || 'update_failed');
    }
  }

  const totals = useMemo(() => {
    const t = { present: 0, late: 0, absent: 0, half_day: 0, on_leave: 0 };
    for (const s of (summary?.summary || [])) {
      t.present += s.present; t.late += s.late; t.absent += s.absent;
      t.half_day += s.half_day; t.on_leave += s.on_leave;
    }
    return t;
  }, [summary]);

  const myStatus = myRec ? (myRec.checkOut ? 'Checked out' : myRec.checkIn ? 'Checked in' : 'Not checked in') : 'Not checked in';
  const canCheckIn = !myRec?.checkIn;
  const canCheckOut = myRec?.checkIn && !myRec?.checkOut;

  return (
    <div>
      <PageHeader
        title="Staff Attendance"
        subtitle="Monthly attendance grid, late tracking & self check-in"
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Field label="Month" style={{ margin: 0 }}>
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </Field>
            <button
              className="btn btn-primary"
              disabled={busy || !canCheckIn}
              onClick={() => checkInOut('checkin')}
            >
              {busy ? '…' : '✅ Check in'}
            </button>
            <button
              className="btn"
              disabled={busy || !canCheckOut}
              onClick={() => checkInOut('checkout')}
            >
              {busy ? '…' : '🏁 Check out'}
            </button>
          </div>
        }
      />

      {error && <ErrorBanner message={error} onClose={() => setError('')} />}

      <div style={{ marginBottom: 8, color: 'var(--muted)' }}>
        My status today: <strong>{myStatus}</strong>
      </div>

      {loading ? <Spinner /> : !summary ? (
        <EmptyState title="No data" />
      ) : (
        <>
          <div className="stat-grid" style={{ marginBottom: 16 }}>
            <StatCard label="Employees" value={summary.summary.length} icon="👥" />
            <StatCard label="Present" value={totals.present} icon="✅" tone="green" />
            <StatCard label="Late" value={totals.late} icon="⏰" tone="amber" />
            <StatCard label="Absent" value={totals.absent} icon="❌" tone="red" />
            <StatCard label="Half days" value={totals.half_day} icon="🌓" tone="blue" />
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            {Object.entries(STATUS_META).map(([k, v]) => (
              <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <span style={{
                  display: 'inline-block', width: 22, height: 22, borderRadius: 6,
                  background: v.color + '22', color: v.color, border: `1px solid ${v.color}55`,
                  textAlign: 'center', lineHeight: '20px', fontWeight: 700,
                }}>{v.label}</span>
                {v.title}
              </span>
            ))}
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>· weekends greyed · click a cell to correct</span>
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '100%', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ position: 'sticky', left: 0, background: 'var(--card)', textAlign: 'left', padding: '8px 12px', minWidth: 160, zIndex: 1 }}>Employee</th>
                  {days.map((d) => {
                    const dow = d.getUTCDay();
                    const weekend = dow === 0 || dow === 6;
                    return (
                      <th key={d.toISOString()} style={{
                        padding: '6px 2px', minWidth: 30,
                        background: weekend ? 'var(--hover)' : 'transparent',
                        color: weekend ? 'var(--muted)' : 'inherit',
                      }}>{d.getUTCDate()}</th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {summary.summary.map((s) => (
                  <tr key={s.employeeId} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ position: 'sticky', left: 0, background: 'var(--card)', padding: '6px 12px', zIndex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{s.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.department || ''}</div>
                    </td>
                    {days.map((d) => {
                      const dow = d.getUTCDay();
                      const weekend = dow === 0 || dow === 6;
                      const key = `${s.employeeId}|${d.toISOString().slice(0, 10)}`;
                      const rec = byEmpDate.get(key);
                      const meta = rec ? STATUS_META[rec.status] : null;
                      return (
                        <td key={key} style={{ padding: 2, textAlign: 'center' }}>
                          <button
                            title={rec ? `${meta?.title} — click to correct${rec.lateMinutes ? ` (${rec.lateMinutes}m late)` : ''}` : weekend ? 'Weekend' : 'No record'}
                            onClick={() => rec && (setCorrecting(rec), setCform({ status: rec.status, note: rec.note || '' }))}
                            disabled={!rec}
                            style={{
                              width: 26, height: 26, borderRadius: 6, border: '1px solid var(--border)',
                              background: meta ? meta.color + '22' : weekend ? 'var(--hover)' : 'transparent',
                              color: meta ? meta.color : 'var(--muted)',
                              fontWeight: 700, cursor: rec ? 'pointer' : 'default',
                            }}
                          >
                            {meta ? meta.label : '·'}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 style={{ margin: '20px 0 10px' }}>Monthly summary</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ minWidth: 640 }}>
              <thead>
                <tr><th>Employee</th><th>Present</th><th>Late</th><th>Absent</th><th>Half day</th><th>On leave</th><th>Late mins</th></tr>
              </thead>
              <tbody>
                {summary.summary.map((s) => (
                  <tr key={s.employeeId}>
                    <td><strong>{s.name}</strong><div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.department || ''}</div></td>
                    <td style={{ color: '#22c55e' }}>{s.present}</td>
                    <td style={{ color: '#f59e0b' }}>{s.late}</td>
                    <td style={{ color: '#ef4444' }}>{s.absent}</td>
                    <td style={{ color: '#3b82f6' }}>{s.half_day}</td>
                    <td style={{ color: '#8b5cf6' }}>{s.on_leave}</td>
                    <td>{s.totalLateMinutes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {correcting && (
        <Modal title={`Correct — ${correcting.employee?.name || ''} (${correcting.date.slice(0, 10)})`} onClose={() => setCorrecting(null)}>
          <Field label="Status">
            <select value={cform.status} onChange={(e) => setCform({ ...cform, status: e.target.value })}>
              {Object.keys(STATUS_META).map((s) => (
                <option key={s} value={s}>{STATUS_META[s].title}</option>
              ))}
            </select>
          </Field>
          <Field label="Note">
            <input value={cform.note} onChange={(e) => setCform({ ...cform, note: e.target.value })} placeholder="Correction reason…" />
          </Field>
          <button className="btn btn-primary" onClick={saveCorrection}>Save correction</button>
        </Modal>
      )}
    </div>
  );
}
