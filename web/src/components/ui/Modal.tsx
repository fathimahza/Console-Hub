import { X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import type { ReactNode } from 'react'
import { useReturnFocus } from './useReturnFocus'

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  size = 'md',
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description: ReactNode
  size?: 'md' | 'lg'
  children: ReactNode
}) {
  const focus = useReturnFocus()
  const maxWidth = size === 'lg' ? 'max-w-3xl' : 'max-w-md'
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content
          onCloseAutoFocus={focus.onCloseAutoFocus}
          className={`fixed top-[10vh] left-1/2 z-50 flex max-h-[80vh] w-[calc(100%-32px)] ${maxWidth} -translate-x-1/2 flex-col rounded-md border bg-bg shadow-pop`}
        >
          <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
            <div className="flex flex-col gap-0.5">
              <Dialog.Title className="font-semibold">{title}</Dialog.Title>
              <Dialog.Description className="text-xs text-muted">{description}</Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Tutup"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-surface hover:text-fg"
            >
              <X size={16} strokeWidth={1.5} aria-hidden />
            </Dialog.Close>
          </div>
          <div className="overflow-y-auto p-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
