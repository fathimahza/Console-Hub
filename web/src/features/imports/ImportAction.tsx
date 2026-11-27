import { useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import type { ImportEntityType } from '../../lib/api/schemas'
import { useAuth } from '../auth/auth'
import { ImportModal } from './ImportModal'
import { canImportCreate } from './queries'

export function ImportAction({
  type,
  title,
  disabled = false,
  disabledReason = 'Sumber data sedang tidak dapat ditulis.',
  label = 'Impor Data',
}: {
  type: ImportEntityType
  title: string
  disabled?: boolean
  disabledReason?: string
  label?: string
}) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)

  if (!canImportCreate(user, type)) return null

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={disabled}
        title={disabled ? disabledReason : `Impor data ${title} dari file CSV atau XLSX`}
        onClick={() => setOpen(true)}
      >
        <Upload size={15} strokeWidth={1.7} aria-hidden />
        <span>{label}</span>
      </Button>

      <ImportModal open={open} onOpenChange={setOpen} type={type} title={title} />
    </>
  )
}
