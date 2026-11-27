import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { calls, fail, ok, on, users } from '../../test/api'
import { renderApp } from '../../test/utils'

describe('ProfilePage', () => {
  it('validates username length, uppercase (Caps Lock), and spaces client-side before calling backend', async () => {
    renderApp('/profile', 'user')

    const input = await screen.findByLabelText(/Username/i)
    expect(input).toHaveValue(users.user.name)
    expect(screen.getByText('User')).toBeInTheDocument()

    // Minimum length check
    await userEvent.clear(input)
    await userEvent.type(input, 'ab')
    await userEvent.click(screen.getByRole('button', { name: /Simpan Perubahan/i }))
    expect(await screen.findByText(/Username minimal 3 karakter/i)).toBeInTheDocument()

    // Uppercase / Caps Lock check (immediate validation + submit blocked)
    await userEvent.clear(input)
    await userEvent.type(input, 'Nabil')
    expect(
      await screen.findByText(/Username tidak boleh mengandung huruf kapital/i),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Simpan Perubahan/i }))

    // Whitespace check (immediate validation + submit blocked)
    await userEvent.clear(input)
    await userEvent.type(input, 'nabil kencana')
    expect(await screen.findByText(/Username tidak boleh mengandung spasi/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Simpan Perubahan/i }))

    // Both uppercase and space check
    await userEvent.clear(input)
    await userEvent.type(input, 'Nabil Kencana')
    expect(
      await screen.findByText(/Username tidak boleh mengandung huruf kapital \(Caps Lock\) atau spasi/i),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Simpan Perubahan/i }))

    expect(calls.some((c) => c.method === 'PATCH' && c.url === '/auth/profile')).toBe(false)
  })

  it('updates username via PATCH /auth/profile and reflects in UserMenu and UserHomePage', async () => {
    renderApp('/profile', 'user')
    on('PATCH /auth/profile', (c) =>
      ok({
        ...users.user,
        name: String((c.body as { name?: string }).name ?? ''),
      }),
    )

    const input = await screen.findByLabelText(/Username/i)
    await userEvent.clear(input)
    await userEvent.type(input, 'nabilkencana20')
    await userEvent.click(screen.getByRole('button', { name: /Simpan Perubahan/i }))

    await waitFor(() => {
      expect(
        calls.some(
          (c) =>
            c.method === 'PATCH' &&
            c.url === '/auth/profile' &&
            (c.body as { name?: string }).name === 'nabilkencana20',
        ),
      ).toBe(true)
    })

    expect(
      await screen.findByRole('button', { name: /Menu pengguna: nabilkencana20/i }),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^Kembali$/i }))
    expect(await screen.findByRole('heading', { name: /Halo, nabilkencana20/i })).toBeInTheDocument()
  })

  it('works for Admin IT shell and surfaces backend validation errors', async () => {
    renderApp('/profile', 'admin')
    on(
      'PATCH /auth/profile',
      fail(422, 'VALIDATION_ERROR', 'Input tidak valid.', {
        fields: { name: ['Username tidak diperbolehkan.'] },
      }),
    )

    expect(await screen.findByRole('heading', { level: 1, name: 'Profil' })).toBeInTheDocument()
    const input = screen.getByLabelText(/Username/i)
    await userEvent.clear(input)
    await userEvent.type(input, 'adminbaru20')
    await userEvent.click(screen.getByRole('button', { name: /Simpan Perubahan/i }))

    expect(await screen.findByText('Username tidak diperbolehkan.')).toBeInTheDocument()
  })
})
