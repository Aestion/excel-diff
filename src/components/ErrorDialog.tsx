interface ErrorDialogProps {
  title: string;
  message: string;
  onClose: () => void;
}

export default function ErrorDialog({ title, message, onClose }: ErrorDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-96 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-red-500 text-lg">⚠</span>
          <h3 className="text-sm font-bold">{title}</h3>
        </div>
        <p className="text-sm text-gray-600 mb-4 whitespace-pre-wrap">{message}</p>
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
