# Cresa ICP Batch Export and Qualification Review

**It means the review process became more efficient without lowering the standard for calling someone qualified.** There are two separate changes here: how Allman prepares the contacts for review, and how it decides whether the available evidence supports your Cresa targeting criteria.

The important distinction is that **a contact can match the right buyer role while their company fit and current real estate needs remain unverified.**

## 1. What “batch export now accepts saved groups” means

Previously, the review attempted to export the contacts individually. Each export rebuilt the relationship snapshot, even though the review was working through the same group of 49 people.

That created unnecessary repeated work. Your log shows one individual export exceeding its 40-second timeout.

The change allows the export command to accept a saved group, such as `cresa-review`, and prepare its contacts together. The source-run command shown in your log was:

```bash
bun src/index.ts \
  --store /Users/hack/.allman \
  --json \
  icp export cresa \
  --list cresa-review \
  --limit 100
```

Here, `cresa` identifies the configured ideal customer profile, or **ICP**; `cresa-review` identifies the saved review group; and `100` is the maximum number of contacts to include, not a request to find 100 new people. That group contained 49 contacts.

The practical difference is:

| Before | After |
|---|---|
| Attempt a separate export for each contact. | Export the saved group in one operation. |
| Repeatedly rebuild the relationship snapshot. | Prepare one snapshot for the batch. |
| Assemble the review from separate exports. | Review the contacts together from the same exported dataset. |

**This is an efficiency improvement, not an enrichment step.** It does not discover company headcounts, refresh LinkedIn profiles, or manufacture missing buying signals. It packages the evidence already stored locally.

“Regression test passes” means the new behavior passed its automated test. It does **not** mean that the contacts are qualified or that the underlying information has been independently verified.

## 2. Why the 49 contacts still remain “unknown”

The Cresa profile configured in this workflow has four criteria. In the subsequent review shown in your log, the available evidence was much narrower than those criteria require: **each of the 49 contacts had a stored headline, rather than a complete company-and-opportunity research record.**

The review treated two fresh CFO headlines as supporting the buyer-role criterion. It did not treat those titles as evidence for everything else.

| Criterion | What needs supporting evidence | What the recorded review established |
|---|---|---|
| **Buyer role** | A relevant internal role, such as CFO, corporate real estate, workplace, facilities, or procurement, with appropriate authority. | Two fresh headlines explicitly identified CFOs. Other headlines did not sufficiently establish the configured role criterion. |
| **Company scale** | Evidence that the organization meets the configured midmarket or enterprise target. | No dated company-scale evidence was supplied. The review also noted that no numeric size threshold had been specified. |
| **Real estate footprint** | Evidence of relevant occupied facilities, offices, labs, industrial space, or a location portfolio. | No dated occupancy or footprint evidence was supplied. |
| **Buying initiative** | An observed leasing, relocation, expansion, consolidation, workplace, or portfolio initiative. | No supporting evidence of an active initiative was supplied. |

So, for those two CFOs, the result is effectively:

> **Buyer role: supported.**  
> **Company scale: unknown.**  
> **Real estate footprint: unknown.**  
> **Current buying initiative: unknown.**  
> **Overall qualification under the current criteria: unknown.**

That is different from saying they are bad prospects.

For the other contacts, the review was also careful not to turn an inconclusive headline into a rejection. Someone with a broad leadership or finance title might qualify after further research; the stored headline simply does not establish that yet.

## 3. “Unknown” is an evidence status, not a negative judgment

The qualification approach shown in the review distinguishes three outcomes:

| Result | Meaning |
|---|---|
| **Match** | The available evidence supports the criterion. |
| **No match** | The available evidence supports a mismatch. |
| **Unknown** | There is not enough usable evidence to decide. |

That distinction matters for your prospecting workflow.

“No evidence of an expansion” is not the same as “the company has no expansion plans.” Likewise, “the record lacks an office address” is not the same as “the company has no office.”

The review represents the overall unknown result as `match: null`. It also assigns `confidence: 0` to that unsupported overall qualification. **That should not be read as a zero-percent chance of winning their business.** It means the review has not established an overall match from the supplied evidence.

Each criterion also carries its own explanation and supporting fact references. That gives you something more useful than a mysterious score: a record of **what is established, what is missing, and why the decision stopped there.**

## 4. Why the timestamp fix matters

Another important change in the surrounding work prevents a recently updated record from making old or undated evidence look fresh.

For example:

> A contact record is edited today, but its CFO headline was captured at an unknown time.

The edit does not prove that the person is still CFO today.

The review therefore checks the observation timestamp on the **individual fact**, rather than borrowing the contact record’s latest update time. A headline without a usable observation timestamp cannot establish a fresh role match merely because the contact was recently exported, imported, or edited.

**“Saved today” must not be confused with “verified today.”**

That also means running another batch export will not, by itself, resolve stale or missing evidence. The underlying facts need a supported observation date.

## 5. The business-model distinction I would make next

There is one aspect of the current setup I would refine: **separate prospect fit from buying readiness.**

The current overall qualification combines both:

> Is this an appropriate company and contact for Cresa?  
> Is there evidence of a current real estate initiative?

Those are related questions, but they should not produce one indistinguishable “unknown” label.

As a hypothetical example, consider a verified CFO at a 250-person Carlsbad device manufacturer with an occupied manufacturing facility. That could be a relevant prospect for your tenant-rep work even when there is no known active relocation or expansion.

I would display the dimensions separately:

| Dimension | Question it answers | Example status |
|---|---|---|
| **Account fit** | Is this a company and occupancy profile we should pursue? | Supported |
| **Contact fit** | Is this person a relevant decision-maker or route to one? | Supported |
| **Buying readiness** | Is there evidence of an active need or a reason to engage now? | Unknown |
| **Evidence freshness** | How current is the information supporting those conclusions? | Current, mixed, or stale |

This is a **recommended refinement**, not something the quoted update establishes as already implemented.

It would let your workflow distinguish **“good-fit relationship to develop”** from **“active opportunity to prioritize”** without inventing intent. It would also prevent a company from disappearing into an undifferentiated unknown bucket solely because its current plans are not visible.

That separation would not automatically qualify these 49 contacts. Their company-scale and footprint evidence would still need work.

## What this means for your next review

The useful next step is not to keep rescoring the same headlines. It is to fill the specific evidence gaps.

I would begin with the two supported buyer-role matches because one criterion is already established, not because they have been proven to be the best opportunities. For each, verify the employer and company scale, establish the relevant occupied footprint, and then look separately for an active real estate initiative. Those findings can support a more informative result than a single pass/fail score.

The batch export makes that review easier to conduct as a group. The criterion-level explanations tell you what research is needed for each person.

**Bottom line: the system can now prepare the 49-contact review without repeating the same export work, but the dataset is still mostly headline-level evidence. “Unknown” is the system refusing to mistake a promising title for a fully researched prospect or an active deal.**
