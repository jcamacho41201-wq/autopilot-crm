"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

type SearchResult = {
  id: string;
  category: string;
  title: string;
  subtitle: string;
  href: string;
};

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const listener = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", listener);
    return () => document.removeEventListener("mousedown", listener);
  }, []);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(normalized)}`, { signal: controller.signal });
        if (response.ok) {
          const data = await response.json();
          setResults(data.results ?? []);
          setOpen(true);
        }
      } catch {
        if (!controller.signal.aborted) setResults([]);
      }
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const grouped = useMemo(() => results.reduce((map, result) => {
    const group = map.get(result.category) ?? [];
    group.push(result);
    map.set(result.category, group);
    return map;
  }, new Map<string, SearchResult[]>()), [results]);

  return (
    <div className="global-search" ref={ref}>
      <label>
        <Search size={17} />
        <input
          aria-label="Search Maintiva"
          onFocus={() => setOpen(true)}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search customers, vehicles, VINs, plates, appointments, services..."
          value={query}
        />
      </label>
      {open && query.trim().length >= 2 ? (
        <div className="search-results-panel">
          {results.length ? Array.from(grouped.entries()).map(([category, rows]) => (
            <div className="search-result-group" key={category}>
              <strong>{category}</strong>
              {rows.map((result) => (
                <Link key={`${result.category}-${result.id}`} href={result.href} onClick={() => setOpen(false)}>
                  <span>{result.title}</span>
                  <small>{result.subtitle}</small>
                </Link>
              ))}
            </div>
          )) : <p>No matches yet.</p>}
        </div>
      ) : null}
    </div>
  );
}
