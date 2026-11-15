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
