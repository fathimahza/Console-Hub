import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { ActiveStatusDot } from '../../../components/StatusDot'
import { TimeText } from '../../../components/TimeText'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Input'
import type { Production } from '../../../lib/api/schemas'
import { useCan, useIsAdminView } from '../../../lib/permissions'
import { useUrlState } from '../../../lib/useUrlState'
import { DetailDrawer } from '../DetailDrawer'
import { FormSheet } from '../FormSheet'
import { changed, fieldError, optional, text } from '../form'
import { ACTIVE_FILTER } from '../labels'
import { ListFrame } from '../ListFrame'
import { Facts, Merged } from '../Merged'
import { RefPicker } from '../pickers'
import { useWorkList, workKeys } from '../queries'
import { RowActions } from '../RowActions'
import { RowsTable, type Column } from '../RowsTable'
import { ImportAction } from '../../imports/ImportAction'
import { useDeactivate } from '../useDeactivate'
import { useWrite } from '../useWrite'

const label = (p: Production) => `${p.area} · ${p.production_type}`

export function ProduksiPage() {
  const url = useUrlState()
  const qc = useQueryClient()
  const can = useCan()
  const admin = useIsAdminView()
  const list = useWorkList('productions', { q: url.get('q'), status: url.get('status') })
  const [editing, setEditing] = useState<Production | 'new' | null>(null)
  const [viewing, setViewing] = useState<Production | null>(null)
  const reload = () => void qc.invalidateQueries({ queryKey: workKeys.root })
  const deactivate = useDeactivate('productions', 'produksi', reload)

  const columns: Column<Production>[] = [
    { header: 'Area', cell: (p) => <span className="font-semibold">{p.area}</span> },
    { header: 'Jenis produksi', cell: (p) => p.production_type },
    {
      header: 'Pengantar',
      cell: (p) => <Merged id={p.courier_id}>{p.courier?.name ?? null}</Merged>,
    },
    { header: 'Status', cell: (p) => <ActiveStatusDot status={p.status} /> },
    ...(admin
      ? [{ header: 'Versi', cell: (p: Production) => p.version, className: 'text-right font-mono' }]
      : []),
  ]

  return (
    <>
      <ListFrame
        title="Produksi"
        noun="produksi"
        owner="produksi"
        url={url}
        statuses={ACTIVE_FILTER}
        query={list}
        primary={(writable) =>
          can('produksi.create') ? (
            <div className="flex flex-wrap items-center gap-2">
              <ImportAction
                type="produksi"
                title="Produksi"
                disabled={!writable}
                disabledReason="Konsol Produksi sedang tidak dapat ditulis."
              />
              <Button variant="primary" onClick={() => setEditing('new')} disabled={!writable}>
                <Plus size={16} strokeWidth={1.5} aria-hidden />
                Tambah produksi
              </Button>
            </div>
          ) : null
        }
        emptyMessage="Belum ada data produksi. Tambahkan area dan jenis produksi yang memasok gudang."
      >
        {(rows, writable) => (
          <RowsTable
            rows={rows}
            columns={columns}
            label={(p) => `Detail ${label(p)}`}
            onOpen={setViewing}
            actions={(p) => (
              <RowActions
                name={label(p)}
                inactive={p.status === 'nonaktif'}
                canEdit={can('produksi.update') && writable}
                canDeactivate={can('produksi.delete') && writable}
                onEdit={() => setEditing(p)}
                onDeactivate={() =>
                  deactivate.ask({ id: p.id, label: label(p), version: p.version })
                }
              />
            )}
          />
        )}
      </ListFrame>

      <DetailDrawer
        resource="productions"
        row={viewing}
        title={label}
        onClose={() => setViewing(null)}
      >
        {(p) => (
          <Facts
            rows={[
              ['Area', p.area],
              ['Jenis produksi', p.production_type],
              [
                'Pengantar',
                <Merged id={p.courier_id}>
                  {p.courier ? `${p.courier.name} · ${p.courier.role}` : null}
                </Merged>,
              ],
              ['Status', <ActiveStatusDot status={p.status} />],
              ['Terakhir diubah', <TimeText iso={p.updated_at} />],
              ...(admin
                ? ([
                    ['Versi', <span className="font-mono">v{p.version}</span>],
                    ['ID', <span className="font-mono text-xs break-all">{p.id}</span>],
                  ] as [string, React.ReactNode][])
                : []),
            ]}
          />
        )}
      </DetailDrawer>

      {editing ? (
        <ProductionForm
          production={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
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

function ProductionForm({
  production,
  onClose,
  onReload,
}: {
  production: Production | null
  onClose: () => void
  onReload: () => void
}) {
  const write = useWrite('productions')
  const err = (k: string) => fieldError(write.outcome, k)

  const submit = (f: FormData) => {
    const values = {
      area: text(f, 'area'),
      production_type: text(f, 'production_type'),
      courier_id: optional(f, 'courier_id'),
    }
    const opts = {
      success: `${values.area} · ${values.production_type} disimpan`,
      invalidate: [workKeys.root],
      onDone: onClose,
    }
    if (!production)
      return void write.run({ method: 'POST', url: '/productions', data: values }, opts)
    const diff = changed(production, values)
    if (!Object.keys(diff).length) return onClose()
    void write.run(
      {
        method: 'PATCH',
        url: `/productions/${production.id}`,
        data: { ...diff, expected_version: production.version },
      },
      opts,
    )
  }

  return (
    <FormSheet
      open
      onClose={onClose}
      title={production ? `Ubah ${label(production)}` : 'Tambah produksi'}
      submitLabel="Simpan"
      write={write}
      onSubmit={submit}
      onReload={onReload}
    >
      <Field
        label="Area"
        name="area"
        required
        autoFocus
        defaultValue={production?.area}
        hint="mis. Area Tekstil A"
        error={err('area')}
      />
      <Field
        label="Jenis produksi"
        name="production_type"
        required
        defaultValue={production?.production_type}
        hint="mis. Tenun, Pengecoran"
        error={err('production_type')}
      />
      <RefPicker
        kind="people"
        label="Pengantar"
        name="courier_id"
        value={
          production?.courier_id
            ? { id: production.courier_id, label: production.courier?.name ?? 'Data saat ini' }
            : null
        }
        error={err('courier_id')}
      />
    </FormSheet>
  )
}
