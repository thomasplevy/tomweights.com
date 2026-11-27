#!/usr/bin/env node
// Pull my private reviews out of BookOrbit and write them as review files in src/reviews/.
//
// What counts as a "private review": a book in my BookOrbit library with a Personal Review
// (the `personalNote` field, shown in the app as "Personal Review") and a star rating.
// BookOrbit keeps both per user, so nothing here is ever visible to anyone else on that server.
//
// BookOrbit routes used (all work with a read-only API key that has no extra permissions):
//   POST {url}/api/v1/books/query   list my rated books, paged (a "read safe" POST)
//   GET  {url}/api/v1/books/{id}    book detail: personalNote, isbn13, isbn10, readStatus.finishedAt
// Docs: https://github.com/bookorbit/bookorbit/blob/main/docs/API_KEYS.md
//
// Usage: node scripts/sync-bookorbit-reviews.mjs [--dry-run] [--report <file>]
// Env:   BOOKORBIT_URL, BOOKORBIT_API_KEY (required); BOOKORBIT_TIMEZONE (default America/Phoenix)
//
// Reviews that already exist in src/reviews/ are skipped, matched by ISBN (isbn or bookshopIsbn
// in the front matter) or by slug. Anything listed in scripts/bookorbit-ignore.txt is skipped too.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGE_SIZE = 100;
const DEFAULT_TIME_ZONE = "America/Phoenix";

// ---------- small helpers (exported for tests) ----------

export function normalizeBaseUrl(raw) {
	let url = String(raw || "").trim().replace(/\/+$/, "");
	if (!url) throw new Error("BOOKORBIT_URL is not set.");
	if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
	url = url.replace(/\/api\/v1$/i, "");
	return url;
}

export function slugify(text) {
	return String(text || "")
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/['\u2019]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80)
		.replace(/-+$/g, "");
}

export function isbn10to13(isbn10) {
	const core = `978${String(isbn10).slice(0, 9)}`;
	let total = 0;
	for (let i = 0; i < core.length; i += 1) total += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
	return `${core}${(10 - (total % 10)) % 10}`;
}

export function cleanIsbn(value) {
	const id = String(value || "").replace(/[^\dXx]/g, "").toUpperCase();
	if (/^\d{13}$/.test(id)) return id;
	if (/^\d{9}[\dX]$/.test(id)) return isbn10to13(id);
	return "";
}

// BookOrbit sends timestamptz as ISO strings in UTC. A book finished at 9pm in Phoenix is already
// "tomorrow" in UTC, so convert to the time zone I actually read in.
export function dateInZone(iso, timeZone = DEFAULT_TIME_ZONE) {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(date);
	const get = (type) => parts.find((p) => p.type === type).value;
	return `${get("year")}-${get("month")}-${get("day")}`;
}

// Plain scalars where that is safe (matches the existing files); a JSON string otherwise,
// which is also valid YAML.
export function yamlScalar(value) {
	const text = String(value);
	const plain =
		/^[A-Za-z0-9][^:#\n"'{}\[\],&*!|>%@`]*$/.test(text) &&
		!/\s$/.test(text) &&
		!/^(true|false|yes|no|on|off|null|~)$/i.test(text) &&
		!/^[-+]?(\d[\d_]*)?\.?\d+([eE][-+]?\d+)?$/.test(text);
	return plain ? text : JSON.stringify(text);
}

export function renderReview({ title, author, date, rating, isbn }, body) {
	const lines = [
		"---",
		`title: ${yamlScalar(title)}`,
		`author: ${yamlScalar(author)}`,
		`date: ${date}`,
		`rating: ${rating}`,
	];
	if (isbn) lines.push(`isbn: "${isbn}"`);
	lines.push("---");
	return `${lines.join("\n")}\n${body.replace(/\r\n?/g, "\n").trim()}\n`;
}

// ---------- what is already on the site ----------

export function readExisting(reviewsDir, ignoreFile) {
	const slugs = new Set();
	const isbns = new Set();
	if (fs.existsSync(reviewsDir)) {
		for (const name of fs.readdirSync(reviewsDir)) {
			if (!name.endsWith(".md")) continue;
			slugs.add(name.replace(/\.md$/, ""));
			const raw = fs.readFileSync(path.join(reviewsDir, name), "utf8");
			const block = raw.match(/^---\n([\s\S]*?)\n---/);
			if (!block) continue;
			for (const line of block[1].split("\n")) {
				const m = line.match(/^(title|isbn|bookshopIsbn):\s*(?:"([^"]*)"|'([^']*)'|(.*?))\s*$/);
				if (!m) continue;
				const value = m[2] ?? m[3] ?? m[4] ?? "";
				if (m[1] === "title") slugs.add(slugify(value));
				else if (cleanIsbn(value)) isbns.add(cleanIsbn(value));
			}
		}
	}
	if (ignoreFile && fs.existsSync(ignoreFile)) {
		for (const line of fs.readFileSync(ignoreFile, "utf8").split("\n")) {
			const entry = line.replace(/#.*/, "").trim();
			if (!entry) continue;
			if (cleanIsbn(entry)) isbns.add(cleanIsbn(entry));
			else slugs.add(slugify(entry));
		}
	}
	return { slugs, isbns };
}

// ---------- BookOrbit client ----------

export class BookOrbitClient {
	constructor({ url, apiKey, fetchImpl = fetch, timeoutMs = 30000, retries = 3, retryDelayMs = 1500, pageSize = PAGE_SIZE }) {
		if (!apiKey) throw new Error("BOOKORBIT_API_KEY is not set.");
		this.base = `${normalizeBaseUrl(url)}/api/v1`;
		this.apiKey = apiKey;
		this.fetch = fetchImpl;
		this.timeoutMs = timeoutMs;
		this.retries = retries;
		this.retryDelayMs = retryDelayMs;
		this.pageSize = pageSize;
	}

	async request(method, route, body) {
		for (let attempt = 1; ; attempt += 1) {
			let res;
			try {
				res = await this.fetch(`${this.base}${route}`, {
					method,
					headers: {
						Authorization: `Bearer ${this.apiKey}`,
						Accept: "application/json",
						...(body ? { "Content-Type": "application/json" } : {}),
					},
					body: body ? JSON.stringify(body) : undefined,
					signal: AbortSignal.timeout(this.timeoutMs),
				});
			} catch (err) {
				if (attempt < this.retries) {
					await new Promise((r) => setTimeout(r, this.retryDelayMs * attempt));
					continue;
				}
				throw new Error(`BookOrbit ${method} ${route} failed: ${err.cause?.code || err.name || "network error"}`);
			}
			if (res.ok) return res.json();
			if ((res.status === 429 || res.status >= 500) && attempt < this.retries) {
				await new Promise((r) => setTimeout(r, this.retryDelayMs * attempt));
				continue;
			}
			let code = "";
			try {
				code = (await res.json()).errorCode || "";
			} catch {
				// not JSON
			}
			const hint =
				res.status === 401
					? " (the API key is missing, wrong, expired or revoked, or API keys are turned off on the server)"
					: res.status === 403
						? " (the key may not be allowed to read this)"
						: "";
			throw new Error(`BookOrbit ${method} ${route} returned ${res.status}${code ? ` ${code}` : ""}${hint}`);
		}
	}

	// Every book I have rated, newest finish first. Only the rating is filtered on server side;
	// there is no "has a personal review" rule, so reviews are read from each book's detail.
	async listRatedBooks() {
		const items = [];
		for (let page = 0; ; page += 1) {
			const result = await this.request("POST", "/books/query", {
				filter: { type: "group", join: "AND", rules: [{ type: "rule", field: "rating", operator: "isNotEmpty" }] },
				sort: [{ field: "finishedAt", dir: "desc" }],
				pagination: { page, size: this.pageSize },
			});
			items.push(...(result.items || []));
			if (!result.items?.length || items.length >= (result.total ?? 0) || result.items.length < this.pageSize) break;
		}
		return items;
	}

	getBook(id) {
		return this.request("GET", `/books/${encodeURIComponent(id)}`);
	}
}

// ---------- the sync ----------

export async function sync({ client, reviewsDir, ignoreFile, timeZone = DEFAULT_TIME_ZONE, dryRun = false, log = console.log }) {
	const existing = readExisting(reviewsDir, ignoreFile);
	const report = { added: [], skipped: { existing: 0, noReview: 0, incomplete: [] } };
	const cards = await client.listRatedBooks();
	log(`BookOrbit: ${cards.length} rated book(s).`);

	for (const card of cards) {
		const cardIsbn = cleanIsbn(card.isbn13);
		const cardSlug = slugify(card.title);
		if ((cardIsbn && existing.isbns.has(cardIsbn)) || (cardSlug && existing.slugs.has(cardSlug))) {
			report.skipped.existing += 1;
			continue;
		}

		const detail = await client.getBook(card.id);
		const note = String(detail.personalNote ?? "").trim();
		if (!note) {
			report.skipped.noReview += 1;
			continue;
		}

		const title = String(detail.title ?? card.title ?? "").trim();
		const author = (detail.authors?.map((a) => a.name) ?? card.authors ?? []).filter(Boolean).join(", ");
		const rating = Number(detail.rating ?? card.rating);
		if (!title || !author || !Number.isInteger(rating) || rating < 1 || rating > 5) {
			report.skipped.incomplete.push(`${title || `book ${card.id}`}: needs a title, an author, and a 1-5 rating`);
			continue;
		}

		const warnings = [];
		let date = detail.readStatus?.finishedAt ? dateInZone(detail.readStatus.finishedAt, timeZone) : "";
		if (!date) {
			date = dateInZone(detail.personalNoteUpdatedAt, timeZone);
			if (!date) {
				report.skipped.incomplete.push(`${title}: no finished date or review date`);
				continue;
			}
			warnings.push("No finished date in BookOrbit, so the date is when the review was last edited. Check it.");
		}

		const isbn = cleanIsbn(detail.isbn13) || cleanIsbn(detail.isbn10);
		if (!isbn) warnings.push("No ISBN in BookOrbit, so there is no cover or Bookshop link.");

		const slug = slugify(title);
		if (!slug) {
			report.skipped.incomplete.push(`${title}: could not make a file name`);
			continue;
		}
		const file = path.join(reviewsDir, `${slug}.md`);
		if (!dryRun) {
			fs.mkdirSync(reviewsDir, { recursive: true });
			fs.writeFileSync(file, renderReview({ title, author, date, rating, isbn }, note));
		}
		existing.slugs.add(slug);
		if (isbn) existing.isbns.add(isbn);
		report.added.push({ title, author, date, rating, isbn, slug, file: path.relative(ROOT, file), warnings });
	}
	return report;
}

// ---------- CLI ----------

function parseArgs(argv) {
	const args = { dryRun: false, report: "" };
	for (let i = 0; i < argv.length; i += 1) {
		if (argv[i] === "--dry-run") args.dryRun = true;
		else if (argv[i] === "--report") args.report = argv[(i += 1)] || "";
		else throw new Error(`Unknown argument: ${argv[i]}`);
	}
	return args;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const client = new BookOrbitClient({ url: process.env.BOOKORBIT_URL, apiKey: process.env.BOOKORBIT_API_KEY });
	const report = await sync({
		client,
		reviewsDir: path.join(ROOT, "src/reviews"),
		ignoreFile: path.join(ROOT, "scripts/bookorbit-ignore.txt"),
		timeZone: process.env.BOOKORBIT_TIMEZONE || DEFAULT_TIME_ZONE,
		dryRun: args.dryRun,
	});

	const verb = args.dryRun ? "Would add" : "Added";
	console.log(`${verb} ${report.added.length} review(s); ${report.skipped.existing} already on the site, ${report.skipped.noReview} rated without a review.`);
	for (const r of report.added) {
		console.log(`  + ${r.title} by ${r.author} (${r.rating}/5, ${r.date}${r.isbn ? `, ${r.isbn}` : ""})`);
		for (const w of r.warnings) console.log(`    ! ${w}`);
	}
	for (const s of report.skipped.incomplete) console.log(`  - skipped ${s}`);

	if (args.report) fs.writeFileSync(args.report, `${JSON.stringify(report, null, 2)}\n`);
	if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `added=${args.dryRun ? 0 : report.added.length}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((err) => {
		console.error(err.message);
		process.exit(1);
	});
}
