const fs = require("node:fs");
const path = require("node:path");

module.exports = function (eleventyConfig) {
	eleventyConfig.addPassthroughCopy("src/assets");
	eleventyConfig.addPassthroughCopy({
		"src/CNAME": "CNAME",
		"src/.nojekyll": ".nojekyll",
	});

	eleventyConfig.on("eleventy.after", ({ dir }) => {
		const from = path.join(dir.output, "feed", "index.xml");
		if (fs.existsSync(from)) {
			fs.copyFileSync(from, path.join(dir.output, "feed.xml"));
		}
	});

	eleventyConfig.addCollection("posts", (api) =>
		api.getFilteredByGlob("src/blog/posts/*.md").sort((a, b) => b.date - a.date)
	);

	// Tags, series, and the year archive. Everything is built from the posts collection, newest first.
	const blogPosts = (api) =>
		api.getFilteredByGlob("src/blog/posts/*.md").sort((a, b) => b.date - a.date);

	eleventyConfig.addCollection("postTags", (api) => {
		const tags = new Set();
		for (const post of blogPosts(api)) {
			for (const tag of post.data.tags || []) {
				if (!["all", "posts"].includes(tag)) tags.add(tag);
			}
		}
		return [...tags].sort((a, b) => a.localeCompare(b));
	});

	eleventyConfig.addCollection("postsByYear", (api) => {
		const years = new Map();
		for (const post of blogPosts(api)) {
			const year = post.date.getUTCFullYear();
			if (!years.has(year)) years.set(year, []);
			years.get(year).push(post);
		}
		return [...years].map(([year, posts]) => ({ year, posts }));
	});

	// A series is any posts that share a `series` name in front matter, read oldest first.
	// `seriesPart` sets the order explicitly; otherwise it's by date.
	eleventyConfig.addCollection("series", (api) => {
		const series = new Map();
		for (const post of [...blogPosts(api)].reverse()) {
			const name = post.data.series;
			if (!name) continue;
			if (!series.has(name)) series.set(name, []);
			series.get(name).push(post);
		}
		return [...series].map(([name, posts]) => ({
			name,
			posts: posts.sort(
				(a, b) => (a.data.seriesPart ?? Infinity) - (b.data.seriesPart ?? Infinity) || a.date - b.date
			),
		}));
	});

	eleventyConfig.addFilter("readableDate", (dateObj) =>
		new Intl.DateTimeFormat("en-US", {
			year: "numeric",
			month: "long",
			day: "numeric",
			timeZone: "UTC",
		}).format(dateObj)
	);

	eleventyConfig.addFilter("htmlDate", (dateObj) =>
		new Date(dateObj).toISOString().slice(0, 10)
	);

	eleventyConfig.addFilter("rfc822", (dateObj) => new Date(dateObj).toUTCString());

	eleventyConfig.addFilter("xmlEscape", (value) =>
		String(value ?? "")
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll('"', "&quot;")
			.replaceAll("'", "&apos;")
	);

	// Serve every <img> in the built pages as responsive AVIF and WebP, with a resized original as the fallback.
	// Width and height come from the image itself, so the markup can't drift from the file.
	const { eleventyImageTransformPlugin } = require("@11ty/eleventy-img");
	eleventyConfig.addPlugin(eleventyImageTransformPlugin, {
		formats: ["avif", "webp", "auto"],
		widths: [320, 640, 960, 1280],
		urlPath: "/assets/img/opt/",
		outputDir: "./_site/assets/img/opt/",
		// The source PNGs are palette images; keep the fallback that way too instead of ballooning to full color.
		sharpPngOptions: { palette: true, quality: 90, compressionLevel: 9, effort: 10 },
		htmlOptions: {
			imgAttributes: {
				loading: "lazy",
				decoding: "async",
				sizes: "(min-width: 712px) 640px, 90vw",
			},
		},
	});

	eleventyConfig.addWatchTarget("src/assets/css");
	eleventyConfig.addWatchTarget("src/assets/js");

	require("./lib/reviews.js")(eleventyConfig);
	require("./lib/covers.js")(eleventyConfig);

	eleventyConfig.setServerOptions({
		port: 8888,
	});

	return {
		dir: {
			input: "src",
			output: "_site",
			includes: "_includes",
			data: "_data",
		},
		markdownTemplateEngine: "njk",
		htmlTemplateEngine: "njk",
		templateFormats: ["md", "njk", "html", "xml"],
	};
};
