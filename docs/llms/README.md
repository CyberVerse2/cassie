# Vendor LLM Documentation Indexes

These files are local copies of venue documentation indexes used when working on Cassie's market-data connectors.

## Files

- `hyperliquid-llms.txt`
  - Source: https://hyperliquid.gitbook.io/hyperliquid-docs/llms.txt
- `polymarket-llms.txt`
  - Source: https://docs.polymarket.com/llms.txt
- `polymarket-us-llms.txt`
  - Source: https://docs.polymarket.us/llms.txt

## Refresh

```sh
curl -L https://hyperliquid.gitbook.io/hyperliquid-docs/llms.txt -o docs/llms/hyperliquid-llms.txt
curl -L https://docs.polymarket.com/llms.txt -o docs/llms/polymarket-llms.txt
curl -L https://docs.polymarket.us/llms.txt -o docs/llms/polymarket-us-llms.txt
```

Use these indexes to find canonical docs and API/OpenAPI pages before changing connector request or response shapes.
