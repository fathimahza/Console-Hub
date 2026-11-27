import { useQueryClient } from '@tanstack/react-query'
import { Plus, Route } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { ActiveStatusDot } from '../../../components/StatusDot'
import { TimeText } from '../../../components/TimeText'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Input'
import { Select } from '../../../components/ui/Select'
import type { Item } from '../../../lib/api/schemas'
import { number } from '../../../lib/format'
import { useCan, useIsAdminView } from '../../../lib/permissions'
import { useUrlState } from '../../../lib/useUrlState'
import { DetailDrawer } from '../DetailDrawer'
import { FormSheet } from '../FormSheet'
import { changed, fieldError, numeric, optional, text } from '../form'
import { ACTIVE_FILTER } from '../labels'
import { ListFrame } from '../ListFrame'
import { Facts, Merged } from '../Merged'
import { RefPicker } from '../pickers'
import { useOptions, useWorkList, workKeys } from '../queries'
import { RowActions } from '../RowActions'
import { RowsTable, type Column } from '../RowsTable'
import { ImportAction } from '../../imports/ImportAction'
import { useDeactivate } from '../useDeactivate'
import { useWrite } from '../useWrite'
import { ExportAction } from '../../reports/ExportAction'

const origin = (i: Item) =>
  i.production ? `${i.production.area} · ${i.production.production_type}` : null
const qty = (i: Item) => `${number(i.quantity)} ${i.unit}`

export function BarangPage() {
  const url = useUrlState()
  const qc = useQueryClient()
  const can = useCan()
  const admin = useIsAdminView()
  const list = useWorkList('items', {
    q: url.get('q'),
    status: url.get('status'),
    kind: url.get('kind'),
  })
  const kinds = useKinds()
  const [editing, setEditing] = useState<Item | 'new' | null>(() =>
    url.get('baru') && can('barang.create') ? 'new' : null,
  )
  const [viewing, setViewing] = useState<Item | null>(null)
  const reload = () => void qc.invalidateQueries({ queryKey: workKeys.root })
  const deactivate = useDeactivate('items', 'barang', reload)

  const columns: Column<Item>[] = [
    { header: 'Nama', cell: (i) => <span className="font-semibold">{i.name}</span> },
    { header: 'Jenis', cell: (i) => i.kind },
    { header: 'Asal produksi', cell: (i) => <Merged id={i.production_id}>{origin(i)}</Merged> },
    {
      header: 'Penanggung jawab',
      cell: (i) => <Merged id={i.responsible_id}>{i.responsible?.name ?? null}</Merged>,
    },
    { header: 'Jumlah', cell: qty, className: 'text-right tabular-nums whitespace-nowrap' },
    { header: 'Status', cell: (i) => <ActiveStatusDot status={i.status} /> },
    ...(admin
      ? [{ header: 'Versi', cell: (i: Item) => i.version, className: 'text-right font-mono' }]
      : []),
  ]

  return (
    <>
      <ListFrame
        title="Barang"
        noun="barang"
        owner="gudang"
        url={url}
        statuses={ACTIVE_FILTER}
        filterKeys={['kind']}
        filters={
          <label className="flex items-center gap-1.5 text-dense">
            <span className="text-muted">Jenis</span>
            <Select
              value={url.get('kind')}
              onChange={(e) => url.set({ kind: e.target.value || null })}
            >
              <option value="">Semua</option>
              {kinds.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </Select>
          </label>
        }
        query={list}
        primary={(writable) => (
          <div className="flex flex-wrap items-center gap-2">
            <ExportAction
              type="barang"
              title="Barang"
              filterSummary={
                url.get('q') || url.get('status') || url.get('kind')
                  ? `Filter aktif: ${[url.get('q') && `Cari "${url.get('q')}"`, url.get('status') && `Status ${url.get('status')}`, url.get('kind') && `Jenis ${url.get('kind')}`].filter(Boolean).join(', ')}`
                  : 'Seluruh inventaris barang'
              }
              filters={{ q: url.get('q'), status: url.get('status'), kind: url.get('kind') }}
            />
            <ImportAction
              type="barang"
              title="Barang"
              disabled={!writable}
              disabledReason="Konsol Gudang sedang tidak dapat ditulis."
            />
            {can('barang.create') ? (
              <Button variant="primary" onClick={() => setEditing('new')} disabled={!writable}>
                <Plus size={16} strokeWidth={1.5} aria-hidden />
                Tambah barang
              </Button>
            ) : null}
          </div>
        )}
        emptyMessage="Belum ada barang. Tambahkan barang pertama untuk mulai mencatat inventaris."
      >
        {(rows, writable) => (
          <RowsTable
            rows={rows}
            columns={columns}
            label={(i) => `Detail ${i.name}`}
            onOpen={setViewing}
            actions={(i) => (
              <RowActions
                name={i.name}
                inactive={i.status === 'nonaktif'}
                canEdit={can('barang.update') && writable}
                canDeactivate={can('barang.delete') && writable}
                onEdit={() => setEditing(i)}
                onDeactivate={() => deactivate.ask({ id: i.id, label: i.name, version: i.version })}
              />
            )}
          />
        )}
      </ListFrame>

      <DetailDrawer
        resource="items"
        row={viewing}
        title={(i) => i.name}
        onClose={() => setViewing(null)}
        footer={(i) =>
          can('lacak.view') ? (
            <Link
              to={`/lacak/${i.id}`}
              className="inline-flex h-control items-center gap-1.5 rounded-sm bg-accent px-3 text-dense font-semibold text-on-accent hover:opacity-90"
            >
              <Route size={16} strokeWidth={1.5} aria-hidden />
              Lacak
            </Link>
          ) : null
        }
      >
        {(i) => (
          <Facts
            rows={[
              ['Jenis', i.kind],
              ['Jumlah', qty(i)],
              ['Asal produksi', <Merged id={i.production_id}>{origin(i)}</Merged>],
              [
                'Penanggung jawab',
                <Merged id={i.responsible_id}>
                  {i.responsible ? `${i.responsible.name} · ${i.responsible.role}` : null}
                </Merged>,
              ],
              ['Status', <ActiveStatusDot status={i.status} />],
              ['Terakhir diubah', <TimeText iso={i.updated_at} />],
              ...(admin
                ? ([
                    ['Versi', <span className="font-mono">v{i.version}</span>],
                    ['ID', <span className="font-mono text-xs break-all">{i.id}</span>],
                  ] as [string, React.ReactNode][])
                : []),
            ]}
          />
        )}
      </DetailDrawer>

      {editing ? (
        <ItemForm
          item={editing === 'new' ? null : editing}
          kinds={kinds}
          onClose={() => {
            setEditing(null)
            if (url.get('baru')) url.set({ baru: null })
          }}
          onReload={() => {
            setEditing(null)
            reload()
          }}
        />
      ) : null}
      {deactivate.dialog}
    </>
  )
}

/** Kinds in use, for the filter and as suggestions in the form. */
function useKinds() {
  const q = useOptions('items')
  return [...new Set(q.data?.map((i) => i.kind) ?? [])].sort((a, b) => a.localeCompare(b, 'id'))
}

function ItemForm({
  item,
  kinds,
  onClose,
  onReload,
}: {
  item: Item | null
  kinds: string[]
  onClose: () => void
  onReload: () => void
}) {
  const write = useWrite('items')
  const err = (k: string) => fieldError(write.outcome, k)

  const submit = (f: FormData) => {
    const values = {
      name: text(f, 'name'),
      kind: text(f, 'kind'),
      production_id: optional(f, 'production_id'),
      responsible_id: optional(f, 'responsible_id'),
      quantity: numeric(f, 'quantity'),
      unit: text(f, 'unit'),
    }
    const opts = {
      success: `${values.name} disimpan`,
      invalidate: [workKeys.root],
      onDone: onClose,
    }
    if (!item) return void write.run({ method: 'POST', url: '/items', data: values }, opts)
    const diff = changed(item, values)
    if (!Object.keys(diff).length) return onClose()
    void write.run(
      {
        method: 'PATCH',
        url: `/items/${item.id}`,
        data: { ...diff, expected_version: item.version },
      },
      opts,
    )
  }

  return (
    <FormSheet
      open
      onClose={onClose}
      title={item ? `Ubah ${item.name}` : 'Tambah barang'}
      submitLabel="Simpan"
      write={write}
      onSubmit={submit}
      onReload={onReload}
    >
      <Field
        label="Nama"
        name="name"
        required
        autoFocus
        defaultValue={item?.name}
        error={err('name')}
      />
      <Field
        label="Jenis"
        name="kind"
        required
        list="item-kinds"
        defaultValue={item?.kind}
        hint="Pilih dari saran atau ketik jenis baru, mis. kain, besi, buku."
        error={err('kind')}
      />
      <datalist id="item-kinds">
        {kinds.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
      <RefPicker
        kind="productions"
        label="Asal produksi"
        name="production_id"
        value={
          item?.production_id
            ? { id: item.production_id, label: item.production ? origin(item)! : 'Data saat ini' }
            : null
        }
        error={err('production_id')}
      />
      <RefPicker
        kind="people"
        label="Penanggung jawab"
        name="responsible_id"
        value={
          item?.responsible_id
            ? { id: item.responsible_id, label: item.responsible?.name ?? 'Data saat ini' }
            : null
        }
        error={err('responsible_id')}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Jumlah"
          name="quantity"
          required
          inputMode="numeric"
          defaultValue={item?.quantity ?? 0}
          error={err('quantity')}
        />
        <Field
          label="Satuan"
          name="unit"
          required
          defaultValue={item?.unit ?? 'pcs'}
          hint="mis. pcs, kg, m, kaleng"
          error={err('unit')}
        />
      </div>
    </FormSheet>
  )
}
