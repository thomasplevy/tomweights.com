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

	eleventyConfig.addWatchTarget("src/assets/css");
	eleventyConfig.addWatchTarget("src/assets/js");

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
