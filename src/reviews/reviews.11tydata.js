const { excerpt } = require("../../lib/reviews.js");

// Book reviews live in this folder, one markdown file per book. The review is the body of the file.
//
// Front matter:
//   title   (required)  The book's title.
//   author  (required)  The book's author.
//   date    (required)  The day I finished the book, as YYYY-MM-DD.
//   rating  (required)  A whole number from 1 to 5. The build fails on anything else.
//   isbn    (optional)  10 or 13 characters, no hyphens.
//
// The page's meta description and social preview text come from the start of the review.
module.exports = {
	layout: "layouts/review.njk",
	permalink: "/reviews/{{ page.fileSlug }}/",
	eleventyComputed: {
		description: (data) => excerpt(data.page.rawInput),
	},
};
