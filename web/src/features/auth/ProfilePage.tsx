import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { PageHeader, Panel } from '../../components/PageHeader'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Input'
import { Spinner } from '../../components/ui/Spinner'
import { ApiError } from '../../lib/api/client'
import type { AuthUser } from '../../lib/api/schemas'
import { describeError } from '../../lib/errors'
import { useAuth } from './auth'

function validateUsername(value: string): string | undefined {
  if (value === '') return 'Username wajib diisi.'
  const hasSpace = /\s/.test(value)
  const hasUpper = value !== value.toLowerCase() || /[A-Z]/.test(value)
  if (hasSpace && hasUpper) {
    return 'Username tidak boleh mengandung huruf kapital (Caps Lock) atau spasi.'
  }
  if (hasSpace) return 'Username tidak boleh mengandung spasi.'
  if (hasUpper) return 'Username tidak boleh mengandung huruf kapital (Caps Lock).'
  if (value.length < 3) return 'Username minimal 3 karakter.'
  if (value.length > 100) return 'Username maksimal 100 karakter.'
  return undefined
}

function liveFormatError(value: string): string | undefined {
  if (/\s/.test(value) || value !== value.toLowerCase() || /[A-Z]/.test(value)) {
    return validateUsername(value)
  }
  return undefined
}

function ProfileForm({
  user,
  onSave,
  onBack,
}: {
  user: AuthUser
  onSave: (input: { name: string }) => Promise<AuthUser>
  onBack: () => void
}) {
  const [name, setName] = useState(user.name)
  const [fieldError, setFieldError] = useState<string | undefined>()
  const [formError, setFormError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)

  const unchanged = name === user.name

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFieldError(undefined)
    setFormError(undefined)

    const validationError = validateUsername(name)
    if (validationError) {
      setFieldError(validationError)
      return
    }

    setSaving(true)
    try {
      await onSave({ name })
      toast.success('Username profil berhasil diperbarui.')
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        const msg = err.fields.name?.[0]
        if (msg) {
          setFieldError(msg)
        } else {
          setFormError(`${describeError(err, true).title}: ${err.message}`)
        }
        toast.error(err.message)
      } else {
        setFormError('Gagal memperbarui profil. Silakan coba lagi.')
        toast.error('Gagal memperbarui profil.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel className="max-w-lg p-5">
      <form onSubmit={(e) => void handleSubmit(e)} noValidate className="flex flex-col gap-4">
        <div className="flex items-center justify-between rounded-md border bg-surface/50 px-3 py-2 text-dense">
          <span className="text-muted">Peran</span>
          <span className="font-semibold text-fg">{user.role.name}</span>
        </div>

        <Field
          label="Username"
          name="name"
          required
          minLength={3}
          maxLength={100}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={name}
          onChange={(e) => {
            const next = e.target.value
            setName(next)
            setFieldError(liveFormatError(next))
          }}
          error={fieldError}
          hint="Minimal 3 karakter, huruf kecil semua dan tanpa spasi (contoh: nabilkencana20)."
        />

        {formError ? (
          <p role="alert" className="text-dense text-error">
            {formError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 border-t pt-3">
          <Button type="button" onClick={onBack} disabled={saving}>
            Kembali
          </Button>
          <Button type="submit" variant="primary" disabled={saving || unchanged}>
            {saving ? <Spinner /> : null}
            {saving ? 'Menyimpan…' : 'Simpan Perubahan'}
          </Button>
        </div>
      </form>
    </Panel>
  )
}

export function ProfilePage() {
  const { user, updateProfile } = useAuth()
  const navigate = useNavigate()

  if (!user) return null

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Profil" meta="Kelola username tampilan akun Anda." />
      <ProfileForm
        key={user.name}
        user={user}
        onSave={updateProfile}
        onBack={() => void navigate('/')}
      />
    </div>
  )
}
