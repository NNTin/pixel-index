import { useMemo } from 'react';

import { API_BASE_URL, getApiInfo, getOpenApiSpec } from '../api/client';
import {
  bodyFields,
  describeSchema,
  type HttpMethod,
  type OpenApiOperation,
  type OpenApiPathItem,
  operationsOf,
} from '../api/openapi';
import type { ApiInfo } from '../api/types';
import { useApi } from '../api/useApi';
import { ErrorNotice } from '../components/ErrorNotice';

/**
 * Publicly available to everyone, logged in or not — same as the Discord
 * invite in Layout.tsx's Nav, this is the opposite of gated. It only reads
 * from `GET /` and `GET /openapi.json`, both public per #6/#32.
 */
export function DeveloperPage() {
  const infoState = useApi((signal) => getApiInfo(signal), []);
  const specState = useApi((signal) => getOpenApiSpec(signal), []);

  const groups = useMemo(() => {
    if (specState.status !== 'ready') return null;
    const byGroup = new Map<string, [string, OpenApiPathItem][]>();
    for (const [path, item] of Object.entries(specState.data.paths)) {
      const label = groupLabel(path);
      const entries = byGroup.get(label) ?? [];
      entries.push([path, item]);
      byGroup.set(label, entries);
    }
    return GROUP_ORDER
      .map((label): [string, [string, OpenApiPathItem][]] | null => {
        const entries = byGroup.get(label);
        return entries ? [label, entries.sort(([a], [b]) => a.localeCompare(b))] : null;
      })
      .filter((entry): entry is [string, [string, OpenApiPathItem][]] => entry !== null);
  }, [specState]);

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-2xl text-ink">Developer API</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Every layout in the index is available through a public read API — no authentication
          required. Third-party integration is strongly encouraged: build a bot, a browser
          extension, a companion tool, whatever helps the community. Have an idea? Open an issue
          or a pull request on{' '}
          <a
            href="https://github.com/pixel-agents-hq/pixel-index"
            target="_blank"
            rel="noreferrer"
            className="text-accent underline"
          >
            GitHub
          </a>
          .
        </p>
      </header>

      {infoState.status === 'error' && <ErrorNotice error={infoState.error} />}
      {infoState.status === 'ready' && <InfoCards info={infoState.data} />}

      <section className="mt-10">
        <h2 className="mb-4 font-display text-lg text-ink">API reference</h2>
        {specState.status === 'loading' && <p className="text-muted">Loading API reference…</p>}
        {specState.status === 'error' && <ErrorNotice error={specState.error} />}
        {groups?.map(([label, entries]) => (
          <div key={label} className="mb-8">
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted">{label}</h3>
            <div className="space-y-2">
              {entries.map(([path, item]) =>
                operationsOf(item).map(({ method, operation }) => (
                  <OperationRow key={`${method} ${path}`} method={method} path={path} operation={operation} />
                )),
              )}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function InfoCards({ info }: { info: ApiInfo }) {
  const commitUrl = info.commit ? `${info.repository}/commit/${info.commit}` : undefined;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <InfoCard label="Base URL" value={API_BASE_URL} />
      <InfoCard label="Version" value={info.version} />
      <InfoCard label="Commit" value={info.commit ? info.commit.slice(0, 7) : 'unknown'} href={commitUrl} />
      <InfoCard label="Interactive docs" value="Swagger UI ↗" href={info.documentation} />
    </div>
  );
}

function InfoCard({ label, value, href }: { label: string; value: string; href?: string | undefined }) {
  return (
    <div className="rounded-lg border-2 border-border bg-surface p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-sm text-accent underline decoration-dotted"
        >
          {value}
        </a>
      ) : (
        <p className="font-mono text-sm text-ink">{value}</p>
      )}
    </div>
  );
}

const METHOD_STYLES: Record<HttpMethod, string> = {
  get: 'bg-accent-soft text-accent',
  post: 'bg-warning-soft text-warning-strong',
  put: 'bg-warning-soft text-warning-strong',
  patch: 'bg-warning-soft text-warning-strong',
  delete: 'bg-danger-soft text-danger',
};

function OperationRow({
  method,
  path,
  operation,
}: {
  method: HttpMethod;
  path: string;
  operation: OpenApiOperation;
}) {
  const parameters = operation.parameters ?? [];
  const requestSchema = operation.requestBody?.content?.['application/json']?.schema;
  const fields = bodyFields(requestSchema);
  const responses = Object.entries(operation.responses ?? {});

  return (
    <details className="group rounded-lg border-2 border-border bg-surface p-3 open:pb-4">
      <summary className="flex cursor-pointer list-none items-center gap-3">
        <span
          className={`w-16 shrink-0 rounded px-2 py-0.5 text-center text-xs font-bold uppercase ${METHOD_STYLES[method]}`}
        >
          {method}
        </span>
        <code className="text-sm text-ink">{path}</code>
      </summary>
      <div className="mt-3 space-y-3 pl-[calc(4rem+0.75rem)] text-sm">
        {parameters.length > 0 && (
          <FieldList
            title="Parameters"
            items={parameters.map((parameter) => ({
              name: parameter.name,
              detail: `${parameter.in}${parameter.required ? ', required' : ''} — ${describeSchema(parameter.schema)}`,
            }))}
          />
        )}
        {fields.length > 0 && (
          <FieldList
            title={`Body${operation.requestBody?.required ? ' (required)' : ''}`}
            items={fields.map((field) => ({ name: field.name, detail: field.type }))}
          />
        )}
        {responses.length > 0 && (
          <FieldList
            title="Responses"
            items={responses.map(([status, response]) => ({
              name: status,
              detail: describeSchema(response.content?.['application/json']?.schema),
            }))}
          />
        )}
      </div>
    </details>
  );
}

function FieldList({ title, items }: { title: string; items: { name: string; detail: string }[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">{title}</p>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.name}>
            <code className="text-ink">{item.name}</code> <span className="text-muted">— {item.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Purely presentational grouping over the live spec's own paths — not
 * metadata the spec carries (fastify/swagger doesn't tag operations here),
 * so this reads real prefixes rather than inventing section names. Sorted
 * longest-prefix-first so `/api/v1/meta` doesn't fall into `/api/v1/me`'s
 * bucket, and `/api/v1/authors` doesn't fall into `/api/v1/auth`'s.
 */
const GROUP_PREFIXES: [string, string][] = [
  ['/api/v1/layouts', 'Layouts'],
  ['/api/v1/authors', 'Authors'],
  ['/api/v1/meta', 'Meta'],
  ['/api/v1/tags', 'Meta'],
  ['/api/v1/export', 'Export'],
  ['/api/v1/admin', 'Admin'],
  ['/api/v1/moderation', 'Moderation'],
  ['/api/v1/me', 'Account'],
  ['/api/v1/auth', 'Auth'],
  ['/callback', 'Auth'],
];
GROUP_PREFIXES.sort(([a], [b]) => b.length - a.length);

const GROUP_ORDER = ['Overview', 'Layouts', 'Meta', 'Authors', 'Export', 'Account', 'Auth', 'Moderation', 'Admin', 'Other'];

function groupLabel(path: string): string {
  if (path === '/') return 'Overview';
  return GROUP_PREFIXES.find(([prefix]) => path.startsWith(prefix))?.[1] ?? 'Other';
}
