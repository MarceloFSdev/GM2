# GM2 AI Control Panel Architecture

This document captures the agreed direction for turning GM2 / CHRONOS GMT into Marz's full AI control panel. It is intended as future-agent context before modifying GM2, Hermes automations, Obsidian, or business-intelligence workflows.

## North Star

GM2 should become Marz's visual AI control panel: a personal/business operating dashboard that shows the current state of his life, work, automations, daily plans, and connected data sources.

Hermes should act as the automation and reasoning engine. It should read structured personal/work context plus live business data, then generate concise daily insights, summaries, and actionable plans.

Telegram should remain the delivery channel for proactive daily briefs, alerts, and summaries.

Obsidian should be the human-editable knowledge base for personal and work context.

## Core Stack

- **GM2 / CHRONOS GMT:** visual control panel and status dashboard.
- **Hermes:** automation scheduler, connectors, and AI reasoning layer.
- **Obsidian / Mars OS:** curated personal + work knowledge base.
- **GHL / GoHighLevel:** CRM source of truth.
- **Gmail / Google Workspace:** email, docs, sheets, calendar, goals/business documents.
- **Google Ads:** acquisition and ad-performance data.
- **Telegram:** daily brief and alert delivery.
- **Local VPS storage:** private data snapshots, reports, system state, and logs.
- **GitHub:** private versioned repos for curated code/context, not raw secrets or raw client data.

## Desired System Flow

```text
Obsidian / Mars OS ┐
GHL CRM            ├──> Hermes collectors ──> local snapshots ──> daily AI analysis
Gmail / Workspace  ┤                                             ├──> Telegram brief
Google Ads         ┘                                             └──> GM2 dashboard state
```

Hermes should use both:

1. **Live business data**
   - CRM opportunities, contacts, tasks, conversations, pipeline state.
   - Gmail/email messages and high-priority replies.
   - Google Ads spend, campaign performance, conversions, CPA/CPL.
   - Calendar and daily schedule context when relevant.

2. **Personal/work context**
   - personal goals, values, constraints, health/sleep, Daily Rhythm.
   - business model, offers, sales process, target customers, positioning.
   - decision rules and daily brief format.

The daily output should not merely report metrics. It should turn data into decisions that fit Marz's priorities, goals, constraints, and current operating rhythm.

## Recommended Obsidian Setup

Use one Obsidian vault with two separated layers, rather than two isolated vaults.

Recommended vault/repo name:

```text
mars-os
```

Recommended local path on the VPS:

```text
/opt/data/repos/mars-os/vault
```

Set Hermes environment variable:

```text
OBSIDIAN_VAULT_PATH=/opt/data/repos/mars-os/vault
```

Recommended vault structure:

```text
vault/
├── 00-Control/
│   ├── AI Instructions.md
│   ├── Current Priorities.md
│   ├── Decision Rules.md
│   ├── Daily Brief Format.md
│   └── Context Index.md
│
├── 10-Personal/
│   ├── Identity.md
│   ├── Values.md
│   ├── Health.md
│   ├── Daily Rhythm.md
│   ├── Personal Goals.md
│   ├── Constraints.md
│   └── Preferences.md
│
├── 20-Work/
│   ├── Business Model.md
│   ├── Offers.md
│   ├── Ideal Customer Profile.md
│   ├── Sales Process.md
│   ├── GHL CRM Rules.md
│   ├── Google Ads Rules.md
│   └── Growth Strategy.md
│
├── 30-Reviews/
│   ├── Daily/
│   ├── Weekly/
│   └── Monthly/
│
├── 40-Projects/
│   ├── GM2 AI Control Panel.md
│   └── Sales System.md
│
└── 99-Archive/
```

### Why One Vault

Personal context should influence work decisions. For example:

- Protect sleep and Daily Rhythm when planning sales/admin work.
- Avoid overload when creating daily action plans.
- Align business actions with long-term personal goals.
- Prioritize revenue actions without violating personal constraints.

Work context should remain clearly separated, but still available for combined reasoning when producing daily plans.

## Context Index

The most important Obsidian file should be:

```text
00-Control/Context Index.md
```

Purpose: tell Hermes which notes are authoritative and how to weigh them.

Suggested content:

```md
# Context Index

## Always read for daily planning
- [[AI Instructions]]
- [[Current Priorities]]
- [[Decision Rules]]
- [[Daily Brief Format]]
- [[Daily Rhythm]]
- [[Personal Goals]]
- [[Business Model]]
- [[Offers]]
- [[Sales Process]]
- [[GHL CRM Rules]]
- [[Google Ads Rules]]

## Personal context rules
Use personal context to:
- protect sleep
- respect health constraints
- avoid overload
- align work with long-term goals

Do not use personal context to:
- invent medical advice
- overrule explicit instructions
- make assumptions from old notes

## Work context rules
Use work context to:
- prioritize revenue actions
- improve CRM follow-up
- improve ads efficiency
- identify business risks

## Priority hierarchy
1. Current explicit instruction from Marz
2. Current Priorities
3. Decision Rules
4. Live data from GHL/email/ads
5. Long-term goals
6. Older notes
```

## Note Metadata Convention

Use frontmatter to identify notes Hermes should read.

Example:

```md
---
ai_read: true
layer: personal
priority: high
status: active
---

# Daily Rhythm

...
```

Recommended fields:

- `ai_read: true | false`
- `layer: personal | work | control | project | review`
- `priority: high | medium | low`
- `status: active | archived | draft`
- `updated: YYYY-MM-DD`

Hermes context collectors should prioritize notes with:

```yaml
ai_read: true
status: active
```

## GitHub Recommendation

Use a private GitHub repo for the curated Obsidian knowledge base, but not for raw private business data.

Recommended repo:

```text
MarceloFSdev/mars-os
```

Good to store in GitHub:

- AI Instructions
- Current Priorities
- Decision Rules
- Business Model
- Offers
- Sales Process
- Google Ads Rules
- GHL CRM Rules
- Personal Goals
- Daily Rhythm
- weekly/monthly reviews if Marz is comfortable versioning them

Do **not** store in GitHub by default:

- raw email bodies
- raw GHL conversations
- raw CRM exports
- client private data
- API keys
- tokens
- passwords
- banking/private financial details
- extremely private journal entries
- raw Google Ads exports if they contain sensitive client/business data

## Local Data Storage

Live private data should stay local on the VPS.

Recommended root:

```text
/opt/data/insights/
```

Suggested structure:

```text
/opt/data/insights/
├── data/
│   ├── context-snapshot.json
│   ├── ghl/
│   │   ├── contacts-latest.json
│   │   ├── opportunities-latest.json
│   │   ├── conversations-latest.json
│   │   ├── tasks-latest.json
│   │   └── pipeline-summary.json
│   ├── gmail/
│   │   └── important-latest.json
│   └── google-ads/
│       └── campaigns-latest.json
│
├── reports/
│   ├── latest.json
│   └── daily/
│
├── status.json
└── logs/
```

Raw snapshots should not be committed into GM2 or GitHub unless explicitly sanitized.

## Hermes Automation Locations

Hermes automations should live in stable VPS locations:

- scripts: `/opt/data/scripts/`
- cron jobs: `/opt/data/cron/`
- state files: `/opt/data/state/`
- insight data: `/opt/data/insights/data/`
- insight reports: `/opt/data/insights/reports/`
- dashboard status: `/opt/data/insights/status.json`

## Daily Automation Design

Use two classes of cron jobs.

### 1. Collector Jobs

Mostly deterministic, script-only, low cost.

Responsibilities:

- fetch data from APIs
- normalize to JSON
- write snapshots
- write connector health/status
- avoid LLM calls
- print nothing unless explicitly meant to notify

Example schedule:

```text
06:50 — collect Gmail
06:55 — collect GHL CRM
07:00 — collect Google Ads
07:05 — collect Obsidian context
07:10 — build daily snapshot
```

### 2. Intelligence Job

LLM-backed reasoning job.

Responsibilities:

- read latest snapshots
- read context snapshot
- synthesize daily insights
- create prioritized action plan
- update GM2 dashboard JSON
- send concise Telegram brief

Example schedule:

```text
07:20 — generate daily business/personal intelligence brief
07:25 — send Telegram daily brief
07:30 — update GM2 control panel state
```

Optional daytime syncs:

```text
Every 1–2 hours:
- refresh GHL pipeline
- refresh important email
- update automation health
```

Optional evening job:

```text
End of day:
- summarize what changed
- compare against morning plan
- prepare tomorrow's starting context
```

## GM2 Control Panel Tabs

GM2 should eventually have tabs/sections like:

1. **Command Center**
   - top objective today
   - top 3–5 actions
   - urgent alerts
   - system health
   - CRM/ad/email summary

2. **Daily Brief**
   - today’s generated briefing
   - yesterday’s briefing
   - weekly trend
   - action checklist

3. **CRM**
   - GHL snapshot
   - hot leads
   - overdue follow-ups
   - stuck opportunities
   - pipeline value
   - next-best actions

4. **Growth**
   - Google Ads state
   - spend
   - conversions
   - CPL/CPA
   - weak campaigns/keywords
   - recommended changes

5. **Context**
   - current priorities
   - active goals
   - strategy notes
   - loaded Obsidian files
   - context freshness

6. **Automation Health**
   - Gmail connector status
   - GHL connector status
   - Google Ads connector status
   - Obsidian context status
   - daily brief status
   - last run times
   - errors/warnings

## Desired Dashboard State Display

GM2 should show a graphic/readable state of the system, for example:

```text
Context Health
├── Personal Context: loaded ✅
├── Work Context: loaded ✅
├── GHL CRM: synced ✅
├── Gmail: synced ✅
├── Google Ads: pending ⚠️
└── Daily Brief: sent ✅
```

Also show:

```text
Today’s AI Reasoning Inputs
- Current Priorities
- Daily Rhythm
- GHL Opportunities
- Gmail Important Replies
- Google Ads Snapshot
- Sales Process Rules
```

## Daily Brief Target Format

Daily briefs should be concise and actionable.

Example:

```text
## Daily Business Brief — May 13

Top focus:
Close 2 warm leads and reduce wasted Google Ads spend.

Revenue / CRM:
- 3 leads need follow-up today.
- 1 deal is stuck after proposal.
- Best next action: send a direct check-in to Alex and Mira.

Email:
- 5 important replies overnight.
- 2 require same-day response.
- 1 looks like a potential sales opportunity.

Google Ads:
- Spend up 18%.
- Conversion rate down on Campaign B.
- Action: pause 2 weak keywords and move budget to Campaign A.

Today’s plan:
1. Reply to high-intent leads.
2. Review stuck CRM opportunities.
3. Adjust Google Ads budget.
4. Work on the highest-priority business doc task.
5. End day by checking if outreach created new calls.
```

Important: daily briefs should turn data into decisions. They should be grounded in Marz's personal context and current business priorities.

## GHL / GoHighLevel CRM Integration

GHL is Marz's CRM.

Recommended collector outputs:

```text
/opt/data/insights/data/ghl/
├── contacts-latest.json
├── opportunities-latest.json
├── conversations-latest.json
├── tasks-latest.json
└── pipeline-summary.json
```

Useful data to pull:

- contacts
- opportunities
- pipeline stages
- conversations / recent messages
- tasks
- appointments
- lead source
- tags
- last interaction date
- deal value
- stage changes

Daily analysis should answer:

- Who needs follow-up today?
- Which leads are warmest?
- Which opportunities are stuck?
- Which opportunities are closest to closing?
- Which stages are weak?
- Which leads came from Google Ads?
- What should Marz do first today?

## Google Workspace Integration

Hermes has a Google Workspace skill/integration for Gmail, Calendar, Drive, Docs, and Sheets via OAuth.

Use it for:

- Gmail important messages
- Google Docs goals/business documents
- Sheets data, if any
- Calendar/day context

Setup requires Google OAuth credentials and token files.

## Google Ads Integration

Google Ads should be added after the core control panel and GHL/Gmail context are stable.

Reason: Google Ads API setup can be more complex.

A practical first version can use scheduled exports to Google Sheets or downloaded reports before full API integration.

Daily analysis should flag:

- spend changes
- conversion-rate changes
- CPA/CPL increases
- low-performing campaigns/keywords
- budget reallocation opportunities
- links between Google Ads leads and GHL pipeline quality

## Privacy and Data Boundaries

- GitHub private repo is acceptable for curated context if Marz is comfortable with it.
- Raw sensitive data should stay local-only under `/opt/data/insights/data/`.
- Do not commit raw CRM/email/ads data into GM2.
- Do not include API keys or tokens in Obsidian or repo files.
- GM2 should display summarized state, not raw private conversations by default.
- Telegram summaries should be concise and avoid dumping unnecessary sensitive details.

## Implementation Phases

### Phase 1 — Knowledge Base + Dashboard Shell

- Create Obsidian/Mars OS vault structure.
- Add canonical control notes.
- Add GM2 Command Center / AI Control Panel shell.
- Add status JSON schema.
- Add visual automation health cards.

### Phase 2 — Daily Brief Without All Integrations

- Read Obsidian context snapshot.
- Generate a daily Telegram brief from context and manually available docs.
- Update GM2 latest brief/status.

### Phase 3 — GHL Connector

- Add GHL API integration.
- Pull contacts, opportunities, tasks, conversations, appointments.
- Generate CRM-aware daily actions.

### Phase 4 — Google Workspace

- Add Gmail, Drive, Docs, Sheets, Calendar via OAuth.
- Pull email and business docs/goals.
- Integrate with daily brief.

### Phase 5 — Google Ads

- Add Google Ads API or report-based integration.
- Connect ad performance to GHL lead quality.
- Generate ad optimization recommendations.

### Phase 6 — Full AI Control Panel

- Historical reports.
- Weekly summaries.
- Goal progress tracking.
- Interactive visual status.
- Action checklist and completed/incomplete state.

## Future-Agent Notes

- Marz wants GM2 to become the full AI control panel, not just a static dashboard.
- The Daily Rhythm section should be called **Daily Rhythm**, not Schedule.
- Daily Rhythm Telegram alerts should be concise and should not contain Hermes/cron metadata.
- For website changes through linked GitHub repos, small instructed changes may be pushed directly when explicitly requested; complex changes should use preview/staging first.
- Before exposing any live data in GM2, check whether it contains sensitive CRM/email/client details.
- Prefer local JSON snapshots for raw live data and repo-tracked markdown for curated context.
