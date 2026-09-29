export function getRoomDeletionDisposition(input: {
  hasThirdPartyComments: boolean;
  hasThirdPartyHighlights: boolean;
}): "delete" | "archive" {
  return input.hasThirdPartyComments || input.hasThirdPartyHighlights
    ? "archive"
    : "delete";
}