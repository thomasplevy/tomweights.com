---
title: The Bill Was the Most Honest Document We Had
description: The expensive surprises in AI tooling tend to live in the gap between the configuration you think you have and the one that's actually running.
date: 2026-11-15
tags:
  - AI
  - infrastructure
  - configuration
image: /assets/img/intended-vs-running-social.png
imageAlt: "The post title, The Bill Was the Most Honest Document We Had, in white monospace type on a dark background with a green bar along the left edge."
---
The design said our AI traffic went one way. The bill said it went another. Only one of those documents had been checked by anyone with a stake in being right, and it wasn't the design.

It started, the way these things usually do, with something unrelated breaking. Automated code reviews began failing with an error that amounted to "you can't afford this request." That was odd, because the system had been built so it shouldn't have been spending from that balance at all. The plan, written down, agreed upon, and generally believed, was that requests would go through an account we paid for directly, and a small prepaid balance would sit off to the side as a kind of emergency fund nobody touched.

So I went and looked at what had actually run. Not the diagram, not the settings page, but the provider's record of every request, one row at a time.

There's a column in that record that says whether a request used the route we'd intended. It said no on every row. Not most rows; every row. For weeks, everything we'd sent had gone down the path we had specifically designed around, and the prepaid balance had been quietly refilling itself whenever it ran low, because we'd (sensibly, at the time) turned on automatic top-ups. The emergency fund had become the operating budget, and nobody noticed, because a safety net that's doing its job looks exactly like nothing happening.

<p><img src="/assets/img/intended-vs-running-diagram.png" alt="A three-part diagram. First, what we thought was running: our AI tools send requests through the route we designed to an account we pay directly, while a prepaid balance waits off to the side. Second, what actually ran: our AI tools send requests through the default route to the prepaid balance, the designed route goes unused, and automatic top-ups refill the balance whenever it runs low. Third, how we found out: something unrelated fails, we read every request row by row, and the column for the intended route says no on every row." width="1440" height="1734"></p>

## Two documents wearing one name

Most teams believe they have one description of a system. They have at least two. There's the design: the doc, the diagram, the thread where someone wrote "we'll route it through our own account" and three people replied with a thumbs up. Then there's the running configuration, which is whatever the software actually reads when it starts, plus every default it falls back on when nothing tells it otherwise.

We treat these as the same document in different formats. They aren't. The design is a statement of intent, and intent is cheap to write and expensive to verify. The running configuration is a statement of fact that nobody reads, because everybody already knows what it says. (They wrote the design, after all.)

The gap opens in boring ways. A new integration gets set up in a hurry and inherits the default path, because the other one needed a setting nobody remembered. A tool upgrades and quietly changes what it asks for. An experiment that was supposed to last an afternoon keeps running for a month. Each of these is individually unremarkable, which is precisely why none of them trips an alarm.

AI tooling makes this worse in a particular way. The plumbing is new, the layers are stacked (a tool calls a service that calls another service that finally calls a model), and everything is metered by usage. So a misrouted request doesn't fail. It succeeds, at a different price, on a different meter. Most infrastructure mistakes announce themselves by breaking something. This kind just costs a little more, silently, many thousands of times, like a faucet that drips into a drain instead of onto the floor.

## Reading the invoice like a spec

There's an uncomfortable idea buried in all this: the bill was the most accurate architecture document we had. It didn't care what we intended. It recorded what happened, priced it, and sent it to us. In a perverse way it's the only artifact in the whole arrangement that's continuously audited by someone with a motive to get it right.

I don't love that. Documentation that arrives monthly, after the money is gone, is a poor substitute for knowing. But I've stopped pretending it isn't true. If you want to know how your AI tooling is actually wired, read the bill before you read the diagram. The diagram is what you hoped. The bill is what you did.

The part that bothered me more than the misrouting was how many settings looked correct. There was a toggle that said, in plain language, never to use the thing we were in fact using. There was a list of approved providers that was tidy and accurate. When the error finally appeared, it helpfully suggested raising a limit that had plenty of room left; the balance it was really talking about was a different one entirely. Each of those was true within its own little jurisdiction, and none of them governed the path the traffic took. A setting can be correct and irrelevant at the same time, and a page full of reassuring checkmarks says nothing about whether the requests are strolling past all of them through a side door.

"We meant to use this provider" isn't an implementation. It's a wish with a config file attached. Until somebody has looked at a request that actually went out and confirmed where it landed, the intended route is a rumor: a plausible one, repeated by everyone because everyone else repeats it.

## It's an incident, not an expense

I've come around to treating surprise AI spend the way I'd treat any other production surprise, rather than as a line item for finance to puzzle over. It's the same kind of failure as an outage. The system did something other than what we believed it did, and we found out late. The only difference is that an outage has the decency to be loud.

So the after-action looks the same as it would for anything else. Write down, plainly and without much ceremony, what we believed was running, what actually ran, and which check, done earlier, would have caught the difference.

That last part is where the value is, and it's almost always embarrassingly simple. Not a new monitoring platform. Not a cost dashboard from the vendor (which is, I'd note, another document describing what someone would like you to believe). Usually it's something closer to "look at one real request a week after you set this up," or "get told whenever the prepaid balance refills, because by design it never should."

It's also worth giving up the comforting idea that a careful design prevents this. We had a careful design. It was a good design! It just wasn't the one running, and the quality of a plan has remarkably little influence over whether anyone followed it.

I'd like to offer a framework here, partly because that's the custom and partly because frameworks are soothing. I don't really have one. What I have is a habit I'm trying to keep, which is to distrust my own description of a system until I've watched it do the thing. It's the same instinct that makes me weigh coffee beans instead of trusting the scoop. The scoop is a good-faith estimate. The scale is what ends up in the cup, and it has never once cared what I meant to brew.
