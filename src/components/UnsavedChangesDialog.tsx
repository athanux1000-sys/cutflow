interface UnsavedChangesDialogProps {
  open: boolean;
  title?: string;
  description?: string;
  onSaveAndClose: () => void;
  onDiscard?: () => void;
  onCancel: () => void;
}

export function UnsavedChangesDialog({
  open,
  title = 'Unsaved Changes',
  description = 'You have unsaved edits in this project. Save your changes before closing?',
  onSaveAndClose,
  onDiscard,
  onCancel,
}: UnsavedChangesDialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsaved-dialog-title"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#121418] p-6 space-y-5 shadow-2xl">
        <div className="space-y-1.5">
          <h2 id="unsaved-dialog-title" className="text-base font-semibold text-slate-900 dark:text-[#F4F5F7]">
            {title}
          </h2>
          <p className="text-sm text-slate-600 dark:text-[#8E95A5]">{description}</p>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-2 rounded-md text-sm font-medium text-slate-700 dark:text-[#8E95A5] hover:bg-slate-100 dark:hover:bg-white/6 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          {onDiscard && (
            <button
              type="button"
              onClick={onDiscard}
              className="px-3.5 py-2 rounded-md text-sm font-medium text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
            >
              Discard
            </button>
          )}
          <button
            type="button"
            onClick={onSaveAndClose}
            className="px-4 py-2 rounded-md text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white transition-colors cursor-pointer"
          >
            Save and Close
          </button>
        </div>
      </div>
    </div>
  );
}
