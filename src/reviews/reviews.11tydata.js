const { excerpt } = require("../../lib/reviews.js");
const { resolveCover } = require("../../lib/covers.js");

// Book reviews live in this folder, one markdown file per book. The review is the body of the file.
//
// Front matter:
//   title         (required)  The book's title.
//   author        (required)  The book's author.
//   date          (required)  The day I finished the book, as YYYY-MM-DD.
//   rating        (required)  A whole number from 1 to 5. The build fails on anything else.
//   isbn          (optional)  10 or 13 characters, no hyphens.
//   bookshopIsbn  (optional)  ISBN to use for the Bookshop.org link, if it differs from isbn.
//   cover         (optional)  Path to a local cover image, e.g. /assets/img/covers/my-book.jpg.
//                             Overrides the ISBN-based cover.
//
// The page's meta description and social preview text come from the start of the review.
// The social preview image is the cover, when one is available.
module.exports = {
	layout: "layouts/review.njk",
	permalink: "/reviews/{{ page.fileSlug }}/",
	eleventyComputed: {
		description: (data) => excerpt(data.page.rawInput),
		coverImage: (data) =>
			resolveCover({
				title: data.title,
				author: data.author,
				isbn: data.isbn,
				cover: data.cover,
			}),
		image: (data) => data.coverImage?.social,
		imageAlt: (data) => data.coverImage?.alt,
	},
};
