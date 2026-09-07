# Marketing showcase subjects

The portal renders live API responses, so every marketing surface names a real fighter. Subjects are chosen on
**measured data quality**, and the primary composition leads with men's divisions, which carry the majority of the
audience and the deepest archive coverage. Women's divisions remain fully supported and visible: they appear in the
Fight Week co-main strip, in Workspace search and rankings for every division, and throughout the docs.

Re-run the audit with `node scripts/snapshot-upstream.mjs` plus a coverage query when the archive grows.

| Surface | Subject | Why | Portrait |
| --- | --- | --- | --- |
| Hero poster | **Jean Silva vs Jose Miguel Delgado** — Noche UFC main event, featherweight, 5 rounds | The actual next-card main event | Silva: The White House, public domain (audited, see below). Delgado: none in the registry, rendered as a cage name-lockup, never a generic silhouette |
| Fighter API | **Justin Gaethje** — lightweight champion, P4P #4, 28-5 | Best male combination of rank, portrait and coverage: 3 stat-covered bouts, 9 rounds, 2,700 observed seconds, and every headline metric at `medium` confidence | Public domain |
| Matchup DNA | **Sean Strickland vs Gregory Rodrigues** — middleweight champion vs #7 | Best-comparing male pair in the archive: 17 of 18 metrics comparable with both sides non-null, 12 threshold-cleared insights, same-stance context, one coherent division | Both CC BY-SA 4.0 / CC BY 3.0 |
| Rankings | **Middleweight** | Deepest portrait coverage of any division: champion plus 7 of the top 8 and 13 of 15 ranked fighters carry rights-cleared media | — |
| Provenance receipts | **Sean Strickland** | A real `MetricObject` with a genuinely low sample, which is the point of the section | CC BY-SA 4.0 |
| Fight Week co-main | **Manon Fiorot vs Alexa Grasso** — women's flyweight | Keeps women's divisions on the primary surface and proves every division resolves through the same endpoints | Both CC BY 3.0 |

## Division coverage audit (2026-09-07)

| Division | Champion | Champion portrait | Top-8 portraits | Top-15 portraits |
| --- | --- | --- | --- | --- |
| Middleweight | Sean Strickland | yes | 7/8 | 13/15 |
| Lightweight | Justin Gaethje | yes | 7/8 | 12/15 |
| Welterweight | Islam Makhachev | yes | 7/8 | 10/15 |
| Featherweight | Alexander Volkanovski | yes | 6/8 | 9/15 |
| Flyweight | Joshua Van | yes | 6/8 | 7/15 |
| Bantamweight | Petr Yan | yes | 5/8 | 8/15 |
| Light heavyweight | Carlos Ulberg | no | 5/8 | 10/15 |
| Heavyweight | Tom Aspinall | no | 6/8 | 7/15 |

## Image policy

`apps/web/src/lib/media.ts` gates every marketing portrait behind a licence allowlist (CC BY, CC BY-SA, CC0,
public domain) and always renders the credit. A fighter with no approved asset gets the fight-poster name lockup in
the hero and an original silhouette elsewhere, never a stock photograph.

**Audit log.** The Jean Silva portrait was held from marketing on 2026-09-07 because its credit read
"The White House (U.S. Government work), Public domain". It was verified the same day and released:
`commons.wikimedia.org/wiki/File:Jean_Silva_(54451587575).jpg` resolves, the artist is "The White House", the
licence is public domain, the credit points at the official White House Flickr account, and the description
records it as an official White House photo taken at UFC 314. `AUDIT_HOLD` in `media.ts` is the mechanism for any
future asset whose attribution needs checking before it appears in marketing.

## Cross-links to PropBetEdge UFC

`ufc.proptechusa.ai` is the API and engine. `ufc.propbetedge.ai` is the production application built
on the same UFC intelligence layer. The site says exactly that and no more: it never claims the
consumer product is exclusively powered by the commercial API, and it adds no schema.org markup
asserting ownership or affiliation beyond the real PropTechUSA / PropBetEdge relationship. All
cross-links are ordinary crawlable anchors with no `target`, no `download`, and no interstitial.

### How a link is resolved (no hard-coded slugs)

`scripts/refresh-showcase.mjs` writes `product_links` into the generated snapshot on every refresh:

| key | resolution |
| --- | --- |
| `rankings`, `fight_week`, `fighters_index`, `events_index` | fixed routes on the consumer site |
| `fighter` | `/fighters/<name>-<slug_id>`, using the `slug_id` the canonical API itself returns |
| `matchup`, `hero_fight` | `/fights/<a>-vs-<b>-<event-slug>-<date>`, where the event slug comes from the resolved event URL |
| `event`, `event_pregame` | `/events/…` and `/pregame/…` matched on the event date |
| `rankings_champion` | the champion's `slug_id`, resolved with one extra fighter lookup |

Resolution order is sitemap first, then a bounded liveness check. The consumer sitemap is a *subset*
of the site (about 1,000 fighter URLs against a larger and growing archive), so a page can be live
and unlisted; Sean Strickland's profile is one such case. A candidate URL built from canonical
identifiers is therefore confirmed with a single request, capped at 8 probes per refresh against one
first-party host. Anything that does not answer 200 becomes `null`, and the UI falls back to a
section index. **A guessed slug is never published.**

If the consumer site is unreachable at refresh time the refresh still succeeds: deep links degrade to
section indexes and the snapshot is still written. A cross-link failure never fails the build.

### Where the links appear

| surface | destination |
| --- | --- |
| Hero, third CTA | consumer home |
| Product proof section, four tiles | Fight Week, fighter, matchup, rankings |
| Fighter / Fight Week / Matchup / Rankings demos | the closest matching consumer surface |
| Docs build guides (fighter, card, compare, rankings, Fight Week) | Production example callout |
| Workspace result panel | Fight Week, fighter, matchup or rankings for the current tool |
| Footer, Network column | PropBetEdge UFC, PropBetEdge, PropTechUSA |
| Final CTA | Explore PropBetEdge UFC |

The Workspace builds its fighter link client-side from the `slug_id` in the response, and only uses a
matchup deep link for the pair the snapshot already verified; everything else falls back to Fight Week
or a section index.
