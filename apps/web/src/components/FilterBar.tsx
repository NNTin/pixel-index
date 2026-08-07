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
  useEffect(() => setText(filters.q), [filters.q]);

  useEffect(() => {
    listTags()
      .then((response) => setTags(response.tags))
      .catch(() => setTags([])); // The tag picker is a convenience, not core to the page loading.
  }, []);

  // Debounced: a request per keystroke would defeat "stays responsive with
  // a few hundred layouts" the moment someone actually types.
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

  return (
    <div className="mb-6 flex flex-col gap-4 border-2 border-slate-800 bg-slate-900 p-4">
      <div className="flex flex-wrap gap-3">
        <input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Search title, description…"
          aria-label="Search layouts"
          className="min-w-0 flex-1 border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm placeholder:text-slate-500"
        />

        <label className="flex items-center gap-1.5 text-sm text-slate-400">
          Sort
          <select
            value={filters.sort}
            onChange={(event) => onChange({ ...filters, sort: event.target.value as SortKey })}
            className="border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-sm text-slate-400">
          Size
          <select
            value={filters.size ?? ''}
            onChange={(event) =>
              onChange({ ...filters, size: (event.target.value || null) as SizeBucket | null })
            }
            className="border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100"
          >
            <option value="">Any</option>
            {SIZE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-sm text-slate-400">
          Pets
          <select
            value={filters.pets ?? ''}
            onChange={(event) =>
              onChange({ ...filters, pets: (event.target.value || null) as PetsFilter | null })
            }
            className="border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100"
          >
            <option value="">Any</option>
            <option value="has">Has pets</option>
            <option value="none">No pets</option>
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-sm text-slate-400">
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
            className="w-16 border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100"
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
            className="w-16 border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100"
          />
        </label>
      </div>

      {tags.length > 0 && (
        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className="mb-1 w-full text-sm text-slate-400 sm:w-auto sm:mb-0 sm:mr-1">Tags</legend>
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
                    ? 'border-sky-500 bg-sky-500/20 text-sky-300'
                    : 'border-slate-700 text-slate-400 hover:border-slate-500'
                }`}
              >
                {tag.name} ({tag.count})
              </button>
            );
          })}
        </fieldset>
      )}

      {filters.author && (
        <p className="text-sm text-slate-400">
          Filtered to author: <strong className="text-slate-200">{filters.authorLabel ?? filters.author}</strong>
        </p>
      )}

      {!isDefault(filters) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
          <span className="text-xs text-slate-500">Active: {activeFilters.join(' · ')}</span>
          <button
            type="button"
            onClick={() => onChange(DEFAULT_FILTERS)}
            className="ml-auto border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
