import { useState, useCallback } from "react";
import { useDiffStore } from "../stores/diffStore";
import { computeDiff } from "../utils/diffEngine";
import type { ColumnInfo } from "../types/excel";

interface KeyColumnSelectorProps {
  columns: ColumnInfo[];
  currentKeyIndices: number[];
  onApply: (indices: number[]) => void;
  onClose: () => void;
}

export default function KeyColumnSelector({ columns, currentKeyIndices, onApply, onClose }: KeyColumnSelectorProps) {
  const [selected, setSelected] = useState<number[]>(currentKeyIndices);

  const toggle = useCallback((idx: number) => {
    setSelected((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
    );
  }, []);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-96 p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-3">选择关键列</h3>
        <p className="text-xs text-gray-500 mb-3">
          关键列用于匹配两个版本中的同一条记录。可选择多列组成复合键。
        </p>

        <div className="border rounded max-h-60 overflow-auto mb-4">
          {columns.map((col) => (
            <label
              key={col.index}
              className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b last:border-0"
            >
              <input
                type="checkbox"
                checked={selected.includes(col.index)}
                onChange={() => toggle(col.index)}
                className="rounded"
              />
              <span className="text-sm">{col.name}</span>
              <span className="text-xs text-gray-400 ml-auto">列 {col.index + 1}</span>
            </label>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded"
          >
            取消
          </button>
          <button
            onClick={() => {
              if (selected.length > 0) {
                onApply(selected);
                onClose();
              }
            }}
            disabled={selected.length === 0}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            应用
          </button>
        </div>
      </div>
    </div>
  );
}
