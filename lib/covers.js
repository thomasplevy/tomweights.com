// Resolve, and if needed fetch, book cover images for reviews.
//
// Preferred source is a file already in src/assets/img/covers/ (committed, so
// CI does not depend on a third-party API). Front matter `cover` (a local
// path) wins when set. Otherwise, if an ISBN is present and no local file
// exists, the build tries Open Library and then the Bookshop/Ingram CDN.
// A failed fetch is ignored: the page just renders without a cover.
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { spawnSync } = require("node:child_process");

const COVERS_DIR = path.join(__dirname, "../src/assets/img/covers");
const PUBLIC_BASE = "/assets/img/covers";

function jpegSize(buf) {
	if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
	let i = 2;
	while (i < buf.length - 9) {
		if (buf[i] !== 0xff) {
			i += 1;
			continue;
		}
		const marker = buf[i + 1];
		if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			i += 2;
			continue;
		}
		const size = (buf[i + 2] << 8) + buf[i + 3];
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			return { height: (buf[i + 5] << 8) + buf[i + 6], width: (buf[i + 7] << 8) + buf[i + 8] };
		}
		i += 2 + size;
	}
	return null;
}

function fetchBuffer(url, timeoutMs = 8000) {
	return new Promise((resolve, reject) => {
		const req = https.get(
			url,
			{ headers: { "User-Agent": "tomweights.com review covers" }, timeout: timeoutMs },
			(res) => {
				if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
					res.resume();
					const next = new URL(res.headers.location, url).href;
					fetchBuffer(next, timeoutMs).then(resolve, reject);
					return;
				}
				if (res.statusCode !== 200) {
					res.resume();
					reject(new Error(`HTTP ${res.statusCode}`));
					return;
				}
				const chunks = [];
				res.on("data", (c) => chunks.push(c));
				res.on("end", () => resolve(Buffer.concat(chunks)));
			}
		);
		req.on("timeout", () => {
			req.destroy();
			reject(new Error("timeout"));
		});
		req.on("error", reject);
	});
}

function isJpeg(buf) {
	return buf && buf.length > 1000 && buf[0] === 0xff && buf[1] === 0xd8 && jpegSize(buf);
}

async function downloadCover(isbn) {
	const sources = [
		`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`,
		`https://images-us.bookshop.org/ingram/${isbn}.jpg`,
	];
	for (const url of sources) {
		try {
			const buf = await fetchBuffer(url);
			if (isJpeg(buf)) return buf;
		} catch {
			// try the next source
		}
	}
	return null;
}

function generateVariants(sourcePath) {
	const script = `
from pathlib import Path
from PIL import Image
src = Path(${JSON.stringify(sourcePath)})
im = Image.open(src).convert("RGB")
isbn = src.stem
out = src.parent
widths = [160]
if im.width >= 300:
    widths.append(min(320, im.width))
if im.width >= 600:
    widths.append(min(640, im.width))
if all(abs(im.width - w) > 20 for w in widths):
    widths.append(im.width)
for width in widths:
    height = round(im.height * width / im.width)
    resized = im if width == im.width else im.resize((width, height), Image.Resampling.LANCZOS)
    resized.save(out / f"{isbn}-{width}.jpg", "JPEG", quality=85, optimize=True, progressive=True)
    resized.save(out / f"{isbn}-{width}.webp", "WEBP", quality=80, method=6)
`;
	const result = spawnSync("python3", ["-c", script], { encoding: "utf8" });
	if (result.status !== 0) {
		// PIL may be missing in CI; the source JPEG is enough to render.
		return;
	}
}

function listVariants(stem) {
	if (!fs.existsSync(COVERS_DIR)) return [];
	const found = [];
	for (const name of fs.readdirSync(COVERS_DIR)) {
		const m = name.match(new RegExp(`^${stem}-(\\d+)\\.jpg$`));
		if (!m) continue;
		const width = Number(m[1]);
		const jpg = path.join(COVERS_DIR, name);
		const size = jpegSize(fs.readFileSync(jpg)) || {
			width,
			height: Math.round(width * 1.5),
		};
		const webpName = `${stem}-${width}.webp`;
		found.push({
			width,
			height: size.height,
			src: `${PUBLIC_BASE}/${name}`,
			webp: fs.existsSync(path.join(COVERS_DIR, webpName)) ? `${PUBLIC_BASE}/${webpName}` : null,
		});
	}
	return found.sort((a, b) => a.width - b.width);
}

function srcset(variants, key) {
	return variants
		.filter((v) => v[key])
		.map((v) => `${v[key]} ${v.width}w`)
		.join(", ");
}

function pick(variants, target) {
	return [...variants].reverse().find((v) => v.width <= target) || variants[0];
}

function pack(alt, sourceUrl, sourceSize, variants) {
	if (!variants.length && sourceUrl && sourceSize) {
		const single = { width: sourceSize.width, height: sourceSize.height, src: sourceUrl, webp: null };
		variants = [single];
	}
	if (!variants.length) return null;
	const page = pick(variants, 320);
	const thumb = pick(variants, 160);
	const largest = variants[variants.length - 1];
	return {
		alt,
		social: sourceUrl || largest.src,
		page: {
			src: page.src,
			srcset: srcset(variants, "src"),
			webpSrcset: srcset(variants, "webp"),
			width: page.width,
			height: page.height,
		},
		thumb: {
			src: thumb.src,
			srcset: srcset(variants, "src"),
			webpSrcset: srcset(variants, "webp"),
			width: thumb.width,
			height: thumb.height,
		},
	};
}

function localPathFromCover(cover) {
	if (!cover) return null;
	let rel = String(cover).trim();
	if (rel.startsWith("/assets/")) rel = path.join("src", rel.slice(1));
	else if (rel.startsWith("assets/")) rel = path.join("src", rel);
	return path.resolve(rel);
}

async function ensureCover({ isbn, cover }) {
	if (cover) {
		const file = localPathFromCover(cover);
		if (file && fs.existsSync(file)) return;
		return;
	}
	if (!isbn) return;
	const source = path.join(COVERS_DIR, `${isbn}.jpg`);
	if (fs.existsSync(source)) {
		if (!listVariants(isbn).length) generateVariants(source);
		return;
	}
	const buf = await downloadCover(isbn);
	if (!buf) return;
	fs.mkdirSync(COVERS_DIR, { recursive: true });
	fs.writeFileSync(source, buf);
	generateVariants(source);
}

function resolveCover({ title, author, isbn, cover }) {
	const alt = [title, author].every(Boolean) ? `${title} by ${author} cover` : "Book cover";
	if (cover) {
		const file = localPathFromCover(cover);
		if (!file || !fs.existsSync(file)) return null;
		const buf = fs.readFileSync(file);
		const size = jpegSize(buf) || { width: 320, height: 480 };
		const publicUrl = file.includes(`${path.sep}src${path.sep}assets${path.sep}`)
			? `/assets/${file.split(`${path.sep}src${path.sep}assets${path.sep}`).pop().replaceAll(path.sep, "/")}`
			: null;
		if (!publicUrl) return null;
		const stem = path.basename(file, path.extname(file));
		const dir = path.dirname(file);
		// Variants live next to an override, named <stem>-<width>.jpg, if present.
		const variants = [];
		if (fs.existsSync(dir)) {
			for (const name of fs.readdirSync(dir)) {
				const m = name.match(new RegExp(`^${stem}-(\\d+)\\.jpg$`));
				if (!m) continue;
				const width = Number(m[1]);
				const jpg = path.join(dir, name);
				const dim = jpegSize(fs.readFileSync(jpg)) || { width, height: Math.round(width * 1.5) };
				const webp = `${stem}-${width}.webp`;
				const base = publicUrl.replace(/\/[^/]+$/, "");
				variants.push({
					width,
					height: dim.height,
					src: `${base}/${name}`,
					webp: fs.existsSync(path.join(dir, webp)) ? `${base}/${webp}` : null,
				});
			}
		}
		variants.sort((a, b) => a.width - b.width);
		return pack(alt, publicUrl, size, variants);
	}
	if (!isbn) return null;
	const source = path.join(COVERS_DIR, `${isbn}.jpg`);
	if (!fs.existsSync(source)) return null;
	const size = jpegSize(fs.readFileSync(source));
	return pack(alt, `${PUBLIC_BASE}/${isbn}.jpg`, size, listVariants(isbn));
}

function bookshopUrl(isbn, affiliateId) {
	const id = String(isbn || "").replace(/[^\dX]/gi, "");
	if (!id) return "";
	const aff = String(affiliateId || "").trim();
	return aff ? `https://bookshop.org/a/${encodeURIComponent(aff)}/${id}` : `https://bookshop.org/book/${id}`;
}

function parseReviewFrontMatter(file) {
	const raw = fs.readFileSync(file, "utf8");
	const block = raw.match(/^---\n([\s\S]*?)\n---/);
	if (!block) return {};
	const data = {};
	for (const line of block[1].split("\n")) {
		const m = line.match(/^(isbn|cover):\s*(?:"([^"]*)"|'([^']*)'|(\S+))\s*$/);
		if (m) data[m[1]] = m[2] ?? m[3] ?? m[4];
	}
	return data;
}

module.exports = function (eleventyConfig) {
	eleventyConfig.addFilter("bookshopUrl", bookshopUrl);

	eleventyConfig.on("eleventy.before", async () => {
		const dir = path.join(__dirname, "../src/reviews");
		if (!fs.existsSync(dir)) return;
		for (const name of fs.readdirSync(dir)) {
			if (!name.endsWith(".md")) continue;
			try {
				await ensureCover(parseReviewFrontMatter(path.join(dir, name)));
			} catch (err) {
				console.warn(`[covers] skipped ${name}: ${err.message}`);
			}
		}
	});
};

module.exports.resolveCover = resolveCover;
module.exports.bookshopUrl = bookshopUrl;
