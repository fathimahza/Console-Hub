import { useMemo, useState } from 'react'
import { AlertTriangle, Ban, CheckCircle2, Clock, Download, RotateCcw, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { TimeText } from '../../components/TimeText'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { Table, Td, Th, Tr } from '../../components/ui/Table'
import type { DataImportDetail, ImportResultStatus } from '../../lib/api/schemas'
import { describeError } from '../../lib/errors'
import { number } from '../../lib/format'
import { downloadImportReport, IMPORT_ENTITY_META, isImportActiveStatus } from './queries'

const RESULT_BADGE: Record<ImportResultStatus, { label: string; className: string }> = {
  created: {
    label: 'Ditambah',
    className: 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  updated: {
    label: 'Diperbarui',
    className: 'border-sky-600/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  },
  skipped: {
    label: 'Dilewati',
    className: 'border bg-surface text-muted',
  },
  pending: {
    label: 'Menunggu',
    className: 'border bg-surface text-muted',
  },
  conflict: {
    label: 'Konflik',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  },
  invalid: {
    label: 'Tidak Valid',
    className: 'border-error/40 bg-error/10 text-error',
  },
  failed: {
    label: 'Gagal',
    className: 'border-error/40 bg-error/10 text-error',
  },
}

const FAILED_RESULT_STATUSES: ReadonlySet<ImportResultStatus> = new Set([
  'failed',
  'conflict',
  'invalid',
])

const STATUS_META: Record<
  DataImportDetail['status'],
  { title: string; subtitle: string; className: string }
> = {
  preview: {
    title: 'Menunggu eksekusi',
    subtitle: 'Impor belum dijalankan.',
    className: 'border bg-surface text-fg',
  },
  expired: {
    title: 'Pratinjau kedaluwarsa',
    subtitle: 'Masa simpan pratinjau telah habis. Unggah ulang file untuk memulai impor baru.',
    className: 'border bg-surface text-muted',
  },
  queued: {
    title: 'Menunggu antrean worker...',
    subtitle: 'Pekerjaan impor sudah masuk antrean dan akan segera diproses.',
    className: 'border-sky-600/30 bg-sky-500/10 text-sky-900 dark:text-sky-200',
  },
  processing: {
    title: 'Sedang memproses impor...',
    subtitle: 'Progres diperbarui otomatis setiap 2 detik.',
    className: 'border-sky-600/30 bg-sky-500/10 text-sky-900 dark:text-sky-200',
  },
  completed: {
    title: 'Impor selesai',
    subtitle: 'Seluruh baris telah selesai diproses.',
    className: 'border-emerald-600/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200',
  },
  failed: {
    title: 'Impor gagal',
    subtitle: 'Terjadi kendala saat menjalankan proses impor.',
    className: 'border-error/40 bg-error/10 text-error',
  },
  cancelled: {
    title: 'Impor dibatalkan',
    subtitle: 'Baris yang sudah sempat diproses sebelum pembatalan tetap tercatat.',
    className: 'border bg-surface text-muted',
  },
}

export function ImportProgressView({
  detail,
  isAdmin,
  cancelling,
  onCancel,
  onReset,
  onClose,
}: {
  detail: DataImportDetail
  isAdmin: boolean
  cancelling: boolean
  onCancel: () => void
  onReset: () => void
  onClose: () => void
}) {
  const [onlyFailed, setOnlyFailed] = useState(false)
  const [downloadingScope, setDownloadingScope] = useState<'all' | 'errors' | null>(null)

  const active = isImportActiveStatus(detail.status)
  const partialErrors = detail.status === 'completed' && detail.failed_count > 0
  const baseStatusInfo = STATUS_META[detail.status]
  const statusInfo = partialErrors
    ? {
        title: 'Selesai dengan sebagian gagal/konflik',
        subtitle: 'Sebagian baris gagal atau berkonflik; unduh laporan error untuk meninjau.',
        className: 'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200',
      }
    : baseStatusInfo

  const total = Math.max(detail.total_rows, 0)
  const processed = Math.min(Math.max(detail.processed_rows, 0), total || detail.processed_rows)
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0
  const finishedAt = detail.completed_at ?? detail.cancelled_at

  const results = useMemo(() => detail.execution_results ?? [], [detail.execution_results])
  const visibleResults = useMemo(
    () => (onlyFailed ? results.filter((r) => FAILED_RESULT_STATUSES.has(r.status)) : results),
    [onlyFailed, results],
  )

  async function handleDownloadReport(scope: 'all' | 'errors') {
    setDownloadingScope(scope)
    try {
      await downloadImportReport(detail.id, detail.type, scope)
      toast.success(
        scope === 'errors'
          ? 'Laporan baris gagal CSV berhasil diunduh.'
          : 'Laporan hasil impor CSV berhasil diunduh.',
      )
    } catch (err) {
      toast.error(describeError(err, isAdmin).title)
    } finally {
      setDownloadingScope(null)
    }
  }

  function renderStatusIcon() {
    if (active) return <Spinner />
    if (partialErrors) {
      return <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden />
    }
    if (detail.status === 'completed') {
      return <CheckCircle2 size={17} className="mt-0.5 shrink-0" aria-hidden />
    }
    if (detail.status === 'failed') {
      return <XCircle size={17} className="mt-0.5 shrink-0" aria-hidden />
    }
    if (detail.status === 'expired') {
      return <Clock size={17} className="mt-0.5 shrink-0" aria-hidden />
    }
    return <Ban size={17} className="mt-0.5 shrink-0" aria-hidden />
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role={active ? 'status' : 'region'}
        aria-live={active ? 'polite' : undefined}
        className={`flex items-start justify-between gap-3 rounded-md border px-3 py-2.5 text-xs ${statusInfo.className}`}
      >
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 shrink-0">{renderStatusIcon()}</div>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold">{statusInfo.title}</span>
            <span>{statusInfo.subtitle}</span>
            <span className="text-muted">
              {IMPORT_ENTITY_META[detail.type].label} · {detail.original_filename}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-0.5 text-right text-[11px] text-muted">
          {detail.started_at ? (
            <span>
              Mulai: <TimeText iso={detail.started_at} mode="short" />
            </span>
          ) : null}
          {finishedAt ? (
            <span>
              Selesai: <TimeText iso={finishedAt} mode="short" />
            </span>
          ) : null}
        </div>
      </div>

      {active && detail.cancel_requested ? (
        <div
          role="status"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
        >
          Permintaan pembatalan telah dikirim. Proses akan berhenti setelah baris yang sedang
          berjalan selesai diproses.
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-fg">Progres pemrosesan</span>
          <span className="font-mono tabular-nums text-muted">
            {number(processed)} / {number(total)} baris ({pct}%)
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Progres impor"
          aria-valuenow={processed}
          aria-valuemin={0}
          aria-valuemax={total}
          className="h-2.5 w-full overflow-hidden rounded-full border bg-surface"
        >
          <div
            className={`h-full transition-[width] duration-300 ${
              detail.status === 'failed'
                ? 'bg-error'
                : detail.status === 'completed' && !partialErrors
                  ? 'bg-ok'
                  : 'bg-accent'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-md border bg-bg px-3 py-2">
          <div className="text-xs text-muted">Ditambah</div>
          <div className="text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
            {number(detail.created_count)}
          </div>
        </div>
        <div className="rounded-md border bg-bg px-3 py-2">
          <div className="text-xs text-muted">Diperbarui</div>
          <div className="text-lg font-semibold tabular-nums text-sky-700 dark:text-sky-300">
            {number(detail.updated_count)}
          </div>
        </div>
        <div className="rounded-md border bg-bg px-3 py-2">
          <div className="text-xs text-muted">Dilewati</div>
          <div className="text-lg font-semibold tabular-nums text-muted">
            {number(detail.skipped_count)}
          </div>
        </div>
        <div className="rounded-md border bg-bg px-3 py-2">
          <div className="text-xs text-muted">Gagal / Konflik</div>
          <div
            className={`text-lg font-semibold tabular-nums ${detail.failed_count > 0 ? 'text-error' : 'text-fg'}`}
          >
            {number(detail.failed_count)}
          </div>
        </div>
      </div>

      {detail.error_message ? (
        <div
          role="alert"
          className="rounded-md border border-error/40 bg-error/10 px-3 py-2 text-xs text-error"
        >
          {detail.error_message}
        </div>
      ) : null}

      {results.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-fg">
              Detail hasil per baris ({number(visibleResults.length)})
            </span>
            {detail.failed_count > 0 ? (
              <button
                type="button"
                aria-pressed={onlyFailed}
                onClick={() => setOnlyFailed((v) => !v)}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                  onlyFailed
                    ? 'border-error bg-error/10 text-error'
                    : 'bg-bg text-fg hover:bg-surface'
                }`}
              >
                Tampilkan hanya gagal / konflik ({number(detail.failed_count)})
              </button>
            ) : null}
          </div>

          <div className="max-h-60 overflow-y-auto rounded-md border">
            <Table>
              <thead>
                <Tr>
                  <Th className="w-16">Baris</Th>
                  <Th className="w-28">Status</Th>
                  <Th className="w-24">Aksi</Th>
                  <Th>Keterangan</Th>
                </Tr>
              </thead>
              <tbody>
                {visibleResults.map((row) => {
                  const badge = RESULT_BADGE[row.status]
                  const isErr = FAILED_RESULT_STATUSES.has(row.status)
                  return (
                    <Tr key={`${row.row_number}-${row.status}`}>
                      <Td className="py-1.5 font-mono text-xs tabular-nums text-muted">
                        #{row.row_number}
                      </Td>
                      <Td className="py-1.5">
                        <span
                          className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </Td>
                      <Td className="py-1.5 text-xs text-muted">{row.action}</Td>
                      <Td className="py-1.5 text-xs">
                        {row.reason ? (
                          <span className={isErr ? 'text-error' : 'text-fg'}>{row.reason}</span>
                        ) : row.target_id !== undefined && row.target_id !== null ? (
                          <span className="font-mono text-muted">ID: {String(row.target_id)}</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </Td>
                    </Tr>
                  )
                })}
              </tbody>
            </Table>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="flex flex-wrap items-center gap-2">
          {!active && detail.status !== 'expired' ? (
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleDownloadReport('all')}
                disabled={downloadingScope !== null}
              >
                {downloadingScope === 'all' ? <Spinner /> : <Download size={14} aria-hidden />}
                <span>Unduh Laporan Hasil (CSV)</span>
              </Button>
              {detail.failed_count > 0 ? (
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => handleDownloadReport('errors')}
                  disabled={downloadingScope !== null}
                >
                  {downloadingScope === 'errors' ? <Spinner /> : <Download size={14} aria-hidden />}
                  <span>Unduh Error (CSV)</span>
                </Button>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {active ? (
            <Button
              type="button"
              variant="danger"
              onClick={onCancel}
              disabled={cancelling || detail.cancel_requested}
            >
              {cancelling ? <Spinner /> : <Ban size={14} aria-hidden />}
              <span>{detail.cancel_requested ? 'Membatalkan...' : 'Batalkan Impor'}</span>
            </Button>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={onReset}>
                <RotateCcw size={14} aria-hidden />
                <span>Impor File Lain</span>
              </Button>
              <Button type="button" variant="primary" onClick={onClose}>
                Selesai
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
