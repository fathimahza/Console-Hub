import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { tokenStore } from '../../lib/api/client'
import type {
  AuthUser,
  DataImportDetail,
  DataImportSummary,
  ImportActiveLock,
  ImportEntityType,
} from '../../lib/api/schemas'
import { rbacUsers, roles } from '../../test/admin'
import { calls, fail, ok, on, page, users } from '../../test/api'
import { renderApp } from '../../test/utils'
import { AuthProvider } from '../auth/auth'
import { ImportAction } from './ImportAction'
import { canImportCreate, canImportUpsert, importKeys } from './queries'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

function makeSummary(overrides: Partial<DataImportSummary> = {}): DataImportSummary {
  return {
    id: 101,
    type: 'barang',
    mode: 'upsert',
    status: 'preview',
    original_filename: 'barang.csv',
    file_format: 'csv',
    total_rows: 3,
    valid_rows: 2,
    create_count: 1,
    update_count: 1,
    skip_count: 1,
    invalid_count: 0,
    processed_rows: 0,
    created_count: 0,
    updated_count: 0,
    skipped_count: 0,
    failed_count: 0,
    cancel_requested: false,
    error_message: null,
    validated_at: '2026-11-27T09:00:00Z',
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    created_at: '2026-11-27T09:00:00Z',
    ...overrides,
  }
}

function makeDetail(overrides: Partial<DataImportDetail> = {}): DataImportDetail {
  return {
    ...makeSummary(overrides),
    plan_rows: overrides.plan_rows ?? [
      {
        row_number: 2,
        action: 'create',
        target_id: null,
        values: { name: 'Benang Sutra', kind: 'benang', quantity: '10', unit: 'roll' },
        diff: null,
        reason: null,
        errors: {},
      },
      {
        row_number: 3,
        action: 'update',
        target_id: 'i-kain',
        values: { id: 'i-kain', name: 'Kain Katun Premium', kind: 'kain' },
        diff: {
          name: { old: 'Kain katun', new: 'Kain Katun Premium' },
        },
        reason: null,
        errors: {},
      },
      {
        row_number: 4,
        action: 'skip',
        target_id: 'i-kardus',
        values: { name: 'Kardus kemasan besar', kind: 'kemasan' },
        diff: null,
        reason: 'Data tidak berubah.',
        errors: {},
      },
    ],
    execution_results: overrides.execution_results ?? [],
  }
}

function importListReply(
  items: DataImportSummary[],
  locks: Partial<Record<ImportEntityType, ImportActiveLock | null>> = {},
) {
  return {
    body: {
      data: items,
      meta: {
        active_locks: {
          users: locks.users ?? null,
          personel: locks.personel ?? null,
          produksi: locks.produksi ?? null,
          barang: locks.barang ?? null,
        },
      },
    },
  }
}

function renderImportHarness(
  customUser: AuthUser,
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  tokenStore.set('test-token-custom')
  on('GET /auth/me', ok(customUser))
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <ImportAction type="barang" title="Barang" />
        </AuthProvider>
      </QueryClientProvider>,
    ),
  }
}

describe('RBAC import permission helpers', () => {
  it('enforces create vs upsert permissions across all 4 entities', () => {
    expect(canImportCreate(null, 'barang')).toBe(false)
    expect(canImportUpsert(null, 'barang')).toBe(false)

    // Admin IT can create & upsert everything
    for (const type of ['users', 'personel', 'produksi', 'barang'] as const) {
      expect(canImportCreate(users.admin, type)).toBe(true)
      expect(canImportUpsert(users.admin, type)).toBe(true)
    }

    // Auditor only has view permissions -> no import access
    for (const type of ['users', 'personel', 'produksi', 'barang'] as const) {
      expect(canImportCreate(users.auditor, type)).toBe(false)
      expect(canImportUpsert(users.auditor, type)).toBe(false)
    }

    // Standard user fixture has barang + produksi create/update, only personel.view
    expect(canImportCreate(users.user, 'barang')).toBe(true)
    expect(canImportUpsert(users.user, 'barang')).toBe(true)
    expect(canImportCreate(users.user, 'produksi')).toBe(true)
    expect(canImportUpsert(users.user, 'produksi')).toBe(true)
    expect(canImportCreate(users.user, 'personel')).toBe(false)
    expect(canImportCreate(users.user, 'users')).toBe(false)

    // Create-only permission allows create_only, blocks upsert
    const createOnly: AuthUser = {
      id: 99,
      name: 'Staf Input',
      email: 'input@example.com',
      role: { code: 'staf_input', name: 'Staf Input' },
      permissions: ['barang.view', 'barang.create'],
    }
    expect(canImportCreate(createOnly, 'barang')).toBe(true)
    expect(canImportUpsert(createOnly, 'barang')).toBe(false)
  })
})

describe('ImportAction page integration', () => {
  it('renders enabled Impor Data on /barang without eager /imports polling', async () => {
    renderApp('/barang', 'user')
    const btn = await screen.findByRole('button', { name: 'Impor Data' })
    expect(btn).toBeEnabled()
    expect(calls.some((c) => c.url === '/imports')).toBe(false)
  })

  it('hides Impor Data on /barang when user lacks barang.create permission', async () => {
    renderApp('/barang', 'auditor')
    await screen.findByText('Kain katun')
    expect(screen.queryByRole('button', { name: 'Impor Data' })).not.toBeInTheDocument()
  })

  it('disables Impor Data on /barang when source console is down', async () => {
    renderApp('/barang', 'user')
    on('GET /items', fail(502, 'SOURCE_UNREACHABLE', 'Gudang down'))
    const btn = await screen.findByRole('button', { name: 'Impor Data' })
    await waitFor(() => {
      expect(btn).toBeDisabled()
    })
  })

  it('mounts Impor Data button on /rbac UsersTab for admin_it', async () => {
    renderApp('/rbac', 'admin')
    on('GET /admin/rbac/users', page(rbacUsers))
    on('GET /admin/rbac/roles', page(roles()))
    on('GET /admin/rbac/permissions', page(users.admin.permissions))

    expect(await screen.findByRole('button', { name: 'Tambah pengguna' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Impor Data' })).toBeEnabled()
  })
})

describe('ImportModal Step 1: mode, lock banner, template downloads, and file validation', () => {
  it('disables upsert without update permission, renders active lock, downloads templates, and validates files', async () => {
    const createOnlyUser: AuthUser = {
      id: 77,
      name: 'Creator Barang',
      email: 'creator@example.com',
      role: { code: 'creator', name: 'Creator' },
      permissions: ['barang.view', 'barang.create'],
    }
    renderImportHarness(createOnlyUser)

    on(
      'GET /imports',
      importListReply([], {
        barang: {
          id: 55,
          type: 'barang',
          status: 'processing',
          requester_name: 'Hendra Wijaya',
          processed_rows: 12,
          total_rows: 40,
          started_at: '2026-11-27T09:10:00Z',
          is_mine: false,
        },
      }),
    )
    on('GET /imports/templates/barang', {
      status: 200,
      body: new Blob(['id,name\n'], { type: 'text/csv' }),
    })

    vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:mock-url')
    vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {})
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await userEvent.click(await screen.findByRole('button', { name: 'Impor Data' }))
    const dialog = await screen.findByRole('dialog', { name: 'Impor Data Barang' })

    // Active lock banner shown
    expect(
      await within(dialog).findByText(/Sedang ada impor Barang yang berjalan/i),
    ).toBeInTheDocument()
    expect(within(dialog).getByText(/Hendra Wijaya/)).toBeInTheDocument()

    // Upsert disabled for create-only user
    const upsertBtn = within(dialog).getByRole('button', { name: /Tambah & Perbarui \(Upsert\)/i })
    expect(upsertBtn).toBeDisabled()

    // Template CSV & XLSX download
    await userEvent.click(within(dialog).getByRole('button', { name: 'Template CSV' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Template XLSX' }))

    await waitFor(() => {
      const templateCalls = calls.filter((c) => c.url === '/imports/templates/barang')
      expect(templateCalls).toHaveLength(2)
      expect(templateCalls.map((c) => c.params.get('format'))).toEqual(['csv', 'xlsx'])
    })
    expect(clickSpy).toHaveBeenCalledTimes(2)

    // Invalid file extension rejected locally without POST /imports/preview
    const fileInput = within(dialog).getByLabelText(/Pilih File Impor/i) as HTMLInputElement
    const badExt = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    fireEvent.change(fileInput, { target: { files: [badExt] } })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Format file harus .csv atau .xlsx.',
    )

    // File > 2 MB rejected locally
    const oversized = new File([new Uint8Array(2 * 1024 * 1024 + 10)], 'besar.csv', {
      type: 'text/csv',
    })
    fireEvent.change(fileInput, { target: { files: [oversized] } })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Ukuran file maksimal 2 MB.')
    expect(calls.some((c) => c.url === '/imports/preview')).toBe(false)
  })
})

describe('ImportModal Step 2 & Step 3: dry-run preview, errors, 409 lock/stale, commit, polling & cancel', () => {
  it('blocks commit when invalid_count > 0, renders diff/filter pills, and downloads CSV error report', async () => {
    renderImportHarness(users.admin)
    on('GET /imports', importListReply([]))
    on('GET /imports/201/report', {
      status: 200,
      body: new Blob(['row,error\n'], { type: 'text/csv' }),
    })

    vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:err-url')
    vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {})
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const badPreview = makeDetail({
      id: 201,
      create_count: 0,
      update_count: 1,
      skip_count: 0,
      invalid_count: 1,
      total_rows: 2,
      valid_rows: 1,
      plan_rows: [
        {
          row_number: 2,
          action: 'update',
          target_id: 'i-kain',
          values: { id: 'i-kain', name: 'Kain Premium' },
          diff: { name: { old: 'Kain katun', new: 'Kain Premium' } },
          reason: null,
          errors: {},
        },
        {
          row_number: 3,
          action: 'invalid',
          target_id: null,
          values: { name: 'X' },
          diff: null,
          reason: 'Nama minimal 3 karakter.',
          errors: { name: 'Nama minimal 3 karakter.' },
        },
      ],
    })

    on('POST /imports/preview', ok(badPreview, 201))
    on('GET /imports/201', ok(badPreview))

    await userEvent.click(await screen.findByRole('button', { name: 'Impor Data' }))
    const dialog = await screen.findByRole('dialog', { name: 'Impor Data Barang' })

    const fileInput = within(dialog).getByLabelText(/Pilih File Impor/i)
    await userEvent.upload(
      fileInput,
      new File(['id,name\ni-kain,Kain Premium\n,X\n'], 'barang.csv', { type: 'text/csv' }),
    )
    await userEvent.click(within(dialog).getByRole('button', { name: /Pratinjau & Validasi/i }))

    // Diff old -> new + error alert + commit disabled
    expect(await within(dialog).findByText('Kain katun')).toBeInTheDocument()
    expect(within(dialog).getByText('Kain Premium')).toBeInTheDocument()
    expect(within(dialog).getByText(/Terdapat 1 baris error — impor diblokir/i)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Jalankan Impor/i })).toBeDisabled()

    // Filter pills filter table to only Error rows
    await userEvent.click(within(dialog).getByRole('button', { name: /Error\s*\(1\)/i }))
    expect(within(dialog).getByText('Nama minimal 3 karakter.')).toBeInTheDocument()
    expect(within(dialog).queryByText('Kain katun')).not.toBeInTheDocument()

    // Unduh Laporan Error (CSV)
    await userEvent.click(
      within(dialog).getByRole('button', { name: /Unduh Laporan Error \(CSV\)/i }),
    )
    await waitFor(() => {
      const reportCall = calls.find((c) => c.url === '/imports/201/report')
      expect(reportCall?.params.get('scope')).toBe('errors')
    })
    expect(clickSpy).toHaveBeenCalled()
  })

  it('handles 409 STALE_PREVIEW -> 1-click revalidate -> 409 RESOURCE_LOCKED -> commit -> poll completed & invalidate caches', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    renderImportHarness(users.admin, qc)

    const validDetail = makeDetail({ id: 301 })
    const processingDetail = makeDetail({
      id: 301,
      status: 'processing',
      processed_rows: 1,
      total_rows: 3,
      started_at: '2026-11-27T09:15:00Z',
    })
    const completedDetail = makeDetail({
      id: 301,
      status: 'completed',
      processed_rows: 3,
      total_rows: 3,
      created_count: 1,
      updated_count: 1,
      skipped_count: 1,
      failed_count: 0,
      started_at: '2026-11-27T09:15:00Z',
      completed_at: '2026-11-27T09:15:05Z',
      execution_results: [
        { row_number: 2, status: 'created', action: 'create', target_id: 'i-new', reason: null },
        { row_number: 3, status: 'updated', action: 'update', target_id: 'i-kain', reason: null },
        {
          row_number: 4,
          status: 'skipped',
          action: 'skip',
          target_id: null,
          reason: 'Data tidak berubah.',
        },
      ],
    })

    let currentDetail = validDetail
    let commitAttempt = 0
    on('GET /imports', importListReply([]))
    on('POST /imports/preview', (c) => {
      expect(c.body).toBeInstanceOf(FormData)
      expect((c.body as FormData).get('type')).toBe('barang')
      expect((c.body as FormData).get('mode')).toBe('upsert')
      return ok(validDetail, 201)
    })
    on('GET /imports/301', () => ok(currentDetail))
    on('POST /imports/301/revalidate', () => ok(validDetail))
    on('POST /imports/301/commit', () => {
      commitAttempt += 1
      if (commitAttempt === 1) {
        return fail(409, 'CONFLICT', 'Snapshot data berubah. Validasi ulang diperlukan.', {
          reason: 'STALE_PREVIEW',
        })
      }
      if (commitAttempt === 2) {
        return fail(409, 'CONFLICT', 'Ada impor aktif.', {
          reason: 'RESOURCE_LOCKED',
          active_import: {
            id: 99,
            type: 'barang',
            status: 'processing',
            requester_name: 'Hendra Wijaya',
            processed_rows: 5,
            total_rows: 10,
            started_at: '2026-11-27T09:14:00Z',
            is_mine: false,
          },
        })
      }
      currentDetail = processingDetail
      return ok(processingDetail, 202)
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Impor Data' }))
    const dialog = await screen.findByRole('dialog', { name: 'Impor Data Barang' })

    // Select upsert mode & upload CSV
    await userEvent.click(within(dialog).getByRole('button', { name: /Tambah & Perbarui \(Upsert\)/i }))
    await userEvent.upload(
      within(dialog).getByLabelText(/Pilih File Impor/i),
      new File(['id,name\n,Benang Sutra\n'], 'barang.csv', { type: 'text/csv' }),
    )
    await userEvent.click(within(dialog).getByRole('button', { name: /Pratinjau & Validasi/i }))

    const commitBtn = await within(dialog).findByRole('button', { name: /Jalankan Impor \(2\)/i })
    expect(commitBtn).toBeEnabled()

    // 1. 409 STALE_PREVIEW -> shows stale banner + disables commit until Validasi Ulang
    await userEvent.click(commitBtn)
    expect(await within(dialog).findByText(/Pratinjau tidak lagi mutakhir/i)).toBeInTheDocument()
    expect(commitBtn).toBeDisabled()

    await userEvent.click(
      within(dialog).getAllByRole('button', { name: /Validasi Ulang/i })[0]!,
    )
    await waitFor(() => {
      expect(calls.some((c) => c.url === '/imports/301/revalidate')).toBe(true)
    })
    expect(commitBtn).toBeEnabled()

    // 2. 409 RESOURCE_LOCKED -> displays lock banner
    await userEvent.click(commitBtn)
    expect(
      await within(dialog).findByText(/Eksekusi impor sedang dikunci oleh impor lain/i),
    ).toBeInTheDocument()

    // 3. Commit succeeds -> processing view
    await userEvent.click(commitBtn)
    expect(await within(dialog).findByText(/Sedang memproses impor/i)).toBeInTheDocument()
    expect(within(dialog).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')

    // 4. Next poll completes -> shows terminal stats + invalidates entity caches
    currentDetail = completedDetail
    await act(async () => {
      await qc.invalidateQueries({ queryKey: importKeys.detail(301) })
    })

    expect(await within(dialog).findByText('Impor selesai')).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: /Unduh Laporan Hasil \(CSV\)/i }),
    ).toBeEnabled()
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['work'] })
  })

  it('supports cooperative cancel and partial conflict error download', async () => {
    renderImportHarness(users.admin)

    const queuedDetail = makeDetail({
      id: 401,
      status: 'processing',
      processed_rows: 1,
      total_rows: 5,
      started_at: '2026-11-27T09:20:00Z',
    })
    let current = queuedDetail
    const cancelRequestedDetail = { ...queuedDetail, cancel_requested: true }

    on('GET /imports', () => importListReply([current]))
    on('GET /imports/401', () => ok(current))
    on('POST /imports/401/cancel', () => {
      current = cancelRequestedDetail
      return ok(cancelRequestedDetail)
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Impor Data' }))
    const dialog = await screen.findByRole('dialog', { name: 'Impor Data Barang' })

    // Open recent active import via "Pantau Progres"
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Pantau Progres' }))
    const cancelBtn = await within(dialog).findByRole('button', { name: 'Batalkan Impor' })
    await userEvent.click(cancelBtn)

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url === '/imports/401/cancel')).toBe(true)
    })
    expect(
      await within(dialog).findByText(/Permintaan pembatalan telah dikirim/i),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Membatalkan...' })).toBeDisabled()
  })
})
