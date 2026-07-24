# Product

**Omniport is a multi-tenant platform that helps businesses get found in Google and AI search.**

This page is the product overview — what Omniport does and where it's going. For
how it's built, see [Architecture](architecture.md).

## Who it's for

Any business that depends on being discovered online — no regional limit. The
common thread is a website (a store, a service, a brand) whose owner needs it to
show up when customers search, whether that search happens in Google or inside an
AI assistant.

## The problem

Search is shifting. People increasingly ask an AI assistant (ChatGPT, Gemini,
AI Overviews) instead of scrolling a results page — and those assistants only
surface sites they can read and trust. A business can rank fine in classic Google
and still be invisible to AI answers. Most owners have no idea how visible they
are to this new layer, or what to fix.

Omniport's job is to make that visibility measurable and improvable, in one place.

## What it does today

**GEO site audit (SiteAudit).** Point it at a site and it runs an asynchronous
audit of how visible that site is to AI search — checking the things AI crawlers
rely on (crawler access, rendering, structured data, core metadata, an
`llms.txt`, basic authority signals). It returns concrete findings: what's in
good shape and what needs work, each with the reason behind it.

Around that sit the platform capabilities every account gets: sign-in
(email + Google), per-workspace data isolation, file storage, and in-app
notifications (e.g. "your audit is ready").

## Roadmap

Planned, not yet built — the direction Omniport is heading:

- **SEO/GEO content generation** — produce search- and AI-optimized content, so a
  business can act on an audit instead of just reading it.
- **Publishing to WordPress and Shopify** — push that content straight to where the
  business already runs, closing the loop from "audit" to "published and findable".

The throughline: **audit → create → publish → get found** — in both Google and AI.

## Under the hood

Omniport is built on a deliberately product-agnostic, multi-tenant SaaS
foundation (authentication, tenancy, files, notifications, background jobs, audit
logging). GEO is the first product module on top of it; the roadmap modules will
be added the same way. See [Architecture](architecture.md) for the details.
