"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import type { FundamentalRow } from "@/lib/types";

/**
 * Two sections: auto-pulled standard metrics (`source = 'auto'`, read-only)
 * and user-tracked custom metrics (`source = 'manual'`, editable inline —
 * add/edit/remove a key-value pair against `PATCH`/`DELETE
 * /api/fundamentals/[stockId]`). Follows `RunJarvisButton`'s
 * fetch-then-`router.refresh()` pattern rather than holding its own copy of
 * the list: on success, the parent server component re-fetches
 * `fundamentals` and this component re-renders from the new props.
 */
export function FundamentalsPanel({
  stockId,
  autoFundamentals,
  manualFundamentals,
}: {
  stockId: string;
  autoFundamentals: FundamentalRow[];
  manualFundamentals: FundamentalRow[];
}) {
  const router = useRouter();

  const newKeyId = useId();
  const newValueId = useId();

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upsert(metricKey: string, metricValue: string) {
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/fundamentals/${stockId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metric_key: metricKey,
          metric_value: metricValue,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message =
          (payload && typeof payload.error === "string" && payload.error) ||
          "Something went wrong. Please try again.";
        setError(message);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Network error. Please try again.");
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function remove(metricKey: string) {
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch(
        `/api/fundamentals/${stockId}?key=${encodeURIComponent(metricKey)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message =
          (payload && typeof payload.error === "string" && payload.error) ||
          "Something went wrong. Please try again.";
        setError(message);
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAdd() {
    const key = newKey.trim();
    const value = newValue.trim();
    if (!key || !value) {
      return;
    }
    const ok = await upsert(key, value);
    if (ok) {
      setNewKey("");
      setNewValue("");
    }
  }

  async function handleSaveEdit(metricKey: string) {
    const value = editingValue.trim();
    if (!value) {
      return;
    }
    const ok = await upsert(metricKey, value);
    if (ok) {
      setEditingKey(null);
      setEditingValue("");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-on-surface/80">
          Fundamentals
        </h3>
        {autoFundamentals.length === 0 ? (
          <p className="text-sm text-on-surface/50">
            No fundamentals pulled yet.
          </p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            {autoFundamentals.map((row) => (
              <div
                key={row.metric_key}
                className="flex items-center justify-between gap-2 rounded-lg bg-surface-container-low px-3 py-2"
              >
                <dt className="text-xs text-on-surface/60">
                  {row.metric_key}
                </dt>
                <dd className="text-sm font-medium text-on-surface">
                  {row.metric_value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-on-surface/80">
          Your metrics
        </h3>
        {manualFundamentals.length === 0 ? (
          <p className="text-sm text-on-surface/50">
            No custom metrics yet. Add one below.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {manualFundamentals.map((row) => (
              <div
                key={row.metric_key}
                className="flex items-center justify-between gap-2 rounded-lg bg-surface-container-low px-3 py-2"
              >
                <span className="text-xs text-on-surface/60">
                  {row.metric_key}
                </span>
                {editingKey === row.metric_key ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      autoFocus
                      value={editingValue}
                      onChange={(event) =>
                        setEditingValue(event.target.value)
                      }
                      className="h-7 w-28 rounded-md bg-surface-container-highest px-2 text-sm text-on-surface outline-none"
                    />
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => handleSaveEdit(row.metric_key)}
                      className="text-xs font-medium text-primary disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingKey(null);
                        setEditingValue("");
                      }}
                      className="text-xs font-medium text-on-surface/50 hover:text-on-surface"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-on-surface">
                      {row.metric_value}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingKey(row.metric_key);
                        setEditingValue(row.metric_value);
                      }}
                      className="text-xs font-medium text-on-surface/50 hover:text-on-surface"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => remove(row.metric_key)}
                      className="text-xs font-medium text-error/80 hover:text-error disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-1 flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <label
              htmlFor={newKeyId}
              className="text-xs text-on-surface/50"
            >
              Metric name
            </label>
            <input
              id={newKeyId}
              type="text"
              value={newKey}
              onChange={(event) => setNewKey(event.target.value)}
              placeholder="e.g. Custom P/S"
              className="h-9 rounded-lg bg-surface-container-highest px-2.5 text-sm text-on-surface outline-none placeholder:text-on-surface/40"
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label
              htmlFor={newValueId}
              className="text-xs text-on-surface/50"
            >
              Value
            </label>
            <input
              id={newValueId}
              type="text"
              value={newValue}
              onChange={(event) => setNewValue(event.target.value)}
              placeholder="e.g. 4.2"
              className="h-9 rounded-lg bg-surface-container-highest px-2.5 text-sm text-on-surface outline-none placeholder:text-on-surface/40"
            />
          </div>
          <button
            type="button"
            disabled={isSubmitting || !newKey.trim() || !newValue.trim()}
            onClick={handleAdd}
            className={cn(
              "h-9 shrink-0 rounded-lg bg-primary/10 px-3 text-sm font-medium text-primary transition-opacity",
              "disabled:opacity-40",
            )}
          >
            Add
          </button>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
