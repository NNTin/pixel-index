import { useEffect, useState } from 'react';

import { listTags } from '../api/client';
import type { TagUsage } from '../api/types';
import {
  DEFAULT_FILTERS,
  describeActiveFilters,
  type Filters,
  isDefault,
  type PetsFilter,
  type SizeBucket,
  type SortKey,
} from '../routes/filters';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'furniture', label: 'Most furniture' },
  { value: 'largest', label: 'Largest' },
  { value: 'title', label: 'Title (A–Z)' },
];

const SIZE_OPTIONS: { value: SizeBucket; label: string }[] = [
  { value: 'small', label: 'Small (up to 15×15)' },
  { value: 'medium', label: 'Medium (16–30)' },
  { value: 'large', label: 'Large (31+)' },
];

export function FilterBar({ filters, onChange }: { filters: Filters; onChange: (next: Filters) => void }) {
  const [text, setText] = useState(filters.q);
  const [tags, setTags] = useState<TagUsage[]>([]);

  // Keep the input in sync when filters change from elsewhere (e.g. "clear
  // filters", or the browser back button) without fighting the user's typing.
  // The rule's preferred shape — deriving the input's value during render —
  // would take the text box away from the user mid-keystroke, which is the
  // thing the debounce below exists to avoid.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setText(filters.q), [filters.q]);

  useEffect(() => {
    const controller = new AbortController();
    listTags(controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setTags(response.tags);
      })
      // The tag picker is a convenience, not core to the page loading — but an
      // *aborted* fetch must not blank an already-populated picker.
      .catch(() => {
        if (controller.signal.aborted) return;
        setTags([]);
      });
    return () => {
      controller.abort();
    };
  }, []);

  // Debounced: a request per keystroke would defeat "stays responsive with
  // a few hundred layouts" the moment someone actually types.
  //
  // `filters` and `onChange` are omitted from the deps deliberately, and that
  // omission is what makes the debounce work: the parent re-renders while a
  // request is in flight, so including `filters` would restart the 300ms timer
  // on every one of those renders and the timeout would never fire. Both are
  // read inside the callback, so the timer that eventually fires uses the
  // render's values — which is correct here, because a filter change from
  // anywhere else re-syncs `text` through the effect above.
  useEffect(() => {
    if (text === filters.q) return;
    const timer = setTimeout(() => onChange({ ...filters, q: text }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  function toggleTag(tag: string) {
    const next = filters.tags.includes(tag) ? filters.tags.filter((t) => t !== tag) : [...filters.tags, tag];
    onChange({ ...filters, tags: next });
  }

  const activeFilters = describeActiveFilters(filters);
  const inputClass = 'border border-border bg-canvas px-3 py-1.5 text-sm text-ink placeholder:text-subtle';
  const selectClass = 'border border-border bg-canvas px-2 py-1.5 text-ink';

  return (
    <div className="mb-6 flex flex-col gap-4 border-2 border-border bg-surface p-4">
      <div className="flex flex-wrap gap-3">
        <input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Search title, description…"
          aria-label="Search layouts"
          className={`min-w-0 flex-1 ${inputClass}`}
        />

        <label className="flex items-center gap-1.5 text-sm text-muted">
          Sort
          <select
            value={filters.sort}
            onChange={(event) => onChange({ ...filters, sort: event.target.value as SortKey })}
            className={selectClass}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-sm text-muted">
          Size
          <select
            value={filters.size ?? ''}
            onChange={(event) =>
              onChange({ ...filters, size: (event.target.value || null) as SizeBucket | null })
            }
            className={selectClass}
          >
            <option value="">Any</option>
            {SIZE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-sm text-muted">
          Pets
          <select
            value={filters.pets ?? ''}
            onChange={(event) =>
              onChange({ ...filters, pets: (event.target.value || null) as PetsFilter | null })
            }
            className={selectClass}
          >
            <option value="">Any</option>
            <option value="has">Has pets</option>
            <option value="none">No pets</option>
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-sm text-muted">
          Furniture
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={filters.minFurniture ?? ''}
            onChange={(event) =>
              onChange({
                ...filters,
                minFurniture: event.target.value === '' ? null : Number(event.target.value),
              })
            }
            placeholder="min"
            aria-label="Minimum furniture count"
            className={`w-16 ${inputClass}`}
          />
          –
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={filters.maxFurniture ?? ''}
            onChange={(event) =>
              onChange({
                ...filters,
                maxFurniture: event.target.value === '' ? null : Number(event.target.value),
              })
            }
            placeholder="max"
            aria-label="Maximum furniture count"
            className={`w-16 ${inputClass}`}
          />
        </label>

        <label className="flex items-center gap-1.5 text-sm text-muted">
          Seats
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={filters.minSeats ?? ''}
            onChange={(event) =>
              onChange({
                ...filters,
                minSeats: event.target.value === '' ? null : Number(event.target.value),
              })
            }
            placeholder="min"
            aria-label="Minimum seat count"
            className={`w-16 ${inputClass}`}
          />
          –
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={filters.maxSeats ?? ''}
            onChange={(event) =>
              onChange({
                ...filters,
                maxSeats: event.target.value === '' ? null : Number(event.target.value),
              })
            }
            placeholder="max"
            aria-label="Maximum seat count"
            className={`w-16 ${inputClass}`}
          />
        </label>
      </div>

      {tags.length > 0 && (
        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className="mb-1 w-full text-sm text-muted sm:w-auto sm:mb-0 sm:mr-1">Tags</legend>
          {tags.map((tag) => {
            const active = filters.tags.includes(tag.name);
            return (
              <button
                key={tag.name}
                type="button"
                aria-pressed={active}
                onClick={() => toggleTag(tag.name)}
                className={`rounded border px-2 py-1 text-xs ${
                  active
                    ? 'border-accent bg-accent-soft text-accent-strong'
                    : 'border-border text-muted hover:border-accent'
                }`}
              >
                {tag.name} ({tag.count})
              </button>
            );
          })}
        </fieldset>
      )}

      {filters.author && (
        <p className="text-sm text-muted">
          Filtered to author: <strong className="text-ink">{filters.authorLabel ?? filters.author}</strong>
        </p>
      )}

      {!isDefault(filters) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="text-xs text-subtle">Active: {activeFilters.join(' · ')}</span>
          <button
            type="button"
            onClick={() => onChange(DEFAULT_FILTERS)}
            className="ml-auto border border-border px-2 py-1 text-xs text-muted hover:border-accent"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
