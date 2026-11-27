import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, FileSpreadsheet, History, Lock, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { TimeText } from '../../components/TimeText'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { ApiError } from '../../lib/api/client'
import type {
  DataImportSummary,
  ImportActiveLock,
  ImportEntityType,
  ImportFileFormat,
  ImportMode,
} from '../../lib/api/schemas'
import { describeError } from '../../lib/errors'
import { number } from '../../lib/format'
import { useAuth } from '../auth/auth'
import { ImportPreviewTable } from './ImportPreviewTable'
import { ImportProgressView } from './ImportProgressView'
import {
  canImportUpsert,
  downloadImportTemplate,
  IMPORT_ENTITY_META,
  invalidateEntityCaches,
  isImportActiveStatus,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_ROWS,
  useCancelImport,
  useCommitImport,
  useDataImportDetail,
  useDataImports,
  usePreviewImport,
  useRevalidateImport,
} from './queries'

const STATUS_LABELS: Record<DataImportSummary['status'], string> = {
  preview: 'Pratinjau',
  queued: 'Antrean',
  processing: 'Diproses',
  completed: 'Selesai',
  failed: 'Gagal',
  cancelled: 'Dibatalkan',
  expired: 'Kedaluwarsa',
}

function validateImportFile(file: File): string | null {
  const lower = file.name.toLowerCase()
  if (!lower.endsWith('.csv') && !lower.endsWith('.xlsx')) {
    return 'Format file harus .csv atau .xlsx.'
  }
  if (file.size <= 0) {
    return 'File yang dipilih kosong.'
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return 'Ukuran file maksimal 2 MB.'
  }
  return null
}

function extractActiveLock(details: Record<string, unknown> | undefined): ImportActiveLock | null {
  const raw = details?.active_import
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw as Partial<ImportActiveLock>
  if (typeof candidate.id !== 'number' || typeof candidate.type !== 'string') {
    return null
  }
  return {
    id: candidate.id,
    type: candidate.type as ImportEntityType,
    status: candidate.status === 'processing' ? 'processing' : 'queued',
    requester_name: typeof candidate.requester_name === 'string' ? candidate.requester_name : null,
    processed_rows: typeof candidate.processed_rows === 'number' ? candidate.processed_rows : 0,
    total_rows: typeof candidate.total_rows === 'number' ? candidate.total_rows : 0,
    started_at: typeof candidate.started_at === 'string' ? candidate.started_at : null,
    is_mine: Boolean(candidate.is_mine),
  }
}

export function ImportModal({
  open,
  onOpenChange,
  type,
  title,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: ImportEntityType
  title: string
}) {
  const { user } = useAuth()
  const isAdmin = user?.role.code === 'admin_it'
  const qc = useQueryClient()
  const fileInputId = useId()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const invalidatedIdsRef = useRef<Set<number>>(new Set())

  const canUpsert = canImportUpsert(user, type)
  const meta = IMPORT_ENTITY_META[type]

  const [selectedImportId, setSelectedImportId] = useState<number | null>(null)
  const [mode, setMode] = useState<ImportMode>('create_only')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [downloadingFormat, setDownloadingFormat] = useState<ImportFileFormat | null>(null)
  const [staleMessage, setStaleMessage] = useState<string | null>(null)
  const [lockConflict, setLockConflict] = useState<ImportActiveLock | null>(null)

  const listQuery = useDataImports(type, open)
  const detailQuery = useDataImportDetail(open ? selectedImportId : null)
  const previewMutation = usePreviewImport()
  const revalidateMutation = useRevalidateImport()
  const commitMutation = useCommitImport()
  const cancelMutation = useCancelImport()

  const detail = detailQuery.data ?? null
  const effectiveMode: ImportMode = canUpsert ? mode : 'create_only'

  useEffect(() => {
    if (!detail) return
    const terminalDone = detail.status === 'completed' || detail.status === 'cancelled'
    if (terminalDone && !invalidatedIdsRef.current.has(detail.id)) {
      invalidatedIdsRef.current.add(detail.id)
      invalidateEntityCaches(qc, detail.type)
    }
  }, [detail, qc])

  function resetToUpload() {
    setSelectedImportId(null)
    setSelectedFile(null)
    setFileError(null)
    setStaleMessage(null)
    setLockConflict(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetToUpload()
    }
    onOpenChange(nextOpen)
  }

  async function handleDownloadTemplate(format: ImportFileFormat) {
    setDownloadingFormat(format)
    try {
      await downloadImportTemplate(type, format)
      toast.success(`Template ${format.toUpperCase()} berhasil diunduh.`)
    } catch (err) {
      toast.error(describeError(err, isAdmin).title)
    } finally {
      setDownloadingFormat(null)
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setFileError(null)
    if (!file) {
      setSelectedFile(null)
      return
    }
    const err = validateImportFile(file)
    if (err) {
      setSelectedFile(null)
      setFileError(err)
      return
    }
    setSelectedFile(file)
  }

  async function handlePreviewSubmit(e: FormEvent) {
    e.preventDefault()
    if (!selectedFile) {
      setFileError('Pilih file .csv atau .xlsx terlebih dahulu.')
      return
    }
    const validationErr = validateImportFile(selectedFile)
    if (validationErr) {
      setFileError(validationErr)
      return
    }
    setFileError(null)
    setStaleMessage(null)
    setLockConflict(null)

    try {
      const created = await previewMutation.mutateAsync({
        type,
        mode: effectiveMode,
        file: selectedFile,
      })
      setSelectedImportId(created.id)
      toast.success('Pratinjau & validasi selesai.')
    } catch (err) {
      if (err instanceof ApiError && err.fields?.file?.[0]) {
        setFileError(err.fields.file[0])
      } else {
        const desc = describeError(err, isAdmin)
        setFileError(desc.message || desc.title)
        toast.error(desc.title)
      }
    }
  }

  async function handleRevalidate() {
    if (!detail) return
    setStaleMessage(null)
    setLockConflict(null)
    try {
      await revalidateMutation.mutateAsync(detail.id)
      toast.success('Pratinjau berhasil divalidasi ulang.')
    } catch (err) {
      toast.error(describeError(err, isAdmin).title)
    }
  }

  async function handleCommit() {
    if (!detail) return
    setStaleMessage(null)
    setLockConflict(null)
    try {
      const updated = await commitMutation.mutateAsync(detail.id)
      if (!isImportActiveStatus(updated.status)) {
        invalidateEntityCaches(qc, updated.type)
      }
      toast.success('Proses impor mulai dijalankan.')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const reason = err.details?.reason
        if (reason === 'STALE_PREVIEW') {
          setStaleMessage(err.message)
          void detailQuery.refetch()
          return
        }
        if (reason === 'RESOURCE_LOCKED') {
          setLockConflict(extractActiveLock(err.details))
          toast.error('Ada impor lain yang masih berjalan untuk entitas ini.')
          return
        }
      }
      toast.error(describeError(err, isAdmin).title)
    }
  }

  async function handleCancel() {
    if (!detail) return
    try {
      await cancelMutation.mutateAsync(detail.id)
      toast.success('Permintaan pembatalan impor dikirim.')
    } catch (err) {
      toast.error(describeError(err, isAdmin).title)
    }
  }

  const activeLock = listQuery.data?.activeLock ?? null
  const recentImports = listQuery.data?.items.slice(0, 5) ?? []

  const stepDescription = !selectedImportId
    ? `Unduh template, pilih mode, lalu unggah file CSV/XLSX (maks. ${number(MAX_IMPORT_ROWS)} baris, 2 MB).`
    : detail?.status === 'preview'
      ? 'Periksa ringkasan perubahan (dry-run) sebelum menyimpan ke sistem.'
      : 'Pantau progres eksekusi impor dan unduh laporan hasil.'

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      size="lg"
      title={`Impor Data ${title}`}
      description={stepDescription}
    >
      {selectedImportId !== null ? (
        detailQuery.isLoading && !detail ? (
          <div className="flex items-center justify-center gap-2 py-10 text-dense text-muted">
            <Spinner />
            <span>Memuat detail impor...</span>
          </div>
        ) : detailQuery.isError && !detail ? (
          <div className="flex flex-col gap-3">
            <div
              role="alert"
              className="rounded-md border border-error/40 bg-error/10 p-3 text-xs text-error"
            >
              {describeError(detailQuery.error, isAdmin).title}
            </div>
            <div>
              <Button type="button" variant="secondary" onClick={resetToUpload}>
                Kembali ke Unggah File
              </Button>
            </div>
          </div>
        ) : detail ? (
          detail.status === 'preview' ? (
            <ImportPreviewTable
              detail={detail}
              isAdmin={isAdmin}
              lockConflict={lockConflict ?? activeLock}
              staleMessage={staleMessage}
              revalidating={revalidateMutation.isPending}
              committing={commitMutation.isPending}
              onBackToUpload={resetToUpload}
              onRevalidate={handleRevalidate}
              onCommit={handleCommit}
            />
          ) : (
            <ImportProgressView
              detail={detail}
              isAdmin={isAdmin}
              cancelling={cancelMutation.isPending}
              onCancel={handleCancel}
              onReset={resetToUpload}
              onClose={() => handleOpenChange(false)}
            />
          )
        ) : null
      ) : (
        <div className="flex flex-col gap-4">
          {activeLock ? (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
            >
              <div className="flex items-start gap-2">
                <Lock size={15} className="mt-0.5 shrink-0" aria-hidden />
                <div>
                  <p className="font-semibold">Sedang ada impor {title} yang berjalan</p>
                  <p>
                    Oleh {activeLock.requester_name ?? 'pengguna lain'} (
                    {number(activeLock.processed_rows)} / {number(activeLock.total_rows)} baris
                    {activeLock.started_at ? (
                      <>
                        , mulai <TimeText iso={activeLock.started_at} mode="short" />
                      </>
                    ) : null}
                    ). Anda tetap bisa menyiapkan pratinjau sekarang, tetapi eksekusi baru bisa
                    dijalankan setelah proses ini selesai.
                  </p>
                </div>
              </div>
              {activeLock.is_mine ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setSelectedImportId(activeLock.id)}
                >
                  Lihat Progres
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <span className="text-dense font-semibold">1. Mode Impor</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                aria-pressed={effectiveMode === 'create_only'}
                onClick={() => setMode('create_only')}
                className={`flex flex-col items-start gap-0.5 rounded-md border p-3 text-left transition-colors ${
                  effectiveMode === 'create_only'
                    ? 'border-accent bg-surface ring-1 ring-accent'
                    : 'bg-bg hover:bg-surface/60'
                }`}
              >
                <span className="text-dense font-semibold">Tambah Baru Saja</span>
                <span className="text-xs text-muted">
                  Hanya menambah baris baru. Baris yang sudah ada otomatis dilewati.
                </span>
              </button>

              <button
                type="button"
                disabled={!canUpsert}
                aria-pressed={effectiveMode === 'upsert'}
                onClick={() => {
                  if (canUpsert) setMode('upsert')
                }}
                className={`flex flex-col items-start gap-0.5 rounded-md border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
                  effectiveMode === 'upsert'
                    ? 'border-accent bg-surface ring-1 ring-accent'
                    : 'bg-bg hover:bg-surface/60'
                }`}
              >
                <span className="text-dense font-semibold">Tambah &amp; Perbarui (Upsert)</span>
                <span className="text-xs text-muted">
                  {canUpsert
                    ? 'Menambah data baru sekaligus memperbarui data existing berdasarkan kunci.'
                    : 'Memerlukan izin pembaruan data pada peran Anda.'}
                </span>
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-md border bg-surface/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-dense font-semibold">
                <FileSpreadsheet size={15} aria-hidden />
                <span>2. Unduh Template &amp; Panduan Kolom</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => handleDownloadTemplate('csv')}
                  disabled={downloadingFormat !== null}
                >
                  {downloadingFormat === 'csv' ? <Spinner /> : <Download size={14} aria-hidden />}
                  <span>Template CSV</span>
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => handleDownloadTemplate('xlsx')}
                  disabled={downloadingFormat !== null}
                >
                  {downloadingFormat === 'xlsx' ? <Spinner /> : <Download size={14} aria-hidden />}
                  <span>Template XLSX</span>
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {meta.headers.map((header) => (
                <code
                  key={header}
                  className="rounded-sm border bg-bg px-1.5 py-0.5 font-mono text-[11px] text-fg"
                >
                  {header}
                </code>
              ))}
            </div>
            <p className="text-xs text-muted">{meta.columnHint}</p>
            <p className="text-xs text-fg/80">{meta.recommendedNote}</p>
          </div>

          <form onSubmit={handlePreviewSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={fileInputId} className="text-dense font-semibold">
                3. Pilih File Impor (.csv atau .xlsx)
              </label>
              <input
                ref={fileInputRef}
                id={fileInputId}
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={handleFileChange}
                className="block w-full rounded-md border bg-bg px-3 py-2 text-dense text-fg file:mr-3 file:rounded-sm file:border-0 file:bg-surface file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-fg hover:file:bg-surface/80"
              />
              {selectedFile ? (
                <p className="text-xs text-muted">
                  Dipilih: <span className="font-medium text-fg">{selectedFile.name}</span> (
                  {number(Math.max(1, Math.round(selectedFile.size / 1024)))} KB)
                </p>
              ) : (
                <p className="text-xs text-muted">
                  Maksimal {number(MAX_IMPORT_ROWS)} baris per impor dan ukuran file 2 MB.
                </p>
              )}
              {fileError ? (
                <p role="alert" className="text-xs text-error">
                  {fileError}
                </p>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t pt-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleOpenChange(false)}
                disabled={previewMutation.isPending}
              >
                Batal
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={!selectedFile || previewMutation.isPending}
              >
                {previewMutation.isPending ? <Spinner /> : <Upload size={14} aria-hidden />}
                <span>Pratinjau &amp; Validasi</span>
              </Button>
            </div>
          </form>

          {recentImports.length > 0 ? (
            <div className="flex flex-col gap-2 border-t pt-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
                <History size={14} aria-hidden />
                <span>Riwayat impor {title} terbaru</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {recentImports.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-surface/40 px-2.5 py-1.5 text-xs"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-fg">
                        {item.original_filename}
                      </span>
                      <span className="rounded-sm border bg-bg px-1.5 py-0.5 text-[11px] font-medium text-muted">
                        {STATUS_LABELS[item.status]}
                      </span>
                      <span className="text-muted tabular-nums">
                        {number(item.total_rows)} baris ·{' '}
                        <TimeText iso={item.created_at} mode="short" />
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        setStaleMessage(null)
                        setLockConflict(null)
                        setSelectedImportId(item.id)
                      }}
                    >
                      {item.status === 'preview'
                        ? 'Lanjutkan Pratinjau'
                        : isImportActiveStatus(item.status)
                          ? 'Pantau Progres'
                          : 'Lihat Hasil'}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  )
}
