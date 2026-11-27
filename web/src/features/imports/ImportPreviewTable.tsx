import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, Download, Lock, Play, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { TimeText } from '../../components/TimeText'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { Table, Td, Th, Tr } from '../../components/ui/Table'
import type {
  DataImportDetail,
  ImportActiveLock,
  ImportPlanAction,
  ImportPlanRow,
} from '../../lib/api/schemas'
import { describeError } from '../../lib/errors'
import { cell, number } from '../../lib/format'
import { downloadImportReport, IMPORT_ENTITY_META } from './queries'

type PreviewFilter = 'all' | ImportPlanAction

const ACTION_BADGE: Record<ImportPlanAction, { label: string; className: string }> = {
  create: {
    label: 'Baru',
    className: 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  update: {
    label: 'Perbarui',
    className: 'border-sky-600/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  },
  skip: {
    label: 'Lewati',
    className: 'border bg-surface text-muted',
  },
  invalid: {
    label: 'Error',
    className: 'border-error/40 bg-error/10 text-error',
  },
}

const FILTER_OPTIONS: { key: PreviewFilter; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'create', label: 'Baru' },
  { key: 'update', label: 'Diperbarui' },
  { key: 'skip', label: 'Dilewati' },
  { key: 'invalid', label: 'Error' },
]

function formatErrors(errors: ImportPlanRow['errors']): [string, string][] {
  if (!errors) return []
  return Object.entries(errors).map(([field, messages]) => [
    field,
    Array.isArray(messages) ? messages.join(', ') : String(messages),
  ])
}

export function ImportPreviewTable({
  detail,
  isAdmin,
  lockConflict,
  staleMessage,
  revalidating,
  committing,
  onBackToUpload,
  onRevalidate,
  onCommit,
}: {
  detail: DataImportDetail
  isAdmin: boolean
  lockConflict: ImportActiveLock | null
  staleMessage: string | null
  revalidating: boolean
  committing: boolean
  onBackToUpload: () => void
  onRevalidate: () => void
  onCommit: () => void
}) {
  const [filter, setFilter] = useState<PreviewFilter>('all')
  const [downloadingErrors, setDownloadingErrors] = useState(false)

  const planRows = useMemo(() => detail.plan_rows ?? [], [detail.plan_rows])

  const counts = useMemo(
    () => ({
      all: planRows.length,
      create: detail.create_count ?? planRows.filter((r) => r.action === 'create').length,
      update: detail.update_count ?? planRows.filter((r) => r.action === 'update').length,
      skip: detail.skip_count ?? planRows.filter((r) => r.action === 'skip').length,
      invalid: detail.invalid_count ?? planRows.filter((r) => r.action === 'invalid').length,
    }),
    [detail.create_count, detail.invalid_count, detail.skip_count, detail.update_count, planRows],
  )

  const filteredRows = useMemo(() => {
    if (filter === 'all') return planRows
    return planRows.filter((row) => row.action === filter)
  }, [filter, planRows])

  const invalidCount = counts.invalid
  const executableCount = counts.create + counts.update
  const isStale = Boolean(staleMessage)
  const canCommit =
    invalidCount === 0 && executableCount > 0 && !isStale && !revalidating && !committing
  const entityMeta = IMPORT_ENTITY_META[detail.type]
  const snapshotIso = detail.validated_at ?? detail.created_at

  async function handleDownloadErrors() {
    setDownloadingErrors(true)
    try {
      await downloadImportReport(detail.id, detail.type, 'errors')
      toast.success('Laporan error CSV berhasil diunduh.')
    } catch (err) {
      toast.error(describeError(err, isAdmin).title)
    } finally {
      setDownloadingErrors(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-surface/60 px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold text-fg">{detail.original_filename}</span>
          <span className="text-muted">Entitas: {entityMeta.label}</span>
          <span className="text-muted">
            Mode:{' '}
            {detail.mode === 'upsert' ? 'Tambah & Perbarui (Upsert)' : 'Tambah Baru Saja'}
          </span>
          <span className="text-muted">Total: {number(detail.total_rows)} baris</span>
        </div>
        {snapshotIso ? (
          <span className="text-muted">
            Snapshot: <TimeText iso={snapshotIso} mode="full" />
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-md border bg-bg px-3 py-2">
          <div className="text-xs text-muted">Baru</div>
          <div className="text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
            {number(counts.create)}
          </div>
        </div>
        <div className="rounded-md border bg-bg px-3 py-2">
          <div className="text-xs text-muted">Diperbarui</div>
          <div className="text-lg font-semibold tabular-nums text-sky-700 dark:text-sky-300">
            {number(counts.update)}
          </div>
        </div>
        <div className="rounded-md border bg-bg px-3 py-2">
          <div className="text-xs text-muted">Dilewati</div>
          <div className="text-lg font-semibold tabular-nums text-muted">
            {number(counts.skip)}
          </div>
        </div>
        <div className="rounded-md border bg-bg px-3 py-2">
          <div className="text-xs text-muted">Error</div>
          <div
            className={`text-lg font-semibold tabular-nums ${invalidCount > 0 ? 'text-error' : 'text-fg'}`}
          >
            {number(invalidCount)}
          </div>
        </div>
      </div>

      {isStale ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">Pratinjau tidak lagi mutakhir (Stale)</p>
              <p>
                {staleMessage ??
                  'Data di sistem telah berubah sejak file ini dipratinjau. Jalankan Validasi Ulang sebelum eksekusi.'}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={onRevalidate}
            disabled={revalidating || committing}
          >
            {revalidating ? <Spinner /> : <RefreshCw size={14} aria-hidden />}
            <span>Validasi Ulang</span>
          </Button>
        </div>
      ) : null}

      {lockConflict ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
        >
          <Lock size={15} className="mt-0.5 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">Eksekusi impor sedang dikunci oleh impor lain</p>
            <p>
              {lockConflict.requester_name ?? 'Pengguna lain'} sedang menjalankan impor (
              {number(lockConflict.processed_rows)} / {number(lockConflict.total_rows)} baris
              {lockConflict.started_at ? (
                <>
                  , mulai <TimeText iso={lockConflict.started_at} mode="short" />
                </>
              ) : null}
              ). Tunggu selesai lalu klik Validasi Ulang atau Jalankan Impor.
            </p>
          </div>
        </div>
      ) : null}

      {invalidCount > 0 ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-error/40 bg-error/10 px-3 py-2 text-xs text-error"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">
                Terdapat {number(invalidCount)} baris error — impor diblokir
              </p>
              <p className="text-fg/80">
                Perbaiki seluruh baris yang bermasalah di file CSV/XLSX Anda, lalu unggah ulang
                untuk memulai pratinjau baru.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={handleDownloadErrors}
            disabled={downloadingErrors}
          >
            {downloadingErrors ? <Spinner /> : <Download size={14} aria-hidden />}
            <span>Unduh Laporan Error (CSV)</span>
          </Button>
        </div>
      ) : executableCount === 0 ? (
        <div className="rounded-md border bg-surface px-3 py-2 text-xs text-muted">
          Tidak ada baris yang akan ditambahkan atau diperbarui — seluruh baris dilewati. Unggah
          file lain bila Anda ingin mengubah data.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Filter baris pratinjau"
        >
          {FILTER_OPTIONS.map((option) => {
            const active = filter === option.key
            const count = counts[option.key]
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(option.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'border-accent bg-accent text-on-accent'
                    : 'bg-bg text-fg hover:bg-surface'
                }`}
              >
                <span>{option.label}</span>
                <span className="tabular-nums opacity-80">({number(count)})</span>
              </button>
            )
          })}
        </div>
        <span className="text-xs text-muted tabular-nums">
          Menampilkan {number(filteredRows.length)} dari {number(planRows.length)} baris
        </span>
      </div>

      <div className="max-h-72 overflow-y-auto rounded-md border">
        <Table>
          <thead>
            <Tr>
              <Th className="w-16">Baris</Th>
              <Th className="w-28">Aksi</Th>
              <Th>Data &amp; Perubahan (Lama → Baru)</Th>
              <Th>Catatan / Error</Th>
            </Tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <Tr>
                <Td colSpan={4} className="py-6 text-center text-muted">
                  Tidak ada baris pada kategori ini.
                </Td>
              </Tr>
            ) : (
              filteredRows.map((row) => {
                const badge = ACTION_BADGE[row.action]
                const diffEntries = Object.entries(row.diff ?? {})
                const valueEntries = Object.entries(row.values ?? {}).filter(
                  ([field]) => !(row.diff && field in row.diff),
                )
                const errorEntries = formatErrors(row.errors)

                return (
                  <Tr key={`${row.row_number}-${row.action}`} className="align-top">
                    <Td className="py-2 font-mono text-xs tabular-nums text-muted">
                      #{row.row_number}
                    </Td>
                    <Td className="py-2">
                      <span
                        className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    </Td>
                    <Td className="py-2">
                      <div className="flex flex-col gap-1 text-xs">
                        {diffEntries.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            {diffEntries.map(([field, change]) => (
                              <div key={field} className="flex flex-wrap items-center gap-1">
                                <span className="font-semibold text-fg">{field}:</span>
                                <span className="rounded-sm bg-surface px-1 text-muted line-through">
                                  {cell(change.old)}
                                </span>
                                <span aria-hidden className="text-muted">
                                  →
                                </span>
                                <span className="rounded-sm bg-sky-500/10 px-1 font-medium text-sky-800 dark:text-sky-200">
                                  {cell(change.new)}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {valueEntries.length > 0 ? (
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted">
                            {valueEntries.map(([field, val]) => (
                              <span key={field}>
                                <span className="font-medium text-fg/80">{field}:</span> {cell(val)}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </Td>
                    <Td className="py-2 text-xs">
                      {errorEntries.length > 0 ? (
                        <ul className="flex flex-col gap-0.5 text-error">
                          {errorEntries.map(([field, msg]) => (
                            <li key={field}>
                              <span className="font-semibold">{field}:</span> {msg}
                            </li>
                          ))}
                        </ul>
                      ) : row.reason ? (
                        <p className="text-muted">{row.reason}</p>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </Td>
                  </Tr>
                )
              })
            )}
          </tbody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onBackToUpload}
            disabled={revalidating || committing}
          >
            <ArrowLeft size={14} aria-hidden />
            <span>Ganti File</span>
          </Button>
          {invalidCount > 0 ? (
            <Button
              type="button"
              variant="secondary"
              onClick={handleDownloadErrors}
              disabled={downloadingErrors}
            >
              {downloadingErrors ? <Spinner /> : <Download size={14} aria-hidden />}
              <span>Unduh Error</span>
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onRevalidate}
            disabled={revalidating || committing}
          >
            {revalidating ? <Spinner /> : <RefreshCw size={14} aria-hidden />}
            <span>Validasi Ulang</span>
          </Button>
          <Button type="button" variant="primary" onClick={onCommit} disabled={!canCommit}>
            {committing ? <Spinner /> : <Play size={14} aria-hidden />}
            <span>Jalankan Impor ({number(executableCount)})</span>
          </Button>
        </div>
      </div>
    </div>
  )
}
