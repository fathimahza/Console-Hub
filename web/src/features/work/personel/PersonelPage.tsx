import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { ActiveStatusDot } from '../../../components/StatusDot'
import { TimeText } from '../../../components/TimeText'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Input'
import type { Person } from '../../../lib/api/schemas'
import { useCan, useIsAdminView } from '../../../lib/permissions'
import { useUrlState } from '../../../lib/useUrlState'
import { DetailDrawer } from '../DetailDrawer'
import { FormSheet } from '../FormSheet'
import { changed, fieldError, text } from '../form'
import { ACTIVE_FILTER } from '../labels'
import { ListFrame } from '../ListFrame'
import { Facts } from '../Merged'
import { useWorkList, workKeys } from '../queries'
import { RowActions } from '../RowActions'
import { RowsTable, type Column } from '../RowsTable'
import { ImportAction } from '../../imports/ImportAction'
import { useDeactivate } from '../useDeactivate'
import { useWrite } from '../useWrite'

// "Dipakai oleh" in the drawer (update 2 §4.1.4) is optional and only shown when the backend
// sends it; the contract has no such field yet, so nothing is rendered for it.

export function PersonelPage() {
  const url = useUrlState()
  const qc = useQueryClient()
  const can = useCan()
  const admin = useIsAdminView()
  const list = useWorkList('people', { q: url.get('q'), status: url.get('status') })
  const [editing, setEditing] = useState<Person | 'new' | null>(null)
  const [viewing, setViewing] = useState<Person | null>(null)
  const reload = () => void qc.invalidateQueries({ queryKey: workKeys.root })
  const deactivate = useDeactivate('people', 'personel', reload)

  const columns: Column<Person>[] = [
    { header: 'Nama', cell: (p) => <span className="font-semibold">{p.name}</span> },
    { header: 'Role', cell: (p) => p.role },
    { header: 'Status', cell: (p) => <ActiveStatusDot status={p.status} /> },
    ...(admin
      ? [{ header: 'Versi', cell: (p: Person) => p.version, className: 'text-right font-mono' }]
      : []),
  ]

  return (
    <>
      <ListFrame
        title="Personel"
        noun="personel"
        owner="hr"
        url={url}
        statuses={ACTIVE_FILTER}
        query={list}
        primary={(writable) =>
          can('personel.create') ? (
            <div className="flex flex-wrap items-center gap-2">
              <ImportAction
                type="personel"
                title="Personel"
                disabled={!writable}
                disabledReason="Konsol HR sedang tidak dapat ditulis."
              />
              <Button variant="primary" onClick={() => setEditing('new')} disabled={!writable}>
                <Plus size={16} strokeWidth={1.5} aria-hidden />
                Tambah personel
              </Button>
            </div>
          ) : null
        }
        emptyMessage="Belum ada personel. Tambahkan orang yang menjalankan alur distribusi, mis. kurir atau staf gudang."
      >
        {(rows, writable) => (
          <RowsTable
            rows={rows}
            columns={columns}
            label={(p) => `Detail ${p.name}`}
            onOpen={setViewing}
            actions={(p) => (
              <RowActions
                name={p.name}
                inactive={p.status === 'nonaktif'}
                canEdit={can('personel.update') && writable}
                canDeactivate={can('personel.delete') && writable}
                onEdit={() => setEditing(p)}
                onDeactivate={() => deactivate.ask({ id: p.id, label: p.name, version: p.version })}
              />
            )}
          />
        )}
      </ListFrame>

      <DetailDrawer
        resource="people"
        row={viewing}
        title={(p) => p.name}
        onClose={() => setViewing(null)}
      >
        {(p) => (
          <Facts
            rows={[
              ['Role', p.role],
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
        <PersonForm
          person={editing === 'new' ? null : editing}
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

function PersonForm({
  person,
  onClose,
  onReload,
}: {
  person: Person | null
  onClose: () => void
  onReload: () => void
}) {
  const write = useWrite('people')
  const err = (k: string) => fieldError(write.outcome, k)

  const submit = (f: FormData) => {
    const values = { name: text(f, 'name'), role: text(f, 'role') }
    const opts = {
      success: `${values.name} disimpan`,
      invalidate: [workKeys.root],
      onDone: onClose,
    }
    if (!person) return void write.run({ method: 'POST', url: '/people', data: values }, opts)
    const diff = changed(person, values)
    if (!Object.keys(diff).length) return onClose()
    void write.run(
      {
        method: 'PATCH',
        url: `/people/${person.id}`,
        data: { ...diff, expected_version: person.version },
      },
      opts,
    )
  }

  return (
    <FormSheet
      open
      onClose={onClose}
      title={person ? `Ubah ${person.name}` : 'Tambah personel'}
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
        defaultValue={person?.name}
        error={err('name')}
      />
      <Field
        label="Role"
        name="role"
        required
        defaultValue={person?.role}
        hint="Peran dalam alur distribusi, mis. Kurir, Staf Gudang."
        error={err('role')}
      />
    </FormSheet>
  )
}
