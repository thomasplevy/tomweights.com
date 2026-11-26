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

	require("./lib/reviews.js")(eleventyConfig);

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
