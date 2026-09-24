type QueryValue = string | QueryValue[] | { [key: string]: QueryValue };
/** Parse delimiters after one URL decode. Nested escaped labels remain opaque. */
function parseQuery(text: string): QueryValue {
  if (text.length > 32768 || /[&#\p{Cc}]/u.test(text) || /%(?![0-9a-f]{2})/i.test(text))
    throw new Error("Invalid Sales Navigator filter query");
  let offset = 0;
  const read = (depth: number): QueryValue => {
    if (depth > 32) throw new Error("Sales Navigator filter query is too deeply nested");
    if (text.startsWith("List(", offset)) {
      offset += 5;
      const values: QueryValue[] = [];
      while (text[offset] !== ")") {
        values.push(read(depth + 1));
        if (text[offset] !== ",") break;
        offset++;
      }
      if (text[offset++] !== ")") throw new Error("Malformed Sales Navigator filter list");
      return values;
    }
    if (text[offset] === "(") {
      offset++;
      const value: { [key: string]: QueryValue } = Object.create(null);
      while (text[offset] !== ")") {
        const key = /^[A-Za-z][A-Za-z0-9_]*/.exec(text.slice(offset))?.[0];
        if (!key || Object.hasOwn(value, key)) throw new Error("Invalid or duplicate search field");
        offset += key.length;
        if (text[offset++] !== ":") throw new Error("Malformed Sales Navigator search field");
        value[key] = read(depth + 1);
        if (text[offset] !== ",") break;
        offset++;
      }
      if (text[offset++] !== ")") throw new Error("Malformed Sales Navigator filter object");
      return value;
    }
    const start = offset;
    while (offset < text.length && ![",", "(", ")"].includes(text[offset] ?? "")) offset++;
    if (offset === start) throw new Error("Empty Sales Navigator filter value");
    return text.slice(start, offset);
  };
  const value = read(0);
  if (offset !== text.length) throw new Error("Unexpected Sales Navigator query suffix");
  return value;
}
const object = (value: QueryValue | undefined): { [key: string]: QueryValue } | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;

export interface SalesnavListUrl {
  id: string;
  url: string;
  query?: string;
  sessionId?: string;
}
/** Only an explicit single included lead-list can enter the account-scoped workflow. */
export function parseSalesnavListUrl(value: string): SalesnavListUrl {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Paste a Sales Navigator lead list or filtered people-search URL");
  }
  if (
    url.protocol !== "https:" ||
    !["www.linkedin.com", "linkedin.com"].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password
  )
    throw new Error("Expected a LinkedIn HTTPS lead list or people-search URL");
  const id = /^\/sales\/lists\/people\/(\d{1,30})\/?$/.exec(url.pathname)?.[1];
  if (id) return { id, url: `https://www.linkedin.com/sales/lists/people/${id}` };
  if (!/^\/sales\/search\/people\/?$/.test(url.pathname))
    throw new Error(
      "Expected /sales/lists/people/<list-id> or /sales/search/people with a LEAD_LIST filter"
    );
  const queries = [...url.searchParams.getAll("query"), ...url.searchParams.getAll("searchQuery")];
  if (queries.length !== 1 || !queries[0])
    throw new Error(
      "Search URL must contain one explicit query with a LEAD_LIST filter; a savedSearchId or recentSearchId alone is insufficient"
    );
  const query = queries[0]; // URLSearchParams decoded once, as in Cleanlist's reader.
  const parsed = object(parseQuery(query));
  const filters = parsed?.filters;
  if (!Array.isArray(filters)) throw new Error("Search URL has no explicit lead-list filters");
  const leadFilters = filters.map(object).filter((filter) => filter?.type === "LEAD_LIST");
  const values = leadFilters[0]?.values;
  const selected = Array.isArray(values) && values.length === 1 ? object(values[0]) : undefined;
  if (
    leadFilters.length !== 1 ||
    selected?.selectionType !== "INCLUDED" ||
    typeof selected.id !== "string" ||
    !/^\d{1,30}$/.test(selected.id)
  )
    throw new Error(
      "Search must include exactly one lead list; excluded or multiple lists are unsupported"
    );
  const sessions = url.searchParams.getAll("sessionId");
  const sessionId = sessions[0];
  if (sessions.length !== 1 || !sessionId || sessionId.length > 512 || /\p{Cc}/u.test(sessionId))
    throw new Error(
      "Search URL needs its sessionId; reopen the filtered search in Sales Navigator and copy its URL"
    );
  // Preserve every filter, not just the list ID. Dropping filters broadens the selected audience.
  const canonical = new URL("https://www.linkedin.com/sales/search/people");
  canonical.searchParams.set("query", query);
  canonical.searchParams.set("sessionId", sessionId);
  return { id: selected.id, url: canonical.href, query, sessionId };
}
