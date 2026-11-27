// Book reviews: collection, star filter, and build-time validation.
// Front matter for each file in src/reviews/ is documented in src/reviews/reviews.11tydata.js.

// First ~160 characters of a review, cut at a word boundary, for meta descriptions.
function excerpt(text, length = 160) {
	const plain = String(text ?? "")
		.replace(/^---[\s\S]*?---/, "")
		.replace(/[*_`>#\[\]]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	if (plain.length <= length) return plain;
	return plain.slice(0, length).replace(/\s+\S*$/, "").replace(/[,;:.\s]+$/, "") + "…";
}

module.exports = function (eleventyConfig) {
	eleventyConfig.addCollection("reviews", (api) => {
		const reviews = api.getFilteredByGlob("src/reviews/*.md");

		for (const review of reviews) {
			const { title, author, rating, isbn } = review.data;
			const where = review.inputPath;

			if (!title) throw new Error(`${where}: a review needs a title (the book's title).`);
			if (!author) throw new Error(`${where}: a review needs an author.`);
			if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
				throw new Error(`${where}: rating must be a whole number from 1 to 5 (got ${JSON.stringify(rating)}).`);
			}
			if (isbn !== undefined && !/^(\d{9}[\dX]|\d{13})$/.test(String(isbn))) {
				throw new Error(`${where}: isbn must be 10 or 13 characters with no hyphens (got ${JSON.stringify(isbn)}).`);
			}
		}

		return reviews.sort((a, b) => b.date - a.date);
	});

	// 3 -> ★★★☆☆ (plain text, for feeds)
	eleventyConfig.addFilter("stars", (rating) => "★".repeat(rating) + "☆".repeat(5 - rating));

	// 3 -> five inline SVG stars, three filled. Decorative: the wrapper carries the accessible label.
	const star = (on) =>
		`<svg class="star${on ? " star--on" : ""}" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false"><path d="M12 2.5l2.94 6.26 6.84.82-5.05 4.7 1.34 6.78L12 17.6l-6.07 3.46 1.34-6.78-5.05-4.7 6.84-.82z"/></svg>`;
	eleventyConfig.addFilter("starIcons", (rating) =>
		Array.from({ length: 5 }, (_, i) => star(i < rating)).join("")
	);
};

module.exports.excerpt = excerpt;
