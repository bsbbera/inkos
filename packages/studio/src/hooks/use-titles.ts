/*
 * A work's name as its person gave it.
 *
 * `titleOf` reads a folder slug back as prose, which is right for a short
 * nobody titled and wrong for an issue that has one: Audit and Gallery said
 * "Indigo One Colour Every Connection" over an issue called "Indigo". A book
 * and an issue know their real title, so where one exists it wins.
 */
import { useCallback } from "react";
import { useApi } from "./use-api";
import { titleOf } from "../lib/title-of";

export function useTitles(): (id: string) => string {
  const books = useApi<{ books: ReadonlyArray<{ id: string; title?: string }> }>("/books");
  const pubs = useApi<{ publications: ReadonlyArray<{ id: string; title?: string; subject?: string }> }>("/publications");
  return useCallback((id: string) => {
    const known = books.data?.books.find((b) => b.id === id)?.title
      ?? pubs.data?.publications.find((p) => p.id === id)?.title;
    return known && known.trim() ? known : titleOf(id);
  }, [books.data, pubs.data]);
}
