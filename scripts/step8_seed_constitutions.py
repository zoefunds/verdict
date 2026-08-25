#!/usr/bin/env python3
"""
step8_seed_constitutions.py

Seeds the Postgres constitutions/constitution_versions/constitution_articles
tables so the frontend's "Constitution / Resolution Recipe" picker on Create
Case is populated. This was empty in production, blocking end-to-end case
creation testing.

The genesis "General Dispute" constitution's core articles match exactly
what was passed to the deployed contract's constructor (see
docs/MEMORY.md "Deployed contract"), so the off-chain description stays
truthful to what's actually enforced on-chain. A "Delivery Dispute" category
constitution is added on top of it for the specific test case being used to
exercise the app (per the spec's DELIVERY DISPUTE CONSTITUTION example).

This writes a one-off Node script (seed.mjs) into backend/ and runs it with
the production DATABASE_URL, since Drizzle's schema/client are TypeScript
and this needs to run against whichever Postgres the caller points it at
(local Docker for dev, or production via `flyctl ssh console`).

Usage (local dev, uses backend/.env DATABASE_URL):
    cd /Users/macbook/verdict
    python3 scripts/step8_seed_constitutions.py

Usage (production, run the generated script inside the Fly machine):
    flyctl ssh console --app verdict-backend --command "node dist/db/seed.js"
    (see below — this script also drops a compiled-friendly seed source
    into backend/src/db/seed.ts so it ships in the Docker image and can be
    run the same way as migrate.js)
"""

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND = PROJECT_ROOT / "backend"

SEED_TS = """\
/**
 * Seeds baseline constitutions so the frontend's constitution picker isn't
 * empty. Idempotent: skips a constitution slug that already exists.
 *
 * The "general-dispute" constitution's 3 core articles match exactly what
 * was passed to contracts/verdict_contract.py's constructor at deploy time
 * (see docs/MEMORY.md) — this off-chain copy exists purely for display
 * (the "Applicable Rules" panel), the on-chain copy is the enforced one.
 */

import "dotenv/config";
import { db } from "./client.js";
import { constitutions, constitutionVersions, constitutionArticles } from "./schema.js";
import { eq } from "drizzle-orm";

type SeedArticle = { articleNumber: number; title: string; body: string; isImmutableCore: boolean };

type SeedConstitution = {
  slug: string;
  title: string;
  category: string;
  description: string;
  articles: SeedArticle[];
};

const SEEDS: SeedConstitution[] = [
  {
    slug: "general-dispute",
    title: "General Dispute Constitution",
    category: "custom",
    description:
      "The platform-wide immutable core articles every VERDICT case is bound by, matching the genesis constitution passed to the deployed contract's constructor.",
    articles: [
      {
        articleNumber: 1,
        title: "Evidence-Grounded Verdicts",
        body: "Verdicts must be grounded only in submitted or independently-verified evidence, never in the relative size of either party's stake.",
        isImmutableCore: true,
      },
      {
        articleNumber: 2,
        title: "Right to Evidence and Appeal",
        body: "Every party has the right to submit evidence and to one appeal.",
        isImmutableCore: true,
      },
      {
        articleNumber: 3,
        title: "No Advantage from Evidence Volume",
        body: "A verdict must never be influenced by which party submitted more or longer evidence.",
        isImmutableCore: true,
      },
    ],
  },
  {
    slug: "delivery-dispute",
    title: "Delivery Dispute Constitution",
    category: "delivery",
    description:
      "For claims that a purchased item, service milestone, or freelance deliverable was not delivered as agreed.",
    articles: [
      {
        articleNumber: 1,
        title: "Proof of Shipment / Delivery Must Be Independently Verifiable",
        body: "Proof of shipment or delivery must be independently verifiable — a tracking number, staging URL, signed receipt, or equivalent third-party-checkable record, not a bare assertion.",
        isImmutableCore: false,
      },
      {
        articleNumber: 2,
        title: "Assertion Alone Is Insufficient",
        body: "A respondent's assertion of delivery alone does not establish delivery occurred; a claimant's assertion of non-delivery alone does not establish non-delivery occurred.",
        isImmutableCore: false,
      },
      {
        articleNumber: 3,
        title: "Both Parties' Evidence Must Be Considered",
        body: "The resolution must consider evidence from both parties before rendering a verdict.",
        isImmutableCore: false,
      },
      {
        articleNumber: 4,
        title: "Third-Party Delays",
        body: "If a delay is verifiable as caused by a third party (e.g. a logistics provider) rather than either party to the case, standard delivery timelines are suspended for a reasonable period before refund conditions trigger.",
        isImmutableCore: false,
      },
    ],
  },
  {
    slug: "freelance-dispute",
    title: "Freelance Dispute Constitution",
    category: "freelance",
    description: "For claims that a freelancer or contractor did not deliver agreed work.",
    articles: [
      {
        articleNumber: 1,
        title: "Written Agreement Governs Scope",
        body: "The originally agreed scope, deliverables, and deadline (as documented at case creation) govern what 'delivered as agreed' means — later informal changes must be evidenced by both parties, not asserted by one.",
        isImmutableCore: false,
      },
      {
        articleNumber: 2,
        title: "Partial Delivery Is Evaluated Proportionally",
        body: "Partial completion of agreed milestones should be evaluated proportionally rather than resolved as strictly all-or-nothing where the evidence supports a partial outcome.",
        isImmutableCore: false,
      },
    ],
  },
];

async function main() {
  for (const seed of SEEDS) {
    const [existing] = await db.select().from(constitutions).where(eq(constitutions.slug, seed.slug)).limit(1);
    if (existing) {
      console.log(`SKIP  (already exists): ${seed.slug}`);
      continue;
    }

    const [constitution] = await db
      .insert(constitutions)
      .values({
        slug: seed.slug,
        title: seed.title,
        category: seed.category,
        description: seed.description,
        status: "active",
      })
      .returning();

    const [version] = await db
      .insert(constitutionVersions)
      .values({
        constitutionId: constitution!.id,
        versionNumber: 1,
        contractVersionRef: seed.slug === "general-dispute" ? "1" : null,
        changeSummary: "Genesis version.",
        isCurrent: true,
      })
      .returning();

    for (const article of seed.articles) {
      await db.insert(constitutionArticles).values({
        constitutionVersionId: version!.id,
        articleNumber: article.articleNumber,
        title: article.title,
        body: article.body,
        isImmutableCore: article.isImmutableCore,
        displayOrder: article.articleNumber,
      });
    }

    console.log(`SEEDED ${seed.slug} (constitution ${constitution!.id}, version ${version!.id})`);
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
"""


def write_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"WROTE {path.relative_to(PROJECT_ROOT)}")


def main() -> None:
    print(f"Step 8: seed constitutions — project root: {PROJECT_ROOT}\n")
    write_file(BACKEND / "src" / "db" / "seed.ts", SEED_TS)
    print("\nDone. Run locally with:")
    print("  cd backend && npm run db:seed")
    print("Or in production:")
    print("  flyctl ssh console --app verdict-backend --command \"node dist/db/seed.js\"")


if __name__ == "__main__":
    main()
