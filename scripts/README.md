# BookOrbit review sync

A GitHub Action reads my private reviews from [BookOrbit](https://github.com/bookorbit/bookorbit) once a day and opens one pull request with any that aren't on the site yet. I look them over and merge.

- `sync-bookorbit-reviews.mjs` fetches the reviews and writes `src/reviews/<slug>.md` files.
- `open-bookorbit-pr.mjs` commits the new files (reviews and covers) to the `bookorbit-sync` branch and opens or updates the pull request.
- `bookorbit-ignore.txt` lists books to never add (one ISBN or title per line).
- `.github/workflows/bookorbit-sync.yml` runs both daily at 14:17 UTC, and on demand from the Actions tab (with a dry-run option that only prints what it would add).

Both scripts use Node's built-in `fetch`; there are no new dependencies.

## Setup

1. In BookOrbit, go to **Settings > You > API keys** and create a key. **Read** access, no permissions, and all libraries is enough. Keys expire after 90 days by default, so pick 365 days or never, or the sync starts failing with a 401 when it runs out.
2. In the repository, go to **Settings > Secrets and variables > Actions** and add:
   - `BOOKORBIT_API_KEY`: the key (starts with `bok_`).
   - `BOOKORBIT_URL`: the address of the BookOrbit server, like `https://books.example.com`. It can be a repository variable instead of a secret.
   - Optional variable `BOOKORBIT_TIMEZONE`: an IANA time zone for turning finish times into dates. Defaults to `America/Phoenix`, which is UTC-7 all year.
3. In **Settings > Actions > General > Workflow permissions**, turn on **Allow GitHub Actions to create and approve pull requests**. Without it, the last step fails when it tries to open the PR.

The server must be reachable from GitHub's runners. A BookOrbit instance that is only on a home network or behind a VPN can't be polled from here.

## What gets synced

In BookOrbit a "private review" is the **Personal Review** on a book (`personalNote`), with the reader's own star rating. Both are per user and never visible to anyone else. A book is turned into a review file when it has a rating and a non-empty personal review.

BookOrbit routes used, with a read-only key:

- `POST /api/v1/books/query` with a `rating isNotEmpty` filter, sorted by `finishedAt`, 100 per page.
- `GET /api/v1/books/{id}` for each book not already on the site, for `personalNote`, `isbn13`, `isbn10` and `readStatus.finishedAt`.

The `/api/v1/notebook/*` routes would be simpler, but BookOrbit refuses API keys on them.

| Review file | From BookOrbit |
| --- | --- |
| `title` | the book's title |
| `author` | its authors, joined with a comma |
| `date` | when I finished it (`readStatus.finishedAt`), as a date in my time zone. If it has none, the day the review was last edited, flagged in the PR. |
| `rating` | my rating, a whole number from 1 to 5 (BookOrbit has no half stars) |
| `isbn` | `isbn13`, or `isbn10` converted to ISBN-13. Left out if the book has neither, and flagged in the PR. |
| body | the personal review text, as written |

A book is skipped when its ISBN (`isbn` or `bookshopIsbn`) or its slug already matches a file in `src/reviews/`, or when it is in `bookorbit-ignore.txt`. Book titles become the file name: `The Left Hand of Darkness` is `the-left-hand-of-darkness.md`.

Covers aren't fetched by the sync. The workflow runs the site build on the new files, and the build fetches covers by ISBN the way it does for any review (Open Library, then the Bookshop/Ingram CDN), writing them to `src/assets/img/covers/`. Those files go into the PR too. A review without a cover still builds.

## The pull request

- The first run with something new creates the `bookorbit-sync` branch from trunk and opens a PR.
- While that PR is open, later runs add new reviews as further commits on the same branch, so edits I make there are kept. The PR description gets a new "Added" section.
- After I merge or close it, the next new review starts a fresh PR. The branch is recreated from trunk.
- A review I delete from the open PR comes back on the next run unless it is in `bookorbit-ignore.txt`.

Commits are made with GitHub's API (`createCommitOnBranch`) using the workflow's `GITHUB_TOKEN`, so GitHub signs them and they show as `github-actions[bot]`, not me. Pull requests opened with `GITHUB_TOKEN` don't trigger other workflows, so a PR check wouldn't run on this PR automatically (the repository has only the deploy workflow today, which runs on pushes to trunk, and that still runs when I merge). To get checks on it, store a personal access token as a secret and use it in place of `github.token` in the last step.

## Testing

```bash
node --test "scripts/*.test.mjs"
```

The tests use a fake BookOrbit server and a fake GitHub API, with the fixture library in `scripts/fixtures/bookorbit/library.json`. No network access or real keys are involved.
