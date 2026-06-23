// Best-effort ISBN metadata lookup to prefill cataloging. Tries OpenLibrary,
// then Google Books. Any failure (offline, not found, bad data) returns an empty
// result and never throws - cataloging must work without it.
class IsbnService {
  private clean(isbn: string): string {
    return (isbn || "").replace(/[^0-9Xx]/g, "");
  }

  public async lookup(isbnRaw: string): Promise<any> {
    const isbn = this.clean(isbnRaw);
    if (!isbn) return {};
    return (
      (await this.fromOpenLibrary(isbn)) ||
      (await this.fromGoogleBooks(isbn)) ||
      {}
    );
  }

  private async fetchJson(url: string): Promise<any | null> {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
      } as any);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  private async fromOpenLibrary(isbn: string): Promise<any | null> {
    const data = await this.fetchJson(
      `https://openlibrary.org/isbn/${isbn}.json`,
    );
    if (!data || !data.title) return null;
    let authors: string[] = [];
    if (Array.isArray(data.authors) && data.authors.length > 0) {
      authors = (
        await Promise.all(
          data.authors.map(async (a: any) => {
            const ad =
              a && a.key
                ? await this.fetchJson(`https://openlibrary.org${a.key}.json`)
                : null;
            return ad && ad.name ? ad.name : null;
          }),
        )
      ).filter(Boolean);
    }
    const year = data.publish_date
      ? parseInt(String(data.publish_date).match(/\d{4}/)?.[0] || "", 10)
      : undefined;
    return {
      isbn,
      title: data.title,
      authors,
      publisher: Array.isArray(data.publishers)
        ? data.publishers[0]
        : undefined,
      year: Number.isFinite(year) ? year : undefined,
      pages: data.number_of_pages || undefined,
      source: "openlibrary",
    };
  }

  private async fromGoogleBooks(isbn: string): Promise<any | null> {
    const data = await this.fetchJson(
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`,
    );
    const info =
      data && Array.isArray(data.items) && data.items.length > 0
        ? data.items[0].volumeInfo
        : null;
    if (!info || !info.title) return null;
    const year = info.publishedDate
      ? parseInt(String(info.publishedDate).slice(0, 4), 10)
      : undefined;
    return {
      isbn,
      title: info.title,
      authors: Array.isArray(info.authors) ? info.authors : [],
      publisher: info.publisher,
      year: Number.isFinite(year) ? year : undefined,
      pages: info.pageCount || undefined,
      source: "googlebooks",
    };
  }
}

export const isbnService = new IsbnService();
