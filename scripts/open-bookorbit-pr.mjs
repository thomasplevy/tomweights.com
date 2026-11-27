#!/usr/bin/env node
// Commit the review files the sync just wrote and open (or update) one pull request for them.
//
// Runs inside the "Sync BookOrbit reviews" workflow, after sync-bookorbit-reviews.mjs and a build
// (the build fetches covers into src/assets/img/covers). It only ever adds new files under
// src/reviews/ and src/assets/img/covers/, and never touches trunk directly.
//
// Commits go through GitHub's GraphQL createCommitOnBranch, not `git push`, so they are signed
// by GitHub. With the workflow's GITHUB_TOKEN they show up as github-actions[bot].
//
// If a sync PR is already open, the new files are committed on top of its branch, so edits I make
// in that PR are kept. Otherwise the branch is (re)created from trunk and a new PR is opened.
//
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY (owner/name); optional BASE_BRANCH (trunk),
//      SYNC_BRANCH (bookorbit-sync), SYNC_REPORT (path to the JSON report from the sync).
//      GITHUB_API_URL and GITHUB_GRAPHQL_URL are set by Actions; tests point them at a fake server.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const WATCHED = ["src/reviews", "src/assets/img/covers"];

// ---------- helpers (exported for tests) ----------

export function newFilesFromStatus(porcelainZ) {
	const files = [];
	for (const entry of porcelainZ.split("\0")) {
		if (!entry) continue;
		const code = entry.slice(0, 2);
		const file = entry.slice(3);
		if ((code === "??" || code.includes("A")) && WATCHED.some((dir) => file.startsWith(`${dir}/`))) files.push(file);
	}
	return files.sort();
}

export function reviewLine(r) {
	const stars = `${r.rating} ${r.rating === 1 ? "star" : "stars"}`;
	const lines = [`- **${r.title}** by ${r.author}: ${stars}, finished ${r.date} (\`${r.file}\`)`];
	for (const w of r.warnings || []) lines.push(`  - ${w}`);
	return lines.join("\n");
}

export function newPrBody(report) {
	return [
		"New reviews from my BookOrbit library, picked up by the daily sync.",
		"",
		...report.added.map(reviewLine),
		"",
		"Each is a markdown file in `src/reviews/`, with the cover in `src/assets/img/covers/` when one could be found. Edit or delete anything here before merging; reviews I merge are never added again, and a review I delete from this branch is only skipped if it is listed in `scripts/bookorbit-ignore.txt`.",
	].join("\n");
}

export function appendToPrBody(body, report, today) {
	return `${String(body || "").trimEnd()}\n\n**Added ${today}**\n\n${report.added.map(reviewLine).join("\n")}\n`;
}

// ---------- GitHub ----------

function makeApi(token, repo) {
	const apiUrl = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
	const graphqlUrl = process.env.GITHUB_GRAPHQL_URL || `${apiUrl}/graphql`;
	const headers = {
		Authorization: `Bearer ${token}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		"User-Agent": "tomweights-bookorbit-sync",
	};
	async function rest(method, route, body, okStatuses = [200, 201]) {
		const res = await fetch(`${apiUrl}/repos/${repo}${route}`, {
			method,
			headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) },
			body: body ? JSON.stringify(body) : undefined,
		});
		if (res.status === 404 && okStatuses.includes(404)) return null;
		if (okStatuses.includes(res.status)) return res.status === 204 ? null : res.json();
		const text = await res.text();
		throw new Error(`GitHub ${method} ${route} returned ${res.status}: ${text.slice(0, 300)}`);
	}
	async function graphql(query, variables) {
		const res = await fetch(graphqlUrl, {
			method: "POST",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify({ query, variables }),
		});
		const data = await res.json();
		if (!res.ok || data.errors) throw new Error(`GitHub GraphQL failed: ${JSON.stringify(data.errors || data).slice(0, 400)}`);
		return data.data;
	}
	return { rest, graphql };
}

const COMMIT_MUTATION = `mutation($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) { commit { oid url } }
}`;

async function main() {
	const token = process.env.GITHUB_TOKEN;
	const repo = process.env.GITHUB_REPOSITORY;
	if (!token || !repo) throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY are required.");
	const base = process.env.BASE_BRANCH || "trunk";
	const branch = process.env.SYNC_BRANCH || "bookorbit-sync";
	const report = JSON.parse(fs.readFileSync(process.env.SYNC_REPORT || "bookorbit-report.json", "utf8"));
	if (!report.added?.length) {
		console.log("No new reviews, so no pull request.");
		return;
	}

	const status = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...WATCHED], { encoding: "utf8" });
	const files = newFilesFromStatus(status);
	if (!files.length) throw new Error("The report lists new reviews but git sees no new files.");

	const { rest, graphql } = makeApi(token, repo);
	const owner = repo.split("/")[0];

	const open = await rest("GET", `/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}&base=${encodeURIComponent(base)}`);
	let pr = open[0] || null;
	let headSha;
	if (pr) {
		headSha = pr.head.sha;
		console.log(`Adding to open pull request #${pr.number}.`);
	} else {
		const baseRef = await rest("GET", `/git/ref/heads/${encodeURIComponent(base)}`);
		headSha = baseRef.object.sha;
		const existingRef = await rest("GET", `/git/ref/heads/${encodeURIComponent(branch)}`, null, [200, 404]);
		if (existingRef) await rest("PATCH", `/git/refs/heads/${encodeURIComponent(branch)}`, { sha: headSha, force: true });
		else await rest("POST", "/git/refs", { ref: `refs/heads/${branch}`, sha: headSha });
		console.log(`Branch ${branch} is at ${base} (${headSha.slice(0, 7)}).`);
	}

	const n = report.added.length;
	const headline = `Add ${n === 1 ? "a review" : `${n} reviews`} from BookOrbit`;
	const commit = await graphql(COMMIT_MUTATION, {
		input: {
			branch: { repositoryNameWithOwner: repo, branchName: branch },
			expectedHeadOid: headSha,
			message: { headline, body: report.added.map((r) => `- ${r.title} by ${r.author}`).join("\n") },
			fileChanges: {
				additions: files.map((file) => ({ path: file, contents: fs.readFileSync(file).toString("base64") })),
			},
		},
	});
	console.log(`Committed ${files.length} file(s): ${commit.createCommitOnBranch.commit.url}`);

	const today = new Date().toISOString().slice(0, 10);
	if (pr) {
		await rest("PATCH", `/pulls/${pr.number}`, { body: appendToPrBody(pr.body, report, today) });
		console.log(`Updated ${pr.html_url}`);
	} else {
		pr = await rest("POST", "/pulls", { title: "Add reviews from BookOrbit", head: branch, base, body: newPrBody(report) });
		console.log(`Opened ${pr.html_url}`);
	}
	if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Pull request: ${pr.html_url}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((err) => {
		console.error(err.message);
		process.exit(1);
	});
}
