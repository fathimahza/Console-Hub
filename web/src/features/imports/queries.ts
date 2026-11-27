import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { ApiError, http, params, request, toApiError } from '../../lib/api/client'
import {
  apiErrorBody,
  dataImportEnvelope,
  dataImportListEnvelope,
  type AuthUser,
  type DataImportDetail,
  type DataImportSummary,
  type ImportActiveLock,
  type ImportEntityType,
  type ImportFileFormat,
  type ImportMode,
  type Permission,
} from '../../lib/api/schemas'
import { rbacKeys } from '../admin/rbac/queries'
import { workKeys } from '../work/queries'

export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024 // 2 MB
export const MAX_IMPORT_ROWS = 300

export const importKeys = {
  all: ['imports'] as const,
  list: (type?: ImportEntityType) => ['imports', 'list', type ?? 'all'] as const,
  detail: (id: number) => ['imports', 'detail', id] as const,
}

export const IMPORT_CREATE_PERMISSIONS: Record<ImportEntityType, Permission[]> = {
  users: ['admin.rbac.manage'],
  personel: ['personel.create'],
  produksi: ['produksi.create'],
  barang: ['barang.create'],
}

export const IMPORT_UPSERT_PERMISSIONS: Record<ImportEntityType, Permission[]> = {
  users: ['admin.rbac.manage'],
  personel: ['personel.create', 'personel.update'],
  produksi: ['produksi.create', 'produksi.update'],
  barang: ['barang.create', 'barang.update'],
}

export const IMPORT_ENTITY_META: Record<
  ImportEntityType,
  {
    label: string
    headers: readonly string[]
    columnHint: string
    recommendedNote: string
  }
> = {
  users: {
    label: 'Pengguna',
    headers: ['name', 'email', 'role_code'],
    columnHint:
      'Tanpa kolom password (akun login memakai OTP Email / Google). role_code contoh: user, manajer_gudang, staff_produksi, staff_hr, auditor, admin_it.',
    recommendedNote: 'Pencocokan otomatis memakai alamat email (unik).',
  },
  personel: {
    label: 'Personel',
    headers: ['id', 'name', 'role'],
    columnHint:
      'Kosongkan id pada mode Tambah Baru Saja. Isi id (UUID) saat Upsert untuk memperbarui personel aktif; baris mirip tanpa id dilewati otomatis.',
    recommendedNote: 'Disarankan diimpor lebih dulu sebelum Produksi & Barang.',
  },
  produksi: {
    label: 'Produksi',
    headers: ['id', 'area', 'production_type', 'courier'],
    columnHint:
      'Kolom courier opsional: isi UUID personel aktif, Nama, atau format "Nama · Role".',
    recommendedNote: 'Bergantung pada data Personel aktif bila kolom courier diisi.',
  },
  barang: {
    label: 'Barang',
    headers: ['id', 'name', 'kind', 'production', 'responsible', 'quantity', 'unit'],
    columnHint:
      'production opsional (UUID atau "Area · Jenis Produksi"), responsible opsional (UUID, Nama, atau "Nama · Role"), quantity default 0, unit default pcs.',
    recommendedNote: 'Bergantung pada data Produksi & Personel aktif bila kolom referensi diisi.',
  },
}

export function canImportCreate(user: AuthUser | null, type: ImportEntityType): boolean {
  if (!user) return false
  return IMPORT_CREATE_PERMISSIONS[type].every((p) => user.permissions.includes(p))
}

export function canImportUpsert(user: AuthUser | null, type: ImportEntityType): boolean {
  if (!user) return false
  return IMPORT_UPSERT_PERMISSIONS[type].every((p) => user.permissions.includes(p))
}

export function isImportActiveStatus(status: DataImportSummary['status']): boolean {
  return status === 'queued' || status === 'processing'
}

export function invalidateEntityCaches(qc: QueryClient, type: ImportEntityType) {
  if (type === 'users') {
    void qc.invalidateQueries({ queryKey: rbacKeys.users })
  } else {
    void qc.invalidateQueries({ queryKey: workKeys.root })
  }
  void qc.invalidateQueries({ queryKey: ['admin', 'overview'] })
}

export function useDataImports(type: ImportEntityType, enabled = true) {
  return useQuery({
    queryKey: importKeys.list(type),
    enabled,
    queryFn: async (): Promise<{
      items: DataImportSummary[]
      activeLock: ImportActiveLock | null
    }> => {
      const res = await request(dataImportListEnvelope, {
        method: 'GET',
        url: '/imports',
        params: params({ type }),
      })
      return {
        items: res.data,
        activeLock: res.meta.active_locks[type] ?? null,
      }
    },
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data) return false
      const active =
        data.activeLock !== null || data.items.some((item) => isImportActiveStatus(item.status))
      return active ? 2500 : false
    },
  })
}

export function useDataImportDetail(id: number | null) {
  return useQuery({
    queryKey: importKeys.detail(id ?? 0),
    enabled: id !== null,
    queryFn: async (): Promise<DataImportDetail> => {
      const res = await request(dataImportEnvelope, {
        method: 'GET',
        url: `/imports/${id}`,
      })
      return res.data
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'queued' || status === 'processing' ? 2000 : false
    },
  })
}

export function usePreviewImport() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      type: ImportEntityType
      mode: ImportMode
      file: File
    }): Promise<DataImportDetail> => {
      const formData = new FormData()
      formData.append('type', input.type)
      formData.append('mode', input.mode)
      formData.append('file', input.file)

      const res = await request(dataImportEnvelope, {
        method: 'POST',
        url: '/imports/preview',
        data: formData,
      })
      return res.data
    },
    onSuccess: (detail) => {
      qc.setQueryData(importKeys.detail(detail.id), detail)
      void qc.invalidateQueries({ queryKey: importKeys.list(detail.type) })
    },
  })
}

export function useRevalidateImport() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (id: number): Promise<DataImportDetail> => {
      const res = await request(dataImportEnvelope, {
        method: 'POST',
        url: `/imports/${id}/revalidate`,
      })
      return res.data
    },
    onSuccess: (detail) => {
      qc.setQueryData(importKeys.detail(detail.id), detail)
      void qc.invalidateQueries({ queryKey: importKeys.list(detail.type) })
    },
  })
}

export function useCommitImport() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (id: number): Promise<DataImportDetail> => {
      const res = await request(dataImportEnvelope, {
        method: 'POST',
        url: `/imports/${id}/commit`,
      })
      return res.data
    },
    onSuccess: (detail) => {
      qc.setQueryData(importKeys.detail(detail.id), detail)
      void qc.invalidateQueries({ queryKey: importKeys.list(detail.type) })
    },
  })
}

export function useCancelImport() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (id: number): Promise<DataImportDetail> => {
      const res = await request(dataImportEnvelope, {
        method: 'POST',
        url: `/imports/${id}/cancel`,
      })
      return res.data
    },
    onSuccess: (detail) => {
      qc.setQueryData(importKeys.detail(detail.id), detail)
      void qc.invalidateQueries({ queryKey: importKeys.list(detail.type) })
    },
  })
}

function filenameFromDisposition(header: unknown, fallback: string): string {
  if (typeof header === 'string') {
    const utf8Match = header.match(/filename\*=UTF-8''([^;\s]+)/i)
    if (utf8Match?.[1]) {
      try {
        return decodeURIComponent(utf8Match[1])
      } catch {
        // ignore invalid URI component
      }
    }
    const basicMatch = header.match(/filename="?([^";]+)"?/i)
    if (basicMatch?.[1]) {
      return basicMatch[1]
    }
  }
  return fallback
}

async function parseBlobError(err: unknown): Promise<ApiError> {
  if (err instanceof AxiosError && err.response?.data instanceof Blob) {
    try {
      const text = await err.response.data.text()
      const parsed = apiErrorBody.safeParse(JSON.parse(text))
      if (parsed.success) {
        return new ApiError(parsed.data.error.code, parsed.data.error.message, err.response.status, {
          details: parsed.data.error.details,
        })
      }
    } catch {
      // ignore invalid JSON blob
    }
  }
  return toApiError(err)
}

async function downloadBinary(url: string, query: Record<string, string>, fallbackName: string) {
  try {
    const res = await http.get<Blob>(url, {
      params: params(query),
      responseType: 'blob',
    })
    const contentType =
      typeof res.headers?.['content-type'] === 'string'
        ? res.headers['content-type']
        : undefined
    const blob =
      res.data instanceof Blob
        ? res.data
        : new Blob([res.data as BlobPart], contentType ? { type: contentType } : undefined)
    const objectUrl = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = filenameFromDisposition(res.headers?.['content-disposition'], fallbackName)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(objectUrl)
  } catch (err: unknown) {
    throw await parseBlobError(err)
  }
}

export function downloadImportTemplate(type: ImportEntityType, format: ImportFileFormat) {
  return downloadBinary(
    `/imports/templates/${type}`,
    { format },
    `template-import-${type}.${format}`,
  )
}

export function downloadImportReport(
  importId: number,
  type: ImportEntityType,
  scope: 'all' | 'errors' = 'all',
) {
  return downloadBinary(
    `/imports/${importId}/report`,
    { scope },
    `laporan-import-${type}-${importId}-${scope}.csv`,
  )
}
