// Run with: node --test scripts/
// No real BookOrbit or GitHub is involved: both are faked with local HTTP servers.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
	BookOrbitClient,
	cleanIsbn,
	dateInZone,
	isbn10to13,
	normalizeBaseUrl,
	readExisting,
	renderReview,
	slugify,
	sync,
	yamlScalar,
} from "./sync-bookorbit-reviews.mjs";
import { appendToPrBody, newFilesFromStatus, newPrBody } from "./open-bookorbit-pr.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const LIBRARY = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/bookorbit/library.json"), "utf8"));
const API_KEY = "bok_test_key_not_real";

function listen(handler) {
	return new Promise((resolve) => {
		const server = http.createServer(handler);
		server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
	});
}

function readBody(req) {
	return new Promise((resolve) => {
		const chunks = [];
		req.on("data", (c) => chunks.push(c));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
	});
}

// A fake BookOrbit that behaves like the routes documented in the BookOrbit source.
async function fakeBookOrbit({ pageSize = 100 } = {}) {
	const seen = { auth: [], queryBodies: [], detailIds: [] };
	const { server, url } = await listen(async (req, res) => {
		seen.auth.push(req.headers.authorization);
		const send = (status, body) => {
			res.writeHead(status, { "Content-Type": "application/json" });
			res.end(JSON.stringify(body));
		};
		if (req.headers.authorization !== `Bearer ${API_KEY}`) return send(401, { message: "Unauthorized" });
		if (req.method === "POST" && req.url === "/api/v1/books/query") {
			const body = JSON.parse(await readBody(req));
			seen.queryBodies.push(body);
			const { page, size } = body.pagination;
			const items = LIBRARY.cards.slice(page * size, page * size + size);
			return send(200, { items, total: LIBRARY.cards.length, page, size });
		}
		const m = req.url.match(/^\/api\/v1\/books\/(\d+)$/);
		if (req.method === "GET" && m) {
			seen.detailIds.push(m[1]);
			return LIBRARY.details[m[1]] ? send(200, LIBRARY.details[m[1]]) : send(404, { message: "Not found" });
		}
		return send(404, { message: "Not found" });
	});
	return { server, url, seen, pageSize };
}

function tempReviews() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bookorbit-test-"));
	const reviews = path.join(dir, "reviews");
	fs.mkdirSync(reviews);
	for (const name of ["skyward.md", "theo-of-golden.md"]) fs.copyFileSync(path.join(ROOT, "src/reviews", name), path.join(reviews, name));
	const ignore = path.join(dir, "ignore.txt");
	fs.writeFileSync(ignore, "# test\n9782222222222  # Ignored Book\n");
	return { dir, reviews, ignore };
}

test("helpers", () => {
	assert.equal(normalizeBaseUrl("books.example.com/"), "https://books.example.com");
	assert.equal(normalizeBaseUrl("https://books.example.com/api/v1/"), "https://books.example.com");
	assert.equal(slugify("Rendezvous with Rama"), "rendezvous-with-rama");
	assert.equal(slugify("Don't Leave Me: Scarlett"), "dont-leave-me-scarlett");
	assert.equal(slugify("Les Mis\u00e9rables"), "les-miserables");
	assert.equal(isbn10to13("0441478123"), "9780441478125");
	assert.equal(cleanIsbn("978-0-441-47812-5"), "9780441478125");
	assert.equal(cleanIsbn("0-441-47812-3"), "9780441478125");
	assert.equal(cleanIsbn("nonsense"), "");
	// 12:30am on Dec 2 in Phoenix (UTC-7, all year) is still Dec 1 in Los Angeles in winter (UTC-8)
	assert.equal(dateInZone("2026-12-02T07:30:00.000Z", "America/Phoenix"), "2026-12-02");
	assert.equal(dateInZone("2026-12-02T07:30:00.000Z", "America/Los_Angeles"), "2026-12-01");
	assert.equal(dateInZone("2026-12-02T07:30:00.000Z", "UTC"), "2026-12-02");
	// no zone given means Phoenix: 6:30pm Dec 1 there, already Dec 2 in UTC
	assert.equal(dateInZone("2026-12-02T01:30:00.000Z"), "2026-12-01");
	// and Phoenix has no daylight saving: same offset in July
	assert.equal(dateInZone("2026-07-02T06:59:00.000Z"), "2026-07-01");
	assert.equal(dateInZone("2026-07-02T07:00:00.000Z"), "2026-07-02");
	assert.equal(dateInZone("garbage"), "");
	assert.equal(yamlScalar("Starsight"), "Starsight");
	assert.equal(yamlScalar("No Finish Date: A Test"), '"No Finish Date: A Test"');
	assert.equal(yamlScalar("1984"), '"1984"');
	assert.equal(yamlScalar("Yes"), '"Yes"');
});

test("renderReview matches the shape of the existing review files", () => {
	const out = renderReview({ title: "Skyward", author: "Brandon Sanderson", date: "2026-08-28", rating: 4, isbn: "9780399555770" }, "Body.\r\n");
	const existing = fs.readFileSync(path.join(ROOT, "src/reviews/skyward.md"), "utf8");
	assert.equal(out.split("\n").slice(0, 7).join("\n"), existing.split("\n").slice(0, 7).join("\n"));
	assert.ok(out.endsWith("---\nBody.\n"));
	assert.ok(!renderReview({ title: "X", author: "Y", date: "2026-01-01", rating: 3 }, "b").includes("isbn"));
});

test("readExisting reads slugs, titles, isbn, bookshopIsbn and the ignore list", () => {
	const { reviews, ignore } = tempReviews();
	fs.copyFileSync(path.join(ROOT, "src/reviews/rendezvous-with-rama.md"), path.join(reviews, "rendezvous-with-rama.md"));
	const { slugs, isbns } = readExisting(reviews, ignore);
	assert.ok(slugs.has("skyward") && slugs.has("rendezvous-with-rama"));
	assert.ok(isbns.has("9780399555770"));
	assert.ok(isbns.has("9780358380221"), "bookshopIsbn counts");
	assert.ok(isbns.has("9782222222222"), "ignore list counts");
});

test("sync writes only new, complete reviews and reports the rest", async () => {
	const fake = await fakeBookOrbit();
	const { reviews, ignore } = tempReviews();
	const client = new BookOrbitClient({ url: fake.url, apiKey: API_KEY, retryDelayMs: 1 });
	const report = await sync({ client, reviewsDir: reviews, ignoreFile: ignore, log: () => {} });
	fake.server.close();

	assert.deepEqual(report.added.map((r) => r.slug).sort(), ["no-finish-date-a-test", "quotes-and-colons", "the-left-hand-of-darkness"]);
	assert.equal(report.skipped.existing, 3, "Skyward (isbn), Theo (slug) and the ignored book");
	assert.equal(report.skipped.noReview, 1);
	assert.equal(report.skipped.incomplete.length, 1);
	assert.match(report.skipped.incomplete[0], /No Author Listed/);
	assert.deepEqual(fake.seen.detailIds.sort(), ["101", "103", "104", "105", "108"], "no detail request for books already on the site");

	assert.equal(
		fs.readFileSync(path.join(reviews, "the-left-hand-of-darkness.md"), "utf8"),
		[
			"---",
			"title: The Left Hand of Darkness",
			"author: Ursula K. Le Guin",
			"date: 2026-12-02",
			"rating: 5",
			'isbn: "9780441478125"',
			"---",
			"A diplomat crosses an ice sheet.",
			"",
			"Second paragraph, with *markdown*.",
			"",
		].join("\n"),
	);

	const noDate = fs.readFileSync(path.join(reviews, "no-finish-date-a-test.md"), "utf8");
	assert.match(noDate, /^title: "No Finish Date: A Test"$/m);
	assert.match(noDate, /^date: 2026-11-19$/m, "falls back to the review edit date, in Phoenix time");
	assert.match(noDate, /^isbn: "9781250386236"$/m, "ISBN-10 converted to ISBN-13");
	const warn = report.added.find((r) => r.slug === "no-finish-date-a-test").warnings;
	assert.equal(warn.length, 1);
	assert.match(warn[0], /No finished date/);

	const noIsbn = fs.readFileSync(path.join(reviews, "quotes-and-colons.md"), "utf8");
	assert.match(noIsbn, /^title: "Quotes \\"and\\" Colons"$/m);
	assert.match(noIsbn, /^author: "First Author, Second Author"$/m);
	assert.ok(!/^isbn:/m.test(noIsbn));
	assert.match(report.added.find((r) => r.slug === "quotes-and-colons").warnings[0], /No ISBN/);

	assert.ok(!fs.existsSync(path.join(reviews, "ignored-book.md")));
	assert.ok(!fs.existsSync(path.join(reviews, "rated-but-never-reviewed.md")));
});

test("a second run adds nothing", async () => {
	const fake = await fakeBookOrbit();
	const { reviews, ignore } = tempReviews();
	const client = new BookOrbitClient({ url: fake.url, apiKey: API_KEY, retryDelayMs: 1 });
	await sync({ client, reviewsDir: reviews, ignoreFile: ignore, log: () => {} });
	const again = await sync({ client, reviewsDir: reviews, ignoreFile: ignore, log: () => {} });
	fake.server.close();
	assert.equal(again.added.length, 0);
});

test("dry run writes nothing", async () => {
	const fake = await fakeBookOrbit();
	const { reviews, ignore } = tempReviews();
	const client = new BookOrbitClient({ url: fake.url, apiKey: API_KEY, retryDelayMs: 1 });
	const report = await sync({ client, reviewsDir: reviews, ignoreFile: ignore, dryRun: true, log: () => {} });
	fake.server.close();
	assert.equal(report.added.length, 3);
	assert.deepEqual(fs.readdirSync(reviews).sort(), ["skyward.md", "theo-of-golden.md"]);
});

test("client sends the bearer key, the rating filter, and pages through results", async () => {
	const fake = await fakeBookOrbit();
	const client = new BookOrbitClient({ url: fake.url, apiKey: API_KEY, pageSize: 3, retryDelayMs: 1 });
	const cards = await client.listRatedBooks();
	fake.server.close();
	assert.equal(cards.length, LIBRARY.cards.length);
	assert.equal(fake.seen.queryBodies.length, 3, "8 books at 3 per page is 3 requests");
	assert.deepEqual(fake.seen.queryBodies[0].filter, { type: "group", join: "AND", rules: [{ type: "rule", field: "rating", operator: "isNotEmpty" }] });
	assert.deepEqual(fake.seen.queryBodies.map((b) => b.pagination.page), [0, 1, 2]);
	assert.ok(fake.seen.auth.every((h) => h === `Bearer ${API_KEY}`));
});

test("a rejected key fails clearly and never prints the key", async () => {
	const fake = await fakeBookOrbit();
	const client = new BookOrbitClient({ url: fake.url, apiKey: "bok_wrong_key", retryDelayMs: 1 });
	await assert.rejects(client.listRatedBooks(), (err) => {
		assert.match(err.message, /returned 401/);
		assert.match(err.message, /expired or revoked/);
		assert.ok(!err.message.includes("bok_wrong_key"));
		return true;
	});
	fake.server.close();
});

test("server errors are retried, then reported", async () => {
	let calls = 0;
	const { server, url } = await listen((req, res) => {
		calls += 1;
		res.writeHead(503);
		res.end();
	});
	const client = new BookOrbitClient({ url, apiKey: API_KEY, retries: 3, retryDelayMs: 1 });
	await assert.rejects(client.getBook(1), /returned 503/);
	server.close();
	assert.equal(calls, 3);
});

test("PR helpers", () => {
	const status = [" M src/reviews/skyward.md", "?? src/reviews/new-one.md", "?? src/assets/img/covers/9780441478125.jpg", "?? notes.txt", "A  src/assets/img/covers/9780441478125-160.webp", ""].join("\0");
	assert.deepEqual(newFilesFromStatus(status), [
		"src/assets/img/covers/9780441478125-160.webp",
		"src/assets/img/covers/9780441478125.jpg",
		"src/reviews/new-one.md",
	]);
	const report = { added: [{ title: "A", author: "B", rating: 1, date: "2026-01-02", file: "src/reviews/a.md", warnings: ["Heads up."] }, { title: "C", author: "D", rating: 4, date: "2026-02-03", file: "src/reviews/c.md", warnings: [] }] };
	const body = newPrBody(report);
	assert.match(body, /^New reviews from my BookOrbit library/);
	assert.match(body, /- \*\*A\*\* by B: 1 star, finished 2026-01-02/);
	assert.match(body, /\n {2}- Heads up\./);
	assert.match(body, /- \*\*C\*\* by D: 4 stars/);
	const more = appendToPrBody(body, { added: [report.added[1]] }, "2026-03-04");
	assert.ok(more.startsWith(body.trimEnd()));
	assert.match(more, /\*\*Added 2026-03-04\*\*/);
});

// End to end: a throwaway git repo, the fake BookOrbit, and a fake GitHub that records what it is asked to do.
async function fakeGitHub({ openPr, branchExists = false }) {
	const calls = [];
	const { server, url } = await listen(async (req, res) => {
		const body = req.method === "GET" ? "" : await readBody(req);
		calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
		const send = (status, payload) => {
			res.writeHead(status, { "Content-Type": "application/json" });
			res.end(JSON.stringify(payload));
		};
		const u = req.url;
		if (req.method === "GET" && u.startsWith("/repos/o/r/pulls?")) return send(200, openPr ? [openPr] : []);
		if (req.method === "GET" && u === "/repos/o/r/git/ref/heads/trunk") return send(200, { object: { sha: "trunk0sha" } });
		if (req.method === "GET" && u === "/repos/o/r/git/ref/heads/bookorbit-sync") return send(openPr || branchExists ? 200 : 404, openPr || branchExists ? { object: { sha: "x" } } : { message: "Not Found" });
		if (req.method === "POST" && u === "/repos/o/r/git/refs") return send(201, {});
		if (req.method === "PATCH" && u === "/repos/o/r/git/refs/heads/bookorbit-sync") return send(200, {});
		if (req.method === "POST" && u === "/graphql") return send(200, { data: { createCommitOnBranch: { commit: { oid: "newsha", url: "https://example.test/commit/newsha" } } } });
		if (req.method === "POST" && u === "/repos/o/r/pulls") return send(201, { number: 7, html_url: "https://example.test/pull/7" });
		if (req.method === "PATCH" && u === "/repos/o/r/pulls/5") return send(200, {});
		return send(404, { message: `unexpected ${req.method} ${u}` });
	});
	return { server, url, calls };
}

function runNode(script, env, cwd, args = []) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [script, ...args], { cwd, env: { ...process.env, ...env } });
		let out = "";
		child.stdout.on("data", (d) => (out += d));
		child.stderr.on("data", (d) => (out += d));
		child.on("close", (code) => resolve({ code, out }));
	});
}

function makeRepo() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bookorbit-e2e-"));
	for (const sub of ["src/reviews", "src/assets/img/covers", "scripts"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
	for (const f of ["sync-bookorbit-reviews.mjs", "open-bookorbit-pr.mjs"]) fs.copyFileSync(path.join(HERE, f), path.join(dir, "scripts", f));
	for (const f of ["skyward.md", "theo-of-golden.md"]) fs.copyFileSync(path.join(ROOT, "src/reviews", f), path.join(dir, "src/reviews", f));
	fs.writeFileSync(path.join(dir, "scripts/bookorbit-ignore.txt"), "9782222222222\n");
	spawnSync("git", ["init", "-q"], { cwd: dir });
	spawnSync("git", ["add", "."], { cwd: dir });
	spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init"], { cwd: dir });
	return dir;
}

async function runSync(dir) {
	const bo = await fakeBookOrbit();
	const out = path.join(dir, "github-output.txt");
	const run = await runNode(path.join(dir, "scripts/sync-bookorbit-reviews.mjs"), { BOOKORBIT_URL: bo.url, BOOKORBIT_API_KEY: API_KEY, GITHUB_OUTPUT: out }, dir, ["--report", "report.json"]);
	bo.server.close();
	return { run, output: fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "" };
}

test("the sync CLI writes the files, the report, and the added= output", async () => {
	const dir = makeRepo();
	const { run, output } = await runSync(dir);
	assert.equal(run.code, 0, run.out);
	assert.match(run.out, /Added 3 review\(s\); 3 already on the site, 1 rated without a review\./);
	assert.match(run.out, /! No ISBN in BookOrbit/);
	assert.match(run.out, /skipped No Author Listed/);
	assert.equal(output.trim(), "added=3");
	assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8")).added.length, 3);
	assert.ok(!run.out.includes(API_KEY), "the key is never printed");
});

test("the sync CLI fails with a clear message and no files when the key is wrong", async () => {
	const dir = makeRepo();
	const bo = await fakeBookOrbit();
	const run = await runNode(path.join(dir, "scripts/sync-bookorbit-reviews.mjs"), { BOOKORBIT_URL: bo.url, BOOKORBIT_API_KEY: "bok_wrong_key" }, dir);
	bo.server.close();
	assert.equal(run.code, 1);
	assert.match(run.out, /returned 401/);
	assert.ok(!run.out.includes("bok_wrong_key"));
	assert.deepEqual(fs.readdirSync(path.join(dir, "src/reviews")).sort(), ["skyward.md", "theo-of-golden.md"]);
});

test("end to end: new reviews become one commit and one new PR", async () => {
	const dir = makeRepo();
	await runSync(dir);
	// the workflow's build step fetches covers; stand in for that
	fs.writeFileSync(path.join(dir, "src/assets/img/covers/9780441478125.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
	const g = await fakeGitHub({ openPr: null });
	const pr = await runNode(path.join(dir, "scripts/open-bookorbit-pr.mjs"), { GITHUB_TOKEN: "ghs_fake", GITHUB_REPOSITORY: "o/r", GITHUB_API_URL: g.url, SYNC_REPORT: path.join(dir, "report.json") }, dir);
	g.server.close();
	assert.equal(pr.code, 0, pr.out);
	assert.ok(!pr.out.includes("ghs_fake"), "the token is never printed");
	const methods = g.calls.map((c) => `${c.method} ${c.url.split("?")[0]}`);
	assert.deepEqual(methods, ["GET /repos/o/r/pulls", "GET /repos/o/r/git/ref/heads/trunk", "GET /repos/o/r/git/ref/heads/bookorbit-sync", "POST /repos/o/r/git/refs", "POST /graphql", "POST /repos/o/r/pulls"]);
	assert.ok(g.calls.every((c) => c.auth === "Bearer ghs_fake"));
	const commit = g.calls.find((c) => c.url === "/graphql").body.variables.input;
	assert.equal(commit.expectedHeadOid, "trunk0sha");
	assert.equal(commit.branch.branchName, "bookorbit-sync");
	assert.equal(commit.message.headline, "Add 3 reviews from BookOrbit");
	assert.deepEqual(commit.fileChanges.additions.map((a) => a.path), [
		"src/assets/img/covers/9780441478125.jpg",
		"src/reviews/no-finish-date-a-test.md",
		"src/reviews/quotes-and-colons.md",
		"src/reviews/the-left-hand-of-darkness.md",
	]);
	const created = g.calls.find((c) => c.method === "POST" && c.url === "/repos/o/r/pulls").body;
	assert.equal(created.head, "bookorbit-sync");
	assert.equal(created.base, "trunk");
	assert.equal(created.title, "Add reviews from BookOrbit");
	assert.match(created.body, /\*\*The Left Hand of Darkness\*\* by Ursula K\. Le Guin: 5 stars, finished 2026-12-02/);
	assert.match(created.body, /No ISBN in BookOrbit/);
});

test("end to end: a leftover branch with no open PR is reset to trunk", async () => {
	const dir = makeRepo();
	await runSync(dir);
	const g = await fakeGitHub({ openPr: null, branchExists: true });
	const pr = await runNode(path.join(dir, "scripts/open-bookorbit-pr.mjs"), { GITHUB_TOKEN: "ghs_fake", GITHUB_REPOSITORY: "o/r", GITHUB_API_URL: g.url, SYNC_REPORT: path.join(dir, "report.json") }, dir);
	g.server.close();
	assert.equal(pr.code, 0, pr.out);
	const reset = g.calls.find((c) => c.method === "PATCH" && c.url === "/repos/o/r/git/refs/heads/bookorbit-sync");
	assert.deepEqual(reset.body, { sha: "trunk0sha", force: true });
});

test("end to end: with an open PR the new files go on top of its branch and the body is appended", async () => {
	const dir = makeRepo();
	await runSync(dir);
	const g = await fakeGitHub({ openPr: { number: 5, html_url: "https://example.test/pull/5", body: "Existing body I edited.", head: { sha: "prhead0sha" } } });
	const pr = await runNode(path.join(dir, "scripts/open-bookorbit-pr.mjs"), { GITHUB_TOKEN: "ghs_fake", GITHUB_REPOSITORY: "o/r", GITHUB_API_URL: g.url, SYNC_REPORT: path.join(dir, "report.json") }, dir);
	g.server.close();
	assert.equal(pr.code, 0, pr.out);
	const methods = g.calls.map((c) => `${c.method} ${c.url.split("?")[0]}`);
	assert.deepEqual(methods, ["GET /repos/o/r/pulls", "POST /graphql", "PATCH /repos/o/r/pulls/5"]);
	assert.equal(g.calls[1].body.variables.input.expectedHeadOid, "prhead0sha");
	const patched = g.calls[2].body.body;
	assert.ok(patched.startsWith("Existing body I edited."));
	assert.match(patched, /\*\*Added \d{4}-\d{2}-\d{2}\*\*/);
});

test("no new reviews means no GitHub calls", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bookorbit-e2e-empty-"));
	fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify({ added: [] }));
	const g = await fakeGitHub({ openPr: null });
	const pr = await runNode(path.join(HERE, "open-bookorbit-pr.mjs"), { GITHUB_TOKEN: "ghs_fake", GITHUB_REPOSITORY: "o/r", GITHUB_API_URL: g.url, SYNC_REPORT: path.join(dir, "report.json") }, dir);
	g.server.close();
	assert.equal(pr.code, 0, pr.out);
	assert.equal(g.calls.length, 0);
});
