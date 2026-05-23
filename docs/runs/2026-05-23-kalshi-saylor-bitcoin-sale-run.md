# Cassie Run: Kalshi Crypto Saylor Bitcoin Sale Claim

Run ID: `3f34e07e-9c39-4294-aa2d-62047f643138`  
Status: `succeeded`  
Action: `insufficient_evidence`  
Response: `analysis`  
Ticket: `none`  
User: `local-user`  
Command: `@Cassie trade this`  
Source: [@Kalshi_Crypto](https://x.com/Kalshi_Crypto/status/2057447510235299970)

## Verdict

The claim that Michael Saylor said Strategy will likely sell Bitcoin this year comes from Kalshi Crypto, a prediction market platform's social media account, with no primary source, recording, or official confirmation. Given Saylor's historical maximalist stance and the source's commercial interest in generating market-moving attention, the claim cannot be verified and carries high manipulation risk.

## Timeline

| Step | Status | Duration | Model | Prompt | Output |
| --- | --- | ---: | --- | --- | --- |
| Intake | ok | 0ms | none | none | Persisted the incoming mention as a durable control-plane run. |
| Intent | ok | 3.1s | `deepseek-v4-flash` | `cassie_intent@2026-05-20` | `intent=trade` |
| Signal | ok | 7.0s | `deepseek-v4-flash` | `cassie_signal@2026-05-20` | `signalType=rumor` |
| Thesis | ok | 10.5s | `deepseek-v4-flash` | `cassie_thesis@2026-05-20` | `claim=Michael Saylor says 'Strategy' will likely sell Bitcoin this year` |
| Research | ok | 499.3s | `deepseek-v4-pro` | `cassie_research_report@2026-05-20` | `stance=partially_supported` |
| Trade Expression | ok | 37.4s | `deepseek-v4-pro` | `cassie_trade_expression@2026-05-20` | `decision=no_trade` |
| Final | ok | 9ms | none | none | `responseType=analysis` |

## Research Summary

A viral post claims Michael Saylor said Strategy will likely sell Bitcoin this year. Research found a single secondary source quoting Saylor about a possible sale for dividends, but no primary statement, video, or filing from Saylor or Strategy. The original post offers no supporting evidence, and past behavior suggests Saylor dismisses similar rumors. The claim is plausible but unconfirmed and should not be used for trading decisions.

## Research Run

Research ID: `8233fee9-979f-470d-ac5c-ab705f87bab7`  
Status: `ok`  
Mode: `balanced`  
Duration: `257.3s`

### Query Jobs

| Query | Lane | Status | Duration | Priority | Purpose |
| --- | --- | --- | ---: | ---: | --- |
| `q1` | `x/grok_x_search` | ok | 19.3s | 1.0 | Validate direct evidence of the statement. |
| `q2` | `web/gemini_google_search` | ok | 27.3s | 0.9 | Check primary corporate disclosures. |
| `q3` | `x/grok_x_search` | ok | 17.1s | 0.9 | Search for denial or refutation. |
| `q4` | `web/gemini_google_search` | ok | 21.9s | 0.7 | Confirm Strategy/MSTR asset mapping. |
| `q5` | `x/grok_x_search` | ok | 23.2s | 0.8 | Establish Kalshi post provenance. |

### Key Findings

- `q1`: Kalshi Crypto posted the claim on May 21, 2026, with no linked primary source, quote, video, or filing.
- `q1`: No tweet, video, press release, or SEC filing from Michael Saylor containing an exact quote about Strategy selling Bitcoin in 2026 was found.
- `q2`: A news article reported that Michael Saylor stated Strategy may sell some Bitcoin to pay a dividend in 2026.
- `q2`: No SEC filing as of May 23, 2026 confirms a committed or executed Bitcoin liquidation plan.
- `q3`: Prior social posts describe Saylor debunking older Strategy selling rumors and affirming that Strategy was buying Bitcoin.
- `q4`: MicroStrategy rebranded to Strategy Inc. effective August 11, 2025, and continues to trade under ticker `MSTR`.
- `q5`: The Kalshi Crypto post contains no link, quote, or citation to an original Saylor statement, interview, or filing.
- `q5`: Thread replies questioned the claim's accuracy and noted the absence of supporting evidence.

### Goal Resolution

| Goal | Status | Confidence | Resolution |
| --- | --- | ---: | --- |
| `g1` | partially_resolved | 0.6 | A news article reported that Saylor stated Strategy may sell Bitcoin to pay a dividend in 2026, including a direct quote, but the statement was not verified against a primary source. |
| `g2` | resolved_contradicted | 0.9 | The claim originates from a single Kalshi Crypto post with no linked primary source, quote, or citation. |
| `g3` | resolved_supported | 1.0 | Strategy Inc. is the former MicroStrategy and continues to trade under ticker `MSTR`. |
| `g4` | resolved_contradicted | 0.8 | No unambiguous current official denial of a 2026 sale was found; older denials addressed different rumors, and the claim remains plausible but unverified. |

Controller result: `stop_no_trade`  
Blocked steps: `trade_expression`, `market_router`, `ticket_creation`

## Usage

| Model | Purpose | Status | Tokens | Input | Output | Reasoning | Cache |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| `deepseek-v4-pro` | `supervisor_step` | ok | 28,707 | 28,604 | 103 | 58 | 28,416 |
| `deepseek-v4-pro` | `supervisor_step` | ok | 29,172 | 28,920 | 252 | 58 | 28,672 |
| `deepseek-v4-pro` | `supervisor_step` | ok | 29,927 | 29,389 | 538 | 107 | 29,056 |
| `deepseek-v4-pro` | `supervisor_step` | ok | 31,681 | 30,001 | 1,680 | 426 | 29,824 |
| `deepseek-v4-pro` | `supervisor_step` | ok | 33,380 | 31,755 | 1,625 | 266 | 31,616 |

Total tokens: `152,867`  
Input tokens: `148,669`  
Output tokens: `4,198`  
Reasoning tokens: `915`  
Cache tokens: `147,584`
