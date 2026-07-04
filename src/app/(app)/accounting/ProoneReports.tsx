'use client'
import { useState, useEffect } from 'react'

const API_URL = process.env.NEXT_PUBLIC_PROONE_API_URL ?? 'https://prooneaccounting.vercel.app/api/v1'
const API_KEY = process.env.NEXT_PUBLIC_PROONE_API_KEY ?? ''

function fmtRp(n: number) {
  return 'Rp ' + Math.round(n).toLocaleString('id-ID')
}

const MONTHS = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des']

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="stat-card" style={{ background: 'rgba(10,22,40,0.6)', border: '1px solid rgba(201,162,39,.18)', borderRadius: 14, padding: '16px 18px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color ?? '#fff', letterSpacing: '-0.5px' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

export default function ProoneReports() {
  const now = new Date()
  const [year, setYear]   = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [pl, setPl]       = useState<any>(null)
  const [bs, setBs]       = useState<any>(null)
  const [cf, setCf]       = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!API_KEY) { setError('NEXT_PUBLIC_PROONE_API_KEY belum diset'); setLoading(false); return }
    setLoading(true); setError('')
    const headers = { Authorization: `Bearer ${API_KEY}` }
    const params  = `?year=${year}&month=${month}`
    Promise.all([
      fetch(`${API_URL}/reports/pl${params}`, { headers }).then(r => r.json()),
      fetch(`${API_URL}/reports/balance-sheet${params}`, { headers }).then(r => r.json()),
      fetch(`${API_URL}/reports/cash-flow${params}`, { headers }).then(r => r.json()),
    ]).then(([plData, bsData, cfData]) => {
      setPl(plData.success  ? plData.data  : null)
      setBs(bsData.success  ? bsData.data  : null)
      setCf(cfData.success  ? cfData.data  : null)
      if (!plData.success) setError(plData.error ?? 'Gagal memuat laporan')
    }).catch(() => setError('Tidak dapat terhubung ke Proone Accounting'))
      .finally(() => setLoading(false))
  }, [year, month])

  return (
    <div className="panel">
      {/* Header + month picker */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, color: '#fff', fontWeight: 800 }}>📒 Laporan Keuangan</h2>
          <div className="hint">Data dari Proone Accounting — {MONTHS[month-1]} {year}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            value={month}
            onChange={e => setMonth(Number(e.target.value))}
            style={{ background: 'rgba(10,22,40,.8)', border: '1px solid rgba(201,162,39,.3)', color: 'var(--text)', borderRadius: 9, padding: '6px 10px', fontSize: 13 }}
          >
            {MONTHS.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
          </select>
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            style={{ background: 'rgba(10,22,40,.8)', border: '1px solid rgba(201,162,39,.3)', color: 'var(--text)', borderRadius: 9, padding: '6px 10px', fontSize: 13 }}
          >
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 10, padding: '10px 14px', color: '#ff9a9a', fontSize: 13, marginBottom: 16 }}>
          ⚠ {error}
        </div>
      )}

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 12 }}>
          {[1,2,3,4,5,6].map(i => (
            <div key={i} style={{ background: 'rgba(201,162,39,.05)', borderRadius: 14, height: 80, animation: 'pulse 1.5s ease-in-out infinite' }} />
          ))}
        </div>
      ) : pl ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* P&L */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--gold)', marginBottom: 10 }}>Laba Rugi</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))', gap: 10 }}>
              <StatCard label="Pendapatan" value={fmtRp(pl.revenue?.total ?? 0)} sub={`${pl.revenue?.invoiceCount ?? 0} invoice lunas`} color="#4ade80" />
              <StatCard label="Pengeluaran" value={fmtRp(pl.expenses?.total ?? 0)} color="#f87171" />
              <StatCard label="Laba Kotor"  value={fmtRp(pl.summary?.grossProfit ?? 0)} color={(pl.summary?.grossProfit ?? 0) >= 0 ? '#4ade80' : '#f87171'} />
              <StatCard label="Laba Bersih" value={fmtRp(pl.summary?.netProfit ?? 0)} color={(pl.summary?.netProfit ?? 0) >= 0 ? '#c9a227' : '#f87171'} sub={`PPN terhutang: ${fmtRp(pl.summary?.ppnDue ?? 0)}`} />
            </div>

            {/* Expense breakdown */}
            {pl.expenses?.byCategory && Object.keys(pl.expenses.byCategory).length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, fontWeight: 600 }}>Rincian Pengeluaran</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {Object.entries(pl.expenses.byCategory as Record<string, number>).map(([cat, amt]) => (
                    <div key={cat} style={{ background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.2)', borderRadius: 8, padding: '5px 10px', fontSize: 12 }}>
                      <span style={{ color: 'var(--muted)' }}>{cat}:</span>{' '}
                      <span style={{ fontWeight: 700, color: '#f87171' }}>{fmtRp(amt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Balance Sheet */}
          {bs && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--gold)', marginBottom: 10 }}>Neraca</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))', gap: 10 }}>
                <StatCard label="Total Aset"         value={fmtRp(bs.assets?.total ?? 0)} sub={`Kas: ${fmtRp(bs.assets?.cash ?? 0)}`} color="#60a5fa" />
                <StatCard label="Piutang (AR)"        value={fmtRp(bs.assets?.accountsReceivable ?? 0)} sub={`${bs.assets?.unpaidInvoices ?? 0} invoice belum lunas`} color="#fbbf24" />
                <StatCard label="Total Kewajiban"    value={fmtRp(bs.liabilities?.total ?? 0)} color="#f87171" />
                <StatCard label="Ekuitas"             value={fmtRp(bs.equity?.total ?? 0)} color="#4ade80" />
              </div>
            </div>
          )}

          {/* Cash Flow */}
          {cf && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--gold)', marginBottom: 10 }}>Arus Kas</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))', gap: 10 }}>
                <StatCard label="Kas Masuk"   value={fmtRp(cf.operating?.inflows ?? 0)} color="#4ade80" />
                <StatCard label="Kas Keluar"  value={fmtRp(cf.operating?.outflows ?? 0)} color="#f87171" />
                <StatCard label="Arus Bersih" value={fmtRp(cf.operating?.net ?? 0)} color={(cf.operating?.net ?? 0) >= 0 ? '#4ade80' : '#f87171'} />
                <StatCard label="Saldo Akhir" value={fmtRp(cf.balances?.closing ?? 0)} color="#c9a227" sub={`Awal: ${fmtRp(cf.balances?.opening ?? 0)}`} />
              </div>
            </div>
          )}
        </div>
      ) : !error ? (
        <div className="coming" style={{ padding: '40px 0' }}>
          <p style={{ color: 'var(--muted)', margin: 0 }}>Tidak ada data untuk periode ini</p>
        </div>
      ) : null}
    </div>
  )
}
