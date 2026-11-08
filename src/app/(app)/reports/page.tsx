"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/client/api";
import type { ReportDto } from "@/lib/types";

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** What people sent with "Something wrong?", for whoever runs Divvy. */
export default function ReportsPage() {
  const reports = useQuery({
    queryKey: ["reports"],
    queryFn: () => api.get<{ reports: ReportDto[] }>("/api/reports").then((r) => r.reports),
    retry: false,
  });

  return (
    <div className="pb-8 pt-[max(1.5rem,var(--top-safe))]">
      <h1 className="text-heading font-semibold tracking-[-0.02em] text-text">Reports people sent</h1>
      <p className="mt-1 text-body text-muted">Newest first. Each is deleted after 90 days.</p>

      <div className="mt-5 space-y-2.5">
        {reports.isLoading ? (
          <Skeleton className="h-24 w-full rounded-[var(--radius-lg)]" />
        ) : reports.error ? (
          <p className="text-body text-muted">
            {reports.error instanceof ApiError ? reports.error.message : "Couldn't load them."}
          </p>
        ) : reports.data?.length ? (
          reports.data.map((report) => (
            <article key={report.id} className="rounded-[var(--radius-lg)] border border-[var(--card-border)] bg-surface p-4 shadow-card">
              <header className="flex items-center gap-2.5">
                {report.from ? <Avatar person={report.from} size="xs" /> : null}
                <p className="min-w-0 flex-1 truncate text-body font-semibold text-text">
                  {report.from ? <bdi>{report.from.displayName}</bdi> : "Someone not signed in"}
                </p>
                <time className="shrink-0 text-caption text-subtle" dateTime={report.createdAt}>
                  {when(report.createdAt)}
                </time>
              </header>
              <p dir="auto" className="mt-2 whitespace-pre-wrap break-words text-body-lg leading-relaxed text-text">
                {report.text}
              </p>
              <p className="mt-2 break-words text-caption text-subtle">
                {report.device} · {report.path}
                {report.build ? ` · ${report.build.slice(0, 7)}` : ""}
              </p>
            </article>
          ))
        ) : (
          <p className="text-body text-muted">Nothing yet.</p>
        )}
      </div>
    </div>
  );
}
