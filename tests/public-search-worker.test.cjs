/* Regression tests for public directory search. Run: node --test tests/public-search-worker.test.cjs */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { PublicEngine, paramsOf } = require("../public-search-worker.js");

const fields = ["id", "country", "state", "city", "name", "address", "postal_code", "category", "chain_group", "phones", "platforms", "phone_independent_source_count", "phone_current_verified", "shared_phone_locations", "aliases"];
const example = ["US-1", "US", "CA", "Los Angeles", "Tienda del Centro", "123 Main St", "90001", "Tienda mexicana/latina", "Sin cadena identificada", [{e164: "+12135550101"}], ["MoneyGram"], 1, false, 1, ["Mercado La Esquina", "Mini Súper América"]];
const metadata = {total: 1, countries: {US: 1}, categories: {"Tienda mexicana/latina": 1}, chain_groups: {"Sin cadena identificada": 1}, current_verified: 0};
const manifest = {version: 1, fields, metadata, total: 1, shards: [{url:"data/public/shards/test.json", count: 1, country:"US", state:"CA"}]};
const rows = {fields, rows:[example]};
const engine = new PublicEngine(manifest, "https://example.org/st-locations-/", {
  verifyHash: false,
  fetch: async () => ({ok: true, arrayBuffer: async () => Uint8Array.from(Buffer.from(JSON.stringify(rows))).buffer}),
});

test("matches published aliases without changing primary business name", async () => {
  const result = await engine.query([["q", "mercado esquina"], ["country", "US"]]);
  assert.equal(result.total, 1);
  assert.equal(result.records[0].name, "Tienda del Centro");
});
test("matches accented aliases using accent-insensitive tokens", async () => {
  const result = await engine.query([["q", "mini super america"]]);
  assert.equal(result.total, 1);
});
test("does not invent current phone verification", async () => {
  const result = await engine.query([["proof", "current"]]);
  assert.equal(result.total, 0);
});
test("preserves country restrictions", async () => {
  const result = await engine.query([["country", "MX"]]);
  assert.equal(result.total, 0);
});
test("rejects duplicate parameters", () => {
  assert.throws(() => paramsOf([["q", "one"], ["q", "two"]]), /una sola vez/);
});
