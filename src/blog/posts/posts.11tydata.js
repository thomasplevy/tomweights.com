// Front matter for posts:
//   tags: [ ... ]      1-3 topics; each gets a page at /blog/tags/<tag>/
//   series: "Name"     optional; posts sharing a name get series navigation and /blog/series/<name>/
//   seriesPart: 2      optional; explicit order within a series (otherwise oldest first)
module.exports = {
	layout: "layouts/post.njk",
	permalink: "/blog/{{ page.fileSlug }}/",
};
