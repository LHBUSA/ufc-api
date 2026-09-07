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
