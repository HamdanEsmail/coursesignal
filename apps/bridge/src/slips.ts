import {
  LODGE_PAGES_ORIGIN,
  encodeLodgeQuery,
  formatEventLabel,
  lodgePageUrl,
  parseLodgeQuery,
  requireTitle,
  type LodgeQueryFields,
  type NamedLink,
  type NamedLinkOptions,
} from "./calendar.js";

/**
 * Lodge slip cards open a public page on the existing Pages host.
 * Same query contract as `/add.ics`: title, start, end, location, url only.
 * No conversation keys, phones, or names.
 */
export const LODGE_SLIP_PATH = "/slip";
export const LODGE_SLIP_LABEL = "Lodge slip";

export type SlipInput = {
  title: string;
  start?: string;
  end?: string;
  location?: string;
  url?: string;
};

export function pickSlipInput(input: SlipInput): SlipInput {
  const fields: LodgeQueryFields = { title: requireTitle(input.title) };
  if (input.start?.trim()) fields.start = input.start;
  if (input.end?.trim()) fields.end = input.end;
  if (input.location?.trim()) fields.location = input.location;
  if (input.url?.trim()) fields.url = input.url;
  const encoded = encodeLodgeQuery(fields);
  const [picked] = parseLodgeQuery(encoded);
  if (!picked) throw new Error("Lodge slip title is required");
  return picked;
}

export function buildSlipUrl(input: SlipInput): string {
  return lodgePageUrl(LODGE_SLIP_PATH, encodeLodgeQuery(pickSlipInput(input)));
}

export function namedSlipLink(input: SlipInput, options: NamedLinkOptions = {}): NamedLink {
  const slip = pickSlipInput(input);
  return {
    label: `${LODGE_SLIP_LABEL} · ${formatEventLabel(slip, options.timeZone)}`,
    url: buildSlipUrl(slip),
  };
}

export function parseSlipQuery(query: string | URLSearchParams): SlipInput {
  const [slip] = parseLodgeQuery(query);
  if (!slip) throw new Error("Lodge slip query is missing a title");
  return slip;
}

export { LODGE_PAGES_ORIGIN };
