# Commission Management

This document deliberately contains no commission rates. The sheet is confidential, and its data lives only in the database.

## Source sheet (read on 11 Nov 2026)

The Google Sheet export has one worksheet, `Sheet1`. It contains a header row and 49 commission rows.

| Column | Header | Meaning | Imported as |
|---|---|---|---|
| A | (none) | University, with the intake on a second line | University, intake |
| B | (none) | "India" on every row | Student market |
| C | WHAT WE GETTING | What SSI GLOBAL receives, sometimes with bonus terms | **Internal**: received |
| D | PORTAL | Portal, sometimes with a "UG -" or "PG -" prefix | Route = portal, provider, level |
| E | OUR COMMISSION TIER 1 | Tier 1 partner rate | Tier 1 |
| F | PROFIT | SSI GLOBAL margin (E + F = C on most rows) | **Internal**: profit |
| G | TIER 2 | Tier 2 partner rate | Tier 2 |
| H | TIER 3 | Tier 3 partner rate | Tier 3 |

Every cell is also stored with its original header in the internal source row. Columns the importer does not recognise are kept the same way.

**Result of a trial import of the real sheet** (into a throwaway local database):
- 49 records for 46 universities.
- 9 portals: AEC, CRIZAC, GUS on Process, HOQUE, INFINITE, OIEG, SANWARIYA, SN GLOBAL, UNIMATCH.
- 147 tier rates: 130 percentages, 15 amounts and 2 unreadable values.
- 12 rows flagged "Needs review".
- Re-importing the same file found 0 new, 0 changed and 49 unchanged rows.

## Points in the sheet that need a decision

- **Country:** the sheet doesn't name a country. The admin chooses one on import ("United Kingdom").
- **Direct route:** no row is Direct. Direct records are supported but none were imported.
- **University of East London:** the row lists two portals ("INFINITE/CRIZAC"), so no single portal is linked and the row is flagged.
- **Missing currency:** amounts for the University of Leicester (2 rows) and the University of East Anglia don't state a currency. They are flagged; the system doesn't assume GBP.
- **Bare numbers:** Tier 1 for Sheffield Hallam University and the University of Staffordshire is written as 15 and 16, without "%". They are stored as "unclear" and flagged.
- **"%%" typos:** Cardiff Metropolitan University, Regent College London and the University of Staffordshire. They are read as percentages and flagged.
- **Tier 1 + profit ≠ what we get:** University of Wales Trinity Saint David (Birmingham and Swansea), Ulster University, Northumbria University and Cardiff Metropolitan University.
- **University of Greenwich:** what SSI GLOBAL receives is written as "22.5 / 750 GBP Bonus", which is unclear. The text is kept.
- **Bonus terms in column C:** these are SSI GLOBAL's own terms. They are kept internal and never shown to partners.
- **Name typos:** names are kept exactly as written, for example "Birmigham City University". A record links to the course catalogue only when its name matches exactly.

## Permissions

Only a Super Admin can grant these. They appear under Employee or User Management.

| Permission | Allows |
|---|---|
| Commission · View catalogue | See records, Tier 1/2/3 partner rates and agency agreements |
| Commission · Tag agencies | Tag an agency to a standard tier. Changing an existing agreement waits for approval |
| Commission · Manage agreements | Approve, end and change agreements; set custom commissions; confirm the commission for an application |
| Commission · Internal values | See SSI GLOBAL's commission, profit and the original sheet rows |
| Commission · Edit master & import | Edit records, countries, portals and tiers; import sheets (importing also needs Internal values) |

**Suggested grants:**
- **Partnership Officers:** View + Tag.
- **The additional restricted staff member:** View + Tag.
- **Finance lead:** add Manage and Internal values.

**Partner Admin:**
- Sees only their organisation's active agreements, through `my_partner_commissions()`: the one rate that applies, with partner-facing conditions.
- Never sees other tiers, internal values, internal remarks or other agencies.

**Partner employees** see nothing. The database refuses their requests, and the page is hidden from them as well.

## How it works

**Assignment:** Commission records → Tag agency, or set a custom commission.
- A custom commission never changes the master record.
- Every change is recorded in the history.
- The partner's page updates live.

**Importing a new version of the sheet:** Import sheet → preview → confirm.
- The preview shows new, changed and unchanged records; new countries, portals and universities; and records missing from the new sheet (these are kept, not deleted).
- It also shows which standard-tier agreements would get new rates. Applying requires explicit confirmation, custom agreements are never changed, and the previous version of each record is kept.

**Applications:** each application is linked to a commission only when exactly one active agreement fits its partner and university.
- If several could apply, the application is flagged as ambiguous, and a manager chooses in Application details.
- Partners never see this link.

**Amounts:** stored as exact decimals in their original currency. Nothing is converted.

## Not built

- **Live Google Sheets sync:** this needs server-side Google credentials. Upload the `.xlsx` export instead.
- **Route and portal choice on the partner's application form:** partners don't know which portal SSI GLOBAL uses, so ambiguous matches are resolved by staff.
- **Earned or paid commission:** configured rates are kept separate from actual earnings. Commission invoices remain in Finance.
