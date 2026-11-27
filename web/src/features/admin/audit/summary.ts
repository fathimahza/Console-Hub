import type { AuditEvent } from '../../../lib/api/schemas'

export const ACTIONS: Record<string, string> = {
  'barang.create': 'Barang dibuat',
  'barang.update': 'Barang diubah',
  'barang.delete': 'Barang dinonaktifkan',
  'produksi.create': 'Produksi dibuat',
  'produksi.update': 'Produksi diubah',
  'produksi.delete': 'Produksi dinonaktifkan',
  'personel.create': 'Personel dibuat',
  'personel.update': 'Personel diubah',
  'personel.delete': 'Personel dinonaktifkan',
  'rbac.user_created': 'Pengguna dibuat',
  'rbac.user_updated': 'Pengguna diubah',
  'rbac.role_updated': 'Izin peran diubah',
  'console.tested': 'Koneksi diuji',
  'logs.synced': 'Log ditarik',
  'auth.login': 'Masuk',
  'auth.register': 'Daftar akun',
  'auth.profile_updated': 'Profil diubah',
  'import.started': 'Impor dimulai',
  'import.completed': 'Impor selesai',
  'import.failed': 'Impor gagal',
  'import.cancelled': 'Impor dibatalkan',
}

type Change = { old: unknown; new: unknown }
const isChange = (v: unknown): v is Change =>
  !!v && typeof v === 'object' && 'old' in v && 'new' in v

const show = (v: unknown) =>
  v === null || v === undefined || v === ''
    ? '—'
    : typeof v === 'number'
      ? v.toLocaleString('id-ID')
      : Array.isArray(v)
        ? v.join(', ')
        : String(v)

/** Old → new pairs from `details.changes`, if the event has them. */
export function changesOf(e: AuditEvent): { field: string; old: string; new: string }[] {
  const changes = e.details?.changes
  if (!changes || typeof changes !== 'object') return []
  return Object.entries(changes as Record<string, unknown>)
    .filter(([, v]) => isChange(v))
    .map(([field, v]) => ({ field, old: show((v as Change).old), new: show((v as Change).new) }))
}

/** One plain line for events without field changes. */
export function summaryOf(e: AuditEvent): string {
  const d = e.details ?? {}
  switch (e.action) {
    case 'console.tested':
      return `hasil ${show(d.status)}${typeof d.latency_ms === 'number' ? `, ${d.latency_ms} ms` : ''}`
    case 'logs.synced': {
      const results = Array.isArray(d.results)
        ? (d.results as { console: string; status: string }[])
        : []
      const failed = results.filter((r) => r.status !== 'ok').map((r) => r.console)
      return failed.length
        ? `${results.length} sumber, gagal: ${failed.join(', ')}`
        : `${results.length} sumber, semua berhasil`
    }
    default:
      return typeof d.name === 'string' ? d.name : ''
  }
}
