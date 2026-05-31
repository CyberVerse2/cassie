export const CONFIGURED_DIRECT_VENUE_EXPRESSION_RAILS = [
  "crypto",
  "public_equity",
  "etf",
  "commodity",
  "fx",
  "rates",
  "bonds_credit",
  "futures",
  "indices",
  "pre_ipo",
  "other",
] as const;

export const CONFIGURED_VENUE_SEARCHABLE_EXPRESSION_RAILS = [
  ...CONFIGURED_DIRECT_VENUE_EXPRESSION_RAILS,
  "prediction_market",
] as const;

export function isConfiguredDirectVenueExpressionRail(expressionRail: string): boolean {
  return (CONFIGURED_DIRECT_VENUE_EXPRESSION_RAILS as readonly string[]).includes(expressionRail);
}

export function isConfiguredVenueSearchableExpressionRail(expressionRail: string): boolean {
  return (CONFIGURED_VENUE_SEARCHABLE_EXPRESSION_RAILS as readonly string[]).includes(expressionRail);
}

export function isDirectEnoughForConfiguredVenueSearch(directness: string): boolean {
  return directness === "direct" || directness === "strong_proxy";
}
