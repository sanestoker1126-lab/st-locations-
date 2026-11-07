"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");

test("search page loads the map and keeps its preexisting directory", () => {
  const html = read("buscador.html");
  assert.match(html, /id="search-form"/);
  assert.match(html, /id="results"/);
  for (const id of ["remesas-map", "remesas-map-expand", "remesas-map-nearby", "remesas-map-message"]) {
    assert.ok(html.includes('id="' + id + '"'), "missing " + id);
  }
  assert.match(html, /remesas-map\.js/);
  assert.match(html, /remesas-map\.css/);
  assert.match(html, /leaflet@1\.9\.4/);
  assert.match(html, /sha256-/);
  assert.match(html, /nominatim\.openstreetmap\.org/);
  assert.match(html, /tile\.openstreetmap\.org/);
});
test("published data is unchanged and map excludes unverified coordinates", () => {
  const dataset = JSON.parse(read("data/locations.json"));
  const geo = JSON.parse(read("data/remesas-geopoints.json"));
  assert.ok(Array.isArray(dataset.records));
  assert.ok(dataset.records.length > 0);
  assert.equal(geo.version, 1);
  assert.ok(Array.isArray(geo.points));
  const ids = new Set(dataset.records.map(r => r.id));
  assert.equal(ids.size, dataset.records.length, "record ids should be unique");
  for (const p of geo.points) {
    assert.ok(ids.has(p.id), "unknown business id");
    assert.ok(Number.isFinite(p.lat) && p.lat >= -90 && p.lat <= 90);
    assert.ok(Number.isFinite(p.lng) && p.lng >= -180 && p.lng <= 180);
    assert.equal(p.precision, "address");
    assert.ok(p.source && p.verified_at);
  }
});
test("map interaction is opt-in and search filters are forwarded", () => {
  const js = read("remesas-map.js");
  const search = read("buscador.js");
  assert.match(search, /new CustomEvent\("remesas:results"/);
  assert.match(search, /data\.mapLocate/);
  assert.match(js, /ui\.results\.addEventListener\("click"/);
  assert.match(js, /function matchAddress/);
  assert.match(js, /expectedZip !== foundZip/);
  assert.match(js, /navigator\.geolocation\.getCurrentPosition/);
  assert.match(js, /scrollWheelZoom: false/);
  assert.doesNotMatch(js, /for\s*\([^)]*\)\s*await\s+fetch\(/);
});
