/**
 * Affiliate links from the owner's own IDs. Accounts live in the SQLite store
 * (`store.collection("core", "affiliate_accounts")`); `affiliateLink` rewrites a retailer URL
 * deterministically from the stored ID. See openspec/changes/add-affiliate-links/design.md.
 */
export * from "./model";
export * from "./repo";
